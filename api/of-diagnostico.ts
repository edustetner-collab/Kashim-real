import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// Diagnóstico de fatura: mostra lado a lado o que o banco DECLAROU e o que a
// soma dos lançamentos dá, por cartão e por mês de vencimento.
//
// Existe porque divergência de fatura ("o app mostra X, meu banco mostra Y") não
// tem como ser investigada de fora: o coach só enxerga o número final. Aqui dá
// para ver de qual das duas fontes ele veio e onde a conta se perde.
//
// Só super-admin. Somente leitura — não altera nada.

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? '';
// Espelha OF_BETA_EMAILS: a conta que o Eduardo usa no app é a de cliente, e o
// ID dela não está em ADMIN_USER_IDS — checar só por ID trancava o dono fora.
const DONO_EMAILS = ['eduardo_cda@hotmail.com'];

async function podeDiagnosticar(sub: string): Promise<boolean> {
  if (ADMIN_IDS.includes(sub)) return true;
  if (!CLERK_SECRET_KEY) return false;
  try {
    const r = await fetch(`https://api.clerk.com/v1/users/${sub}`, {
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    });
    if (!r.ok) return false;
    const u = await r.json() as { email_addresses?: Array<{ email_address?: string }> };
    return (u.email_addresses ?? []).some(
      e => DONO_EMAILS.includes((e.email_address ?? '').toLowerCase().trim()),
    );
  } catch {
    return false;
  }
}

function verifyAuthToken(authHeader?: string): { sub: string } | null {
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
    // Só token do CLERK. O mesmo segredo assina os tokens do GoTrue do
    // Supabase: sem esta linha, um cadastro direto no Supabase entraria como
    // usuário do app (revisão de segurança, 2026-09-24).
    if (!String(claims.sub).startsWith('user_')) return null;
    if (typeof claims.exp === 'number' && claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

type Tx = {
  id: string;
  description: string | null;
  amount: number;
  transaction_date: string;
  transaction_type: string;
  bill_due_date: string | null;
  bill_total: number | null;
  card_last4: string | null;
  installment_current: number | null;
  installment_total: number | null;
  status: string | null;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization ?? '');
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });
  if (!(await podeDiagnosticar(claims.sub))) return res.status(403).json({ error: 'Forbidden' });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'Supabase não configurado' });

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const busca = (req.query.q as string ?? '').trim();
  const mesFiltro = (req.query.mes as string ?? '').trim(); // ex: 2026-09

  // POST: tira o marco de consultoria de uma casa, passando-a para o fluxo de
  // usuário comum — onde a fatura a vencer entra inteira para categorizar.
  // Usado quando um perfil foi criado pelo painel mas a pessoa não é cliente.
  if (req.method === 'POST') {
    const alvo = (req.body?.householdId as string ?? busca).trim();
    const acao = String(req.body?.acao ?? 'virar_usuario_normal');
    if (!alvo) return res.status(400).json({ error: 'householdId obrigatório' });

    const { data: antes } = await db
      .from('bank_connections')
      .select('id, bank_name, categorize_from, bill_totals')
      .eq('household_id', alvo);
    const conexoes = antes ?? [];

    /**
     * Zerar a fatura gravada e mandar reimportar.
     *
     * `bill_totals` é acumulativo: a sincronização só sobrescreve os meses que a
     * importação nova trouxe, e preserva os demais. Quando o cartão volta sem
     * lançamento daquele mês — protocolo ainda sem dado, conta reconectada,
     * ciclo reprojetado — o valor velho fica congelado e nada no fluxo normal o
     * derruba. Foi assim que a Renata ficou com R$10.516 onde o banco mostrava
     * R$8.788, e o Michael com fatura de R$145 mil de um ciclo que ele já
     * apagou (2026-09-15).
     *
     * Apaga também as `pending`, que são o que o cliente ainda não tocou —
     * categorizada e ignorada ficam intactas.
     */
    /**
     * Apaga transações repetidas, mantendo a primeira de cada gasto.
     *
     * Quando o banco não manda `transactionId`, o upsert não deduplicava (NULL
     * não colide com NULL no Postgres) e cada reimportação inseria o extrato
     * inteiro outra vez. A gravação já foi corrigida, mas o que entrou repetido
     * continua lá inflando a fatura — e é o que faz o número crescer a cada
     * ciclo (2026-09-16).
     *
     * A identidade do gasto é data + valor + descrição, o mesmo critério que o
     * cálculo da fatura usa. Entre as cópias, fica a mais antiga; se alguma foi
     * categorizada, ela tem prioridade para não perder o trabalho do cliente.
     */
    if (acao === 'limpar_duplicatas') {
      const { data: todas, error: eLd } = await db
        .from('bank_transactions')
        .select('id, transaction_id, transaction_date, amount, description, status, created_at')
        .eq('household_id', alvo)
        .order('created_at', { ascending: true })
        .limit(20000);
      if (eLd) return res.status(500).json({ error: eLd.message });

      const ficam = new Map<string, { id: string; categorizada: boolean }>();
      const apagar: string[] = [];

      for (const t of todas ?? []) {
        const chave = `${t.transaction_date}|${t.amount}|${(t.description ?? '').slice(0, 80)}`;
        const atual = ficam.get(chave);
        const categorizada = t.status === 'categorized';
        if (!atual) {
          ficam.set(chave, { id: t.id as string, categorizada });
          continue;
        }
        // Categorizada vence a mais antiga: o cliente já trabalhou nela.
        if (categorizada && !atual.categorizada) {
          apagar.push(atual.id);
          ficam.set(chave, { id: t.id as string, categorizada });
        } else {
          apagar.push(t.id as string);
        }
      }

      for (let i = 0; i < apagar.length; i += 200) {
        const lote = apagar.slice(i, i + 200);
        const { error } = await db.from('bank_transactions').delete().in('id', lote);
        if (error) return res.status(500).json({ error: error.message, onde: 'apagar duplicatas' });
      }

      return res.json({
        ok: true,
        acao: 'limpar_duplicatas',
        household_id: alvo,
        transacoes_antes: (todas ?? []).length,
        duplicatas_apagadas: apagar.length,
        transacoes_agora: (todas ?? []).length - apagar.length,
        proximo_passo: apagar.length > 0
          ? 'Duplicatas removidas. Rode "Reimportar do zero" em seguida para a fatura ser recalculada sem elas.'
          : 'Nenhuma duplicata encontrada — o problema da fatura é outro.',
      });
    }

    /**
     * Estado limpo: apaga TUDO e reimporta.
     *
     * Destrutivo de propósito — leva junto o que o cliente já categorizou. Só
     * com autorização dele, e existe para os casos em que rodadas sucessivas de
     * correção deixaram camadas de resíduo que impedem enxergar o dado real
     * (Renata, 2026-09-16: três reimportações parciais e nenhuma conclusão).
     *
     * Depois disto, o que aparecer é exatamente o que o banco entrega.
     */
    if (acao === 'zerar_tudo') {
      const { count: antes } = await db
        .from('bank_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('household_id', alvo);

      const { error: e1 } = await db
        .from('bank_transactions')
        .delete()
        .eq('household_id', alvo);
      if (e1) return res.status(500).json({ error: e1.message, onde: 'apagar transações' });

      const { error: e2 } = await db
        .from('bank_connections')
        .update({ bill_totals: {}, needs_resync: true, last_synced_at: null })
        .eq('household_id', alvo);
      if (e2) return res.status(500).json({ error: e2.message, onde: 'limpar conexões' });

      const { data: linhasTudo } = await db
        .from('finance_items')
        .select('id, description, values')
        .eq('household_id', alvo)
        .eq('category', 'Cartão de Crédito');

      const daConexaoTudo = (linhasTudo ?? []).filter(l => {
        const d = String(l.description ?? '');
        return d.includes('••') || d.includes('· Fatura');
      });
      for (const l of daConexaoTudo) {
        const zerado = (Array.isArray(l.values) ? l.values as number[] : []).map(() => 0);
        await db.from('finance_items').update({ values: zerado }).eq('id', l.id);
      }

      return res.json({
        ok: true,
        acao: 'zerar_tudo',
        household_id: alvo,
        transacoes_apagadas: antes ?? 0,
        linhas_zeradas: daConexaoTudo.map(l => l.description),
        proximo_passo: 'Tudo apagado. O cron (minuto 45) vai importar do zero, sem resíduo. O que aparecer é exatamente o que o banco entrega.',
      });
    }

    if (acao === 'reimportar') {
      const ids = conexoes.map(c => c.id);
      if (ids.length === 0) return res.status(404).json({ error: 'Nenhuma conexão para este household' });

      const { error: e1 } = await db
        .from('bank_connections')
        .update({ bill_totals: {}, needs_resync: true, last_synced_at: null })
        .eq('household_id', alvo);
      if (e1) return res.status(500).json({ error: e1.message, onde: 'limpar bill_totals' });

      const { error: e2 } = await db
        .from('bank_transactions')
        .delete()
        .eq('household_id', alvo)
        .eq('status', 'pending');
      if (e2) return res.status(500).json({ error: e2.message, onde: 'apagar pendentes' });

      /**
       * Zerar TAMBÉM a linha de fatura no Plano — é ela que o cliente vê.
       *
       * O efeito que monta essa linha começa com
       * `if (Object.keys(billTotals).length === 0) continue;`: com a fonte
       * vazia ele pula a conexão e deixa a linha exatamente como estava. Ou
       * seja, zerar `bill_totals` sozinho apagava o dado certo e preservava o
       * errado na tela — foi por isso que a fatura da Renata sobreviveu a duas
       * reimportações (2026-09-16).
       *
       * Só zeramos linhas que NASCERAM da conexão (têm "••" com os 4 dígitos ou
       * "· Fatura" no nome). Linha que o coach lançou à mão fica intacta.
       */
      const { data: linhas } = await db
        .from('finance_items')
        .select('id, description, values')
        .eq('household_id', alvo)
        .eq('category', 'Cartão de Crédito');

      const daConexao = (linhas ?? []).filter(l => {
        const d = String(l.description ?? '');
        return d.includes('••') || d.includes('· Fatura');
      });

      for (const l of daConexao) {
        const zerado = (Array.isArray(l.values) ? l.values as number[] : []).map(() => 0);
        await db.from('finance_items').update({ values: zerado }).eq('id', l.id);
      }

      return res.json({
        ok: true,
        acao: 'reimportar',
        household_id: alvo,
        conexoes_limpas: conexoes.map(c => ({
          banco: c.bank_name,
          faturas_apagadas: Object.keys((c.bill_totals ?? {}) as object).length,
        })),
        linhas_do_plano_zeradas: daConexao.map(l => l.description),
        proximo_passo: 'Faturas zeradas na conexão E na linha do Plano, pendentes apagadas. O cron (minuto 45) reimporta e recalcula do zero. Lançamentos já categorizados e linhas lançadas à mão foram preservados.',
      });
    }

    const { error } = await db
      .from('bank_connections')
      .update({ categorize_from: null, needs_resync: true })
      .eq('household_id', alvo);
    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      ok: true,
      acao: 'virar_usuario_normal',
      household_id: alvo,
      conexoes_alteradas: conexoes.map(c => ({
        banco: c.bank_name,
        categorize_from_antes: c.categorize_from,
        categorize_from_agora: null,
      })),
      proximo_passo: 'Marco de consultoria removido. Rode "reimportar" em seguida para os dados voltarem com o corte novo.',
    });
  }

  /**
   * Varredura: um sinal de saúde por casa, para achar incoerência antes do
   * cliente. Com poucos testadores dá para clicar um a um; com mais, o que
   * ninguém procura é o que o cliente encontra primeiro.
   */
  if (req.query.varredura === '1') {
    const { data: conns, error: e } = await db
      .from('bank_connections')
      .select('household_id, bank_name, cards, bill_totals, last_synced_at, consent_status, categorize_from');
    if (e) return res.status(500).json({ error: e.message });

    const ids = [...new Set((conns ?? []).map(c => c.household_id))];
    const { data: casas } = await db
      .from('households')
      .select('id, prospect_name, prospect_email')
      .in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
    const nome = new Map((casas ?? []).map(c => [c.id, c.prospect_name ?? c.prospect_email ?? null]));

    const { data: txs } = await db
      .from('bank_transactions')
      .select('household_id, bill_due_date, status')
      .in('household_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
      .limit(20000);

    const agora = Date.now();
    const mesAtual = new Date().toISOString().slice(0, 7);

    const resultado = ids.map(id => {
      /**
       * Só conexões VIVAS entram no julgamento.
       *
       * Tentativa de conexão que não completou fica na tabela para sempre, sem
       * cartão e sem sincronização — a conta do Eduardo tem 14 delas. Contando
       * essas, todo mundo aparecia com "nunca sincronizou" e "conexão
       * duplicada", e o alerta virou ruído que não distingue quem tem problema
       * de verdade (2026-09-16).
       */
      const todas = (conns ?? []).filter(c => c.household_id === id);
      const doHousehold = todas.filter(c =>
        (Array.isArray(c.cards) && c.cards.length > 0)
        || Object.keys((c.bill_totals ?? {}) as object).length > 0
        || c.last_synced_at,
      );
      const orfas = todas.length - doHousehold.length;
      const minhasTx = (txs ?? []).filter(t => t.household_id === id);
      const comVencimento = minhasTx.filter(t => /^\d{4}-\d{2}/.test(String(t.bill_due_date ?? ''))).length;
      const pendentes = minhasTx.filter(t => t.status === 'pending').length;

      let faturaDoMes = 0;
      for (const c of doHousehold) {
        const bt = (c.bill_totals ?? {}) as Record<string, Record<string, number>>;
        for (const meses of Object.values(bt)) {
          const v = meses?.[mesAtual];
          if (Number.isFinite(v)) faturaDoMes += v;
        }
      }

      const syncMaisRecente = doHousehold
        .map(c => c.last_synced_at ? new Date(c.last_synced_at as string).getTime() : 0)
        .reduce((a, b) => Math.max(a, b), 0);
      const horasSemSync = syncMaisRecente ? Math.round((agora - syncMaisRecente) / 36e5) : null;

      // Um banco com duas conexões pode gravar faturas concorrentes.
      const porBanco = new Map<string, number>();
      for (const c of doHousehold) porBanco.set(c.bank_name as string, (porBanco.get(c.bank_name as string) ?? 0) + 1);
      const duplicados = [...porBanco.entries()].filter(([, n]) => n > 1).map(([b]) => b);

      const alertas: string[] = [];
      if (faturaDoMes > 0 && comVencimento === 0) {
        alertas.push('Fatura gravada sem nenhuma transação com vencimento — número provavelmente é resíduo antigo');
      }
      if (minhasTx.length === 0 && faturaDoMes > 0) {
        alertas.push('Tem fatura mas nenhuma transação importada');
      }
      if (horasSemSync !== null && horasSemSync > 24) {
        alertas.push(`Sem sincronizar há ${horasSemSync}h`);
      }
      if (horasSemSync === null) {
        alertas.push('Nunca sincronizou');
      }
      if (doHousehold.some(c => c.consent_status && c.consent_status !== 'active')) {
        alertas.push('Consentimento não está ativo em alguma conexão');
      }
      if (duplicados.length > 0) {
        alertas.push(`Conexão duplicada: ${duplicados.join(', ')} — risco de fatura sobrescrita`);
      }

      return {
        household_id: id,
        casa: nome.get(id) ?? id.slice(0, 8),
        conexoes: doHousehold.length,
        conexoes_orfas: orfas,
        bancos: [...new Set(doHousehold.map(c => c.bank_name))].join(', '),
        eh_cliente_consultoria: doHousehold.some(c => c.categorize_from),
        fatura_do_mes: Math.round(faturaDoMes * 100) / 100,
        transacoes: minhasTx.length,
        pendentes,
        com_vencimento: comVencimento,
        horas_sem_sync: horasSemSync,
        alertas,
      };
    }).sort((a, b) => b.alertas.length - a.alertas.length);

    return res.json({
      mes: mesAtual,
      casas_com_banco: resultado.length,
      com_alerta: resultado.filter(r => r.alertas.length > 0).length,
      casas: resultado,
    });
  }

  // Sem busca: lista as casas com banco conectado, para achar o household_id.
  if (!busca) {
    const { data: conns, error: connErr } = await db
      .from('bank_connections')
      .select('household_id, bank_name, card_last4, cards, last_synced_at')
      .order('last_synced_at', { ascending: false })
      .limit(50);
    if (connErr) return res.status(500).json({ error: connErr.message, onde: 'listar bank_connections' });

    const ids = [...new Set((conns ?? []).map(c => c.household_id))];
    // O nome do cliente mora em `prospect_name` — não existe coluna `name`, e
    // pedir por ela derrubava a query inteira, deixando tudo "(sem nome)".
    const { data: casas } = await db
      .from('households')
      .select('id, prospect_name, prospect_email, start_month, start_year')
      .in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);

    const porId = new Map((casas ?? []).map(c => [c.id, c]));
    return res.json({
      dica: 'Chame de novo com ?q=<household_id> (e opcionalmente &mes=2026-09)',
      conexoes: (conns ?? []).map(c => ({
        household_id: c.household_id,
        casa: porId.get(c.household_id)?.prospect_name
          ?? porId.get(c.household_id)?.prospect_email
          ?? '(sem nome)',
        inicio_plano: `${porId.get(c.household_id)?.start_month}/${porId.get(c.household_id)?.start_year}`,
        banco: c.bank_name,
        cartao_principal: c.card_last4,
        cartoes: c.cards,
        sincronizado: c.last_synced_at,
      })),
    });
  }

  const { data: conns, error: connErr2 } = await db
    .from('bank_connections')
    .select('id, household_id, bank_name, card_last4, cards, bill_totals, categorize_from, last_synced_at, last_protocol_id, last_protocol_at, needs_resync, card_protocol_id, card_protocol_at, consent_status, account_import_enabled, card_import_enabled, created_at')
    .eq('household_id', busca);
  if (connErr2) return res.status(500).json({ error: connErr2.message, onde: 'buscar conexão do household' });

  const { data: txsRaw, error: txErr } = await db
    .from('bank_transactions')
    .select('id, description, amount, transaction_date, transaction_type, bill_due_date, bill_total, card_last4, installment_current, installment_total, status')
    .eq('household_id', busca)
    .order('transaction_date', { ascending: false })
    .limit(3000);
  if (txErr) return res.status(500).json({ error: txErr.message });

  const txs = (txsRaw ?? []) as Tx[];

  // Agrupa por cartão + mês de vencimento: é assim que a fatura é formada.
  const grupos = new Map<string, Tx[]>();
  for (const t of txs) {
    const mes = (t.bill_due_date ?? '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mes)) continue;
    if (mesFiltro && mes !== mesFiltro) continue;
    const chave = `${t.card_last4 ?? '(sem cartão)'} | ${mes}`;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave)!.push(t);
  }

  const analise = [...grupos.entries()].map(([chave, lista]) => {
    // Mesmo filtro que computeBillTotals usa para formar a fatura.
    const relevantes = lista.filter(t => t.transaction_type !== 'income' && t.transaction_type !== 'ignore');
    const soma = Math.round(relevantes.reduce((a, t) => a + t.amount, 0) * 100) / 100;

    // O banco carimba o total da fatura em cada lançamento dela.
    const declarados = [...new Set(relevantes.map(t => t.bill_total).filter((v): v is number => Number.isFinite(v as number) && (v as number) > 0))];

    // Mesma descrição + mesmo valor + mesma data = candidato a duplicata.
    const vistos = new Map<string, number>();
    for (const t of relevantes) {
      const k = `${t.description}|${t.amount}|${t.transaction_date}`;
      vistos.set(k, (vistos.get(k) ?? 0) + 1);
    }
    const duplicados = [...vistos.entries()]
      .filter(([, n]) => n > 1)
      .map(([k, n]) => ({ lancamento: k, vezes: n }));
    const somaDuplicada = Math.round(
      duplicados.reduce((a, d) => a + Number(d.lancamento.split('|')[1]) * (d.vezes - 1), 0) * 100
    ) / 100;

    return {
      cartao_e_mes: chave,
      lancamentos: relevantes.length,
      soma_dos_lancamentos: soma,
      total_declarado_pelo_banco: declarados.length === 1 ? declarados[0] : declarados,
      diferenca_declarado_menos_soma: declarados.length === 1
        ? Math.round((declarados[0] - soma) * 100) / 100
        : null,
      possiveis_duplicatas: duplicados.length,
      valor_em_duplicatas: somaDuplicada,
      detalhe_duplicatas: duplicados.slice(0, 10),
      ignorados: lista.length - relevantes.length,
      maiores_lancamentos: relevantes
        .slice()
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 8)
        .map(t => ({ desc: t.description, valor: t.amount, data: t.transaction_date, parcela: t.installment_current ? `${t.installment_current}/${t.installment_total}` : null })),
    };
  }).sort((a, b) => a.cartao_e_mes.localeCompare(b.cartao_e_mes));

  // Push: sem aparelho registrado aqui, pushParaCasa() sai em silêncio.
  const { data: devices } = await db
    .from('push_devices')
    .select('onesignal_id, platform, created_at')
    .eq('household_id', busca);

  const idsValidos = (devices ?? []).filter(d => {
    const id = d.onesignal_id as string | null;
    return id && !id.startsWith('apns:');
  });

  /**
   * A LINHA DE FATURA NO PLANO — é ISTO que o cliente vê.
   *
   * `bill_totals` na conexão é a fonte que alimenta a linha, mas o número na
   * tela sai de `finance_items`. Uma vez criada, a linha tem valor próprio:
   * zerar `bill_totals` não a apaga nem a corrige, e foi por isso que a fatura
   * da Renata seguiu errada depois de duas reimportações (2026-09-16).
   */
  const { data: linhasCartao } = await db
    .from('finance_items')
    .select('id, description, category, values, sort_order')
    .eq('household_id', busca)
    .eq('category', 'Cartão de Crédito')
    .order('sort_order', { ascending: true });

  const { data: hhPlano } = await db
    .from('households')
    .select('start_month, start_year')
    .eq('id', busca)
    .maybeSingle();

  const nomesMes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const mesInicio = hhPlano?.start_month ?? 0;
  const anoInicio = hhPlano?.start_year ?? new Date().getFullYear();
  const rotuloDoIndice = (i: number) => {
    const d = new Date(Date.UTC(anoInicio, mesInicio + i, 1));
    return `${nomesMes[d.getUTCMonth()]}/${d.getUTCFullYear()}`;
  };

  const LINHAS_DE_FATURA_NO_PLANO = (linhasCartao ?? []).map(l => {
    const vals = Array.isArray(l.values) ? l.values as number[] : [];
    return {
      linha: l.description,
      por_mes: Object.fromEntries(
        vals.map((v, i) => [rotuloDoIndice(i), v]).filter(([, v]) => Number(v) !== 0),
      ),
    };
  });

  // O que o app realmente usa para mostrar a fatura é o bill_totals gravado.
  // Destacar o mês pedido evita ter de garimpar no JSON inteiro.
  const mesAlvo = mesFiltro || new Date().toISOString().slice(0, 7);
  const faturasDoMes: Array<{ conexao: number; banco: string; cartao: string; valor: number }> = [];
  (conns ?? []).forEach((c, i) => {
    const bt = (c.bill_totals ?? {}) as Record<string, Record<string, number>>;
    for (const [cartao, meses] of Object.entries(bt)) {
      const v = meses?.[mesAlvo];
      if (Number.isFinite(v)) faturasDoMes.push({ conexao: i, banco: c.bank_name, cartao, valor: v });
    }
  });

  // Panorama das transações: sem isto, agrupamento vazio não diz se faltou dado
  // ou se o filtro não pegou nada.
  const porMesVenc = new Map<string, number>();
  let semVencimento = 0;
  for (const t of txs) {
    const mes = (t.bill_due_date ?? '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mes)) { semVencimento++; continue; }
    porMesVenc.set(mes, (porMesVenc.get(mes) ?? 0) + 1);
  }

  return res.json({
    household_id: busca,
    mes_analisado: mesAlvo,
    // É o número que aparece na tela do cliente.
    LINHAS_DE_FATURA_NO_PLANO,
    inicio_do_plano: `${nomesMes[mesInicio]}/${anoInicio}`,
    PUSH: {
      aparelhos_registrados: (devices ?? []).length,
      aparelhos_que_recebem: idsValidos.length,
      // 'apns:...' é registro de reserva: o OneSignal não devolveu id de
      // inscrição, então não dá para disparar para ele.
      so_registro_de_reserva: (devices ?? []).length - idsValidos.length,
      diagnostico: idsValidos.length > 0
        ? 'há aparelho apto — se o push não chega, o problema é no envio ou no OneSignal'
        : (devices ?? []).length > 0
          ? 'aparelho registrado mas SEM id de inscrição do OneSignal: nenhum push sai'
          : 'NENHUM aparelho registrado: o app instalado não entregou o token da APNs',
      detalhe: (devices ?? []).map(d => ({
        plataforma: d.platform,
        tipo: (d.onesignal_id as string ?? '').startsWith('apns:') ? 'reserva (não dispara)' : 'inscrição válida',
        registrado_em: d.created_at,
      })),
    },
    FATURAS_GRAVADAS_NO_MES: faturasDoMes.length
      ? faturasDoMes
      : `nenhuma fatura gravada para ${mesAlvo} — o app cairia na soma dos lançamentos`,
    soma_das_faturas_do_mes: Math.round(faturasDoMes.reduce((a, f) => a + f.valor, 0) * 100) / 100,
    conexoes_com_dados: (conns ?? []).filter(c => Object.keys((c.bill_totals ?? {}) as object).length > 0).length,
    conexoes_vazias: (conns ?? []).filter(c => Object.keys((c.bill_totals ?? {}) as object).length === 0).length,
    transacoes: {
      total: txs.length,
      sem_bill_due_date: semVencimento,
      por_mes_de_vencimento: Object.fromEntries([...porMesVenc.entries()].sort()),
      // Sem isto não dá para saber se as transações são de cartão (deveriam ter
      // vencimento) ou de conta corrente (não têm mesmo).
      por_tipo: Object.fromEntries(
        [...txs.reduce((m, t) => m.set(t.transaction_type ?? 'null', (m.get(t.transaction_type ?? 'null') ?? 0) + 1), new Map<string, number>()).entries()].sort(),
      ),
      por_cartao: Object.fromEntries(
        [...txs.reduce((m, t) => m.set(t.card_last4 ?? '(sem cartão)', (m.get(t.card_last4 ?? '(sem cartão)') ?? 0) + 1), new Map<string, number>()).entries()].sort(),
      ),
      com_bill_total_carimbado: txs.filter(t => Number.isFinite(t.bill_total) && (t.bill_total as number) > 0).length,
      valores_de_bill_total_vistos: [...new Set(txs.map(t => t.bill_total).filter((v): v is number => Number.isFinite(v as number) && (v as number) > 0))].sort((a, b) => b - a).slice(0, 10),

      /**
       * A conta da fatura, aberta: o que o banco DECLAROU contra o que a soma
       * dos lançamentos dá, por cartão e por mês de vencimento.
       *
       * É o que separa "a Technospeed mandou errado" de "nós calculamos errado"
       * — sem isso a investigação fica no chute.
       */
      CONFERENCIA_POR_CARTAO_E_MES: (() => {
        const grupos = new Map<string, { declarados: Set<number>; soma: number; qtd: number }>();
        for (const t of txs) {
          const mes = (t.bill_due_date ?? '').slice(0, 7);
          if (!/^\d{4}-\d{2}$/.test(mes)) continue;
          if (t.transaction_type === 'income' || t.transaction_type === 'ignore') continue;
          const k = `${t.card_last4 ?? '(sem cartão)'} | ${mes}`;
          const g = grupos.get(k) ?? { declarados: new Set<number>(), soma: 0, qtd: 0 };
          g.soma += t.amount;
          g.qtd += 1;
          if (Number.isFinite(t.bill_total) && (t.bill_total as number) > 0) g.declarados.add(t.bill_total as number);
          grupos.set(k, g);
        }
        return [...grupos.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([k, g]) => ({
            cartao_e_mes: k,
            lancamentos: g.qtd,
            soma_dos_lancamentos: Math.round(g.soma * 100) / 100,
            // Mais de um valor aqui = o banco carimbou faturas diferentes no
            // mesmo mês, e aí a escolha de qual usar decide o número final.
            declarado_pelo_banco: [...g.declarados],
            divergencia: g.declarados.size === 1
              ? Math.round(([...g.declarados][0] - g.soma) * 100) / 100
              : null,
          }));
      })(),
      amostra: txs.slice(0, 12).map(t => ({
        desc: t.description,
        valor: t.amount,
        data: t.transaction_date,
        tipo: t.transaction_type,
        cartao: t.card_last4,
        vencimento: t.bill_due_date,
        bill_total: t.bill_total,
        status: t.status,
      })),
    },
    conexoes: (conns ?? []).map(c => {
      const agora = Date.now();
      const horas = (iso: string | null) => iso ? Math.round((agora - new Date(iso).getTime()) / 36e5 * 10) / 10 : null;
      return {
        banco: c.bank_name,
        conectado_ha_horas: horas(c.created_at as string | null),
        // Protocolo pedido mas sincronização mais antiga = dado ainda não chegou.
        SAUDE: {
          consent_status: c.consent_status,
          precisa_resincronizar: c.needs_resync,
          ultima_sincronizacao_ha_horas: horas(c.last_synced_at as string | null),
          protocolo_conta_ha_horas: horas(c.last_protocol_at as string | null),
          protocolo_cartao_ha_horas: horas(c.card_protocol_at as string | null),
          importa_conta: c.account_import_enabled,
          importa_cartao: c.card_import_enabled,
        },
        cartao_principal: c.card_last4,
        cartoes: c.cards,
        // É daqui que sai o valor da fatura que o app mostra.
        bill_totals_gravado: c.bill_totals,
        categorize_from: c.categorize_from,
        sincronizado: c.last_synced_at,
        protocolos: { conta: c.last_protocol_id, cartao: c.card_protocol_id },
      };
    }),
    total_transacoes: txs.length,
    analise_por_cartao_e_mes: analise,
  });
}
