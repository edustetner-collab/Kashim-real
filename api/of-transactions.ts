import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

// ─── Auth (same pattern as api/debts.ts) ─────────────────────────────────────

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';

function verifyAuthToken(authHeader?: string): { sub: string; [k: string]: unknown } | null {
  if (!SUPABASE_JWT_SECRET) return null;
  const token = (authHeader ?? '').replace('Bearer ', '').trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const [h, p, s] = parts;
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    if (header.alg !== 'HS256') return null;
    const expected = createHmac('sha256', SUPABASE_JWT_SECRET).update(`${h}.${p}`).digest();
    const provided = Buffer.from(s, 'base64url');
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (!claims.sub) return null;
    if (typeof claims.exp === 'number' && claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function isMember(sub: string, householdId: string): Promise<boolean> {
  if (ADMIN_IDS.includes(sub)) return true;
  const { data } = await db
    .from('household_members')
    .select('id')
    .eq('household_id', householdId)
    .eq('clerk_user_id', sub)
    .maybeSingle();
  return !!data;
}

// ─── Row ↔ camelCase helpers ──────────────────────────────────────────────────

function rowToTx(r: Record<string, unknown>) {
  return {
    id: r.id,
    householdId: r.household_id,
    connectionId: r.connection_id,
    transactionId: r.transaction_id,
    fitid: r.fitid,
    accountType: r.account_type,
    transactionType: r.transaction_type,
    ofCode: r.of_code,
    ofCategory: r.of_category,
    amount: r.amount,
    transactionDate: r.transaction_date,
    description: r.description,
    merchant: r.merchant ?? null,
    paymentMethod: r.payment_method,
    cardLast4: r.card_last4,
    billDueDate: r.bill_due_date,
    billTotal: r.bill_total,
    suggestedCategory: r.suggested_category,
    suggestionConfidence: r.suggestion_confidence,
    suggestedItemId: r.suggested_item_id ?? null,
    installmentCurrent: r.installment_current,
    installmentTotal: r.installment_total,
    status: r.status,
    kashimItemId: r.kashim_item_id,
    kashimCategory: r.kashim_category,
    kashimPartialId: r.kashim_partial_id,
    categorizedAt: r.categorized_at,
    /** Resumo "o Kashim lançou por você" já conferido — some em TODO aparelho. */
    resumoVisto: r.resumo_visto === true,
    createdAt: r.created_at,
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });
  const sub = claims.sub;

  try {
    // ── GET — listar transações ───────────────────────────────────────────────
    if (req.method === 'GET') {
      const householdId = String(req.query.householdId ?? '');
      if (!householdId) return res.status(400).json({ error: 'householdId obrigatório' });
      if (!(await isMember(sub, householdId))) return res.status(403).json({ error: 'Forbidden' });

      const status = req.query.status as string | undefined;
      const limit = Math.min(parseInt(String(req.query.limit ?? '100')), 500);
      const direction = req.query.direction as string | undefined; // 'expense' | 'income' | 'savings'

      /**
       * Só transações de conexão VIVA.
       *
       * Sem este recorte, gasto de banco desconectado continuava sendo contado
       * mas não aparecia em tela nenhuma: o pop-up anunciava 154 e o Extrato
       * mostrava 79, porque a lista de bancos só desenha o que está conectado.
       * Quem viu isso foi o Eduardo, três vezes, e das três a causa era esta.
       *
       * A contagem e a lista passam a sair da MESMA fonte. Divergir de novo
       * exigiria alguém mudar as duas — e é para isso que elas estão lado a
       * lado aqui.
       */
      const { data: vivas } = await db
        .from('bank_connections')
        .select('id, account_import_enabled, card_import_enabled, cards')
        .eq('household_id', householdId)
        .neq('consent_status', 'revoked');
      const idsVivos = (vivas ?? []).map((c) => c.id as string);

      /**
       * IMPORTAÇÃO DESLIGADA TAMBÉM SOME DA FILA.
       *
       * O Extrato só desenha conta e cartão com a importação ligada, mas a fila
       * continuava contando o que tinha entrado ANTES de o cliente desligar.
       * Resultado: o push falava em 3, o botão mostrava 2 e o Extrato listava 1
       * — três números, todos "certos", nenhum igual (Eduardo, 2026-09-20).
       *
       * A regra agora é uma só: se a tela não mostra, a fila não conta.
       */
      const cartoesLigados = new Map<string, Set<string>>();
      const cartoesDesligados = new Map<string, Set<string>>();
      const contaLigada = new Map<string, boolean>();
      const cartaoLigadoNaConexao = new Map<string, boolean>();
      for (const c of vivas ?? []) {
        const id = c.id as string;
        contaLigada.set(id, c.account_import_enabled !== false);
        cartaoLigadoNaConexao.set(id, c.card_import_enabled !== false);
        const lista = Array.isArray(c.cards) ? c.cards as Array<{ last4?: string; enabled?: boolean }> : [];
        cartoesLigados.set(id, new Set(lista.filter(k => k?.enabled && k?.last4).map(k => String(k.last4))));
        cartoesDesligados.set(id, new Set(lista.filter(k => k?.enabled === false && k?.last4).map(k => String(k.last4))));
      }

      /**
       * A transacao aparece na tela do cliente?
       *
       * Esconder exige CERTEZA de que o cliente desligou aquela fonte. Numero
       * de cartao que nao esta na lista da conexao — virtual, adicional, ou um
       * final que o banco manda e a conexao nunca cadastrou — nao e fonte
       * desligada: e gasto real esperando categoria. Tratar como desligado
       * tirou 20 das 23 transacoes do Michael da tela (2026-09-21).
       */
      const apareceNaTela = (t: { connection_id?: string | null; account_type?: string | null; card_last4?: string | null }) => {
        const conn = t.connection_id ?? '';
        if (!conn) return true; // sem conexao conhecida, nao esconde nada
        if (t.account_type === 'credit_card') {
          if (!cartaoLigadoNaConexao.get(conn)) return false;
          if (!t.card_last4) return true;
          const numero = String(t.card_last4);
          if (cartoesLigados.get(conn)?.has(numero)) return true;
          return !cartoesDesligados.get(conn)?.has(numero);
        }
        return contaLigada.get(conn) !== false;
      };

      if (idsVivos.length === 0) {
        return res.status(200).json({ transactions: [], pendingCount: 0 });
      }

      /**
       * Nada antes do primeiro mês do plano.
       *
       * O cron já não importa gasto anterior ao início do plano, mas isto aqui
       * é o que faz a REPROJEÇÃO valer: ao reprojetar para dezembro,
       * `households.start_month` vira dezembro e tudo que ficou pendente de
       * setembro a novembro para de aparecer na hora, sem precisar apagar linha
       * nenhuma do banco. Filtro de leitura, não exclusão: reprojetar de volta
       * traz tudo de volta.
       *
       * Sem `start_month` (household antigo), cai no mês corrente.
       */
      const { data: casa } = await db
        .from('households')
        .select('start_month, start_year')
        .eq('id', householdId)
        .maybeSingle();
      const agora = new Date();
      const mesInicio = casa?.start_month ?? agora.getMonth();
      const anoInicio = casa?.start_year ?? agora.getFullYear();
      const inicioDoPlano = `${anoInicio}-${String(mesInicio + 1).padStart(2, '0')}-01`;

      let query = db
        .from('bank_transactions')
        .select('*')
        .eq('household_id', householdId)
        .in('connection_id', idsVivos)
        .gte('transaction_date', inicioDoPlano)
        .order('transaction_date', { ascending: false })
        .limit(limit);

      if (status) query = query.eq('status', status);
      if (direction) query = query.eq('transaction_type', direction);

      const { data, error } = await query;
      if (error) throw error;
      const visiveis = (data ?? []).filter(apareceNaTela);

      /**
       * A contagem sai da MESMA regra da lista — inclusive o filtro de
       * importação desligada. Por isso ela lê as linhas (só os campos do
       * filtro) em vez de pedir um `count` ao banco: `count` não sabe o que a
       * tela esconde.
       */
      const { data: paraContar } = await db
        .from('bank_transactions')
        .select('id, connection_id, account_type, card_last4')
        .eq('household_id', householdId)
        .in('connection_id', idsVivos)
        .gte('transaction_date', inicioDoPlano)
        .eq('status', 'pending')
        .limit(5000);

      return res.status(200).json({
        transactions: visiveis.map(rowToTx),
        pendingCount: (paraContar ?? []).filter(apareceNaTela).length,
      });
    }

    // ── POST — upsert em lote (sync do banco) ─────────────────────────────────
    // Body: { householdId, connectionId?, transactions: OFTransaction[] }
    if (req.method === 'POST') {
      const { householdId, connectionId, transactions } = req.body as {
        householdId?: string;
        connectionId?: string;
        transactions?: Array<Record<string, unknown>>;
      };

      if (!householdId || !Array.isArray(transactions)) {
        return res.status(400).json({ error: 'householdId e transactions[] obrigatórios' });
      }
      if (!(await isMember(sub, householdId))) return res.status(403).json({ error: 'Forbidden' });
      if (transactions.length === 0) return res.status(200).json({ upserted: 0 });

      const rows = transactions.map((tx) => ({
        household_id: householdId,
        connection_id: connectionId ?? null,
        transaction_id: String(tx.transactionId ?? ''),
        fitid: tx.fitid ?? null,
        account_type: String(tx.accountType ?? 'checking'),
        transaction_type: String(tx.direction ?? 'expense'),
        of_code: tx.ofCode ?? null,
        of_category: tx.ofCategory ?? null,
        amount: Number(tx.amount) || 0,
        transaction_date: String(tx.date ?? ''),
        description: tx.description ?? null,
        merchant: tx.merchant ?? null,
        payment_method: tx.paymentMethod ?? null,
        card_last4: tx.cardLast4 ?? null,
        bill_due_date: tx.billDueDate ?? null,
        bill_total: tx.billTotal ?? null,
        suggested_category: tx.suggestedCategory ?? null,
        suggestion_confidence: tx.suggestionConfidence ?? null,
        installment_current: tx.installmentInfo ? (tx.installmentInfo as any).current : null,
        installment_total: tx.installmentInfo ? (tx.installmentInfo as any).total : null,
        status: 'pending',
      }));

      // Upsert: on conflict (household_id, transaction_id) do nothing
      // → already-categorized transactions are never reset
      const { data, error } = await db
        .from('bank_transactions')
        .upsert(rows, {
          onConflict: 'household_id,transaction_id',
          ignoreDuplicates: true,
        })
        .select('id');

      if (error) throw error;

      return res.status(200).json({ upserted: data?.length ?? 0 });
    }

    // ── PATCH — categorizar ou ignorar uma transação ──────────────────────────
    // Body: { householdId, transactionId, action: 'categorize'|'ignore', itemId?, category?, partialId? }
    if (req.method === 'PATCH') {
      const { householdId, transactionId, action, itemId, category, partialId } = req.body as {
        householdId?: string;
        transactionId?: string;
        action?: 'categorize' | 'ignore' | 'resumo_visto';
        itemId?: string;
        category?: string;
        partialId?: string;
        transactionIds?: string[];
      };

      const corpoIds = (req.body as { transactionIds?: string[] }).transactionIds;
      if (!householdId || !action || (!transactionId && !(corpoIds && corpoIds.length))) {
        return res.status(400).json({ error: 'householdId, transactionId e action obrigatórios' });
      }
      if (!(await isMember(sub, householdId))) return res.status(403).json({ error: 'Forbidden' });

      /**
       * "Está tudo certo": o resumo some para sempre, em qualquer aparelho.
       *
       * Antes isso ficava no localStorage: o Eduardo conferia no celular e o
       * mesmo aviso reaparecia na web (2026-09-23). Notificação terminada não
       * volta — e para isso o estado tem de viver no servidor.
       */
      if (action === 'resumo_visto') {
        const ids = Array.isArray(corpoIds) && corpoIds.length > 0 ? corpoIds : [transactionId];
        const { error } = await db
          .from('bank_transactions')
          .update({ resumo_visto: true })
          .eq('household_id', householdId)
          .in('transaction_id', ids);
        if (error) throw error;
        return res.status(200).json({ ok: true, marcadas: ids.length });
      }

      if (action === 'ignore') {
        const { error } = await db
          .from('bank_transactions')
          .update({ status: 'ignored', categorized_at: new Date().toISOString() })
          .eq('household_id', householdId)
          .eq('transaction_id', transactionId);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      if (action === 'categorize') {
        if (!itemId || !category) {
          return res.status(400).json({ error: 'itemId e category obrigatórios para categorize' });
        }
        const { error } = await db
          .from('bank_transactions')
          .update({
            status: 'categorized',
            kashim_item_id: itemId,
            kashim_category: category,
            kashim_partial_id: partialId ?? null,
            categorized_at: new Date().toISOString(),
          })
          .eq('household_id', householdId)
          .eq('transaction_id', transactionId);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'action inválida' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return res.status(500).json({ error: msg });
  }
}
