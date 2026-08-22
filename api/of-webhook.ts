import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';

/**
 * Webhook do Extrato Open Finance da Technospeed.
 *
 * Por que existe: quando um banco remove uma transação temporariamente e depois
 * a restabelece, ela volta com um ID NOVO. Sem tratar isso, a mesma compra
 * entraria duas vezes e inflaria o gasto do cliente.
 *
 * Eventos tratados (nomes vindos do guia de reprocessamento deles):
 *   transaction_deleted  → transação sumiu na origem; remover da nossa base
 *   transactions_updated → extrato reprocessado; novas transações disponíveis
 *
 * Os nomes que se CADASTRAM em POST /api/v1/notification são outros:
 * STATEMENT_OPENFINANCE, STATEMENT_OPENFINANCE_PROCESSED e
 * STATEMENT_OPENFINANCE_REVOKED. Ainda não sabemos o formato do corpo desses —
 * por isso eles caem no ramo "evento desconhecido", que responde 200 e grava em
 * `of_webhook_events`. Ao ver o primeiro real, mapear aqui.
 *
 * Segurança: a Technospeed não documenta assinatura HMAC, então o segredo vai
 * no cabeçalho `x-webhook-secret`, comparado em tempo constante. Vai no
 * cabeçalho e não na URL porque URL entra em log de servidor e em histórico de
 * proxy — o campo `headers` do cadastro de notificação existe justamente para
 * isso.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const WEBHOOK_SECRET = process.env.OF_WEBHOOK_SECRET ?? '';

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function secretOk(provided: string): boolean {
  if (!WEBHOOK_SECRET || !provided) return false;
  const a = Buffer.from(WEBHOOK_SECRET);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface WebhookBody {
  event?: string;
  data?: {
    statement_id?: string;
    transaction_ids?: string[];
    message?: string;
    payercpfcnpj?: string;
    accountHash?: string;
    [key: string]: unknown;
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const provided = String(req.headers['x-webhook-secret'] ?? '');
  if (!secretOk(provided)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { event, data } = (req.body ?? {}) as WebhookBody;
    const ids = (data?.transaction_ids ?? []).filter((s): s is string => typeof s === 'string' && !!s);

    // Registrar sempre — o histórico é o que permite auditar uma divergência
    // de saldo depois, e o volume é baixo. Falha no log nunca derruba o evento.
    try {
      await db.from('of_webhook_events').insert({
        event: event ?? 'unknown',
        statement_id: data?.statement_id ?? null,
        transaction_ids: ids,
        message: data?.message ?? null,
        payload: req.body ?? {},
      });
    } catch { /* log é acessório */ }

    if (!event) return res.status(400).json({ error: 'event obrigatório' });

    // ── Transação removida na origem ────────────────────────────────────────
    if (event === 'transaction_deleted') {
      if (ids.length === 0) return res.status(200).json({ ok: true, removed: 0 });

      // Nunca apagamos de verdade: marcar como 'deleted' preserva a
      // categorização que o cliente já fez, caso a transação volte.
      const { data: updated, error } = await db
        .from('bank_transactions')
        .update({ status: 'deleted' })
        .in('transaction_id', ids)
        .select('id');

      if (error) throw error;
      return res.status(200).json({ ok: true, removed: updated?.length ?? 0 });
    }

    // ── Extrato reprocessado: há transações novas ───────────────────────────
    if (event === 'transactions_updated') {
      // Marca as conexões para o próximo cron reimportar. Não sincronizamos
      // aqui: gerar protocolo tem limite de 1 a cada 6 horas e o webhook pode
      // chegar em rajada.
      const { error } = await db
        .from('bank_connections')
        .update({ needs_resync: true })
        .eq('consent_status', 'active');

      if (error) throw error;
      return res.status(200).json({ ok: true, scheduled: true });
    }

    // ── Extrato Open Finance processado: dados do banco chegaram ───────────────
    // Formato real do corpo ainda não confirmado — tratamos o que sabemos e
    // marcamos as conexões para o cron reimportar na próxima janela.
    if (event === 'STATEMENT_OPENFINANCE_PROCESSED' || event === 'STATEMENT_OPENFINANCE') {
      const payerCpf = data?.payercpfcnpj;

      try {
        if (typeof payerCpf === 'string' && payerCpf) {
          await db
            .from('bank_connections')
            .update({ consent_status: 'active', needs_resync: true })
            .eq('payer_cpf', payerCpf)
            .in('consent_status', ['authorized_fetching', 'pending_authorization']);
        } else {
          await db
            .from('bank_connections')
            .update({ needs_resync: true })
            .in('consent_status', ['authorized_fetching', 'pending_authorization']);
        }
      } catch { /* log acessório — não derruba o evento */ }

      return res.status(200).json({ ok: true, event });
    }

    // ── Consentimento revogado pelo banco ou pelo cliente no app do banco ───────
    if (event === 'STATEMENT_OPENFINANCE_REVOKED') {
      const payerCpf = data?.payercpfcnpj;

      if (typeof payerCpf === 'string' && payerCpf) {
        try {
          await db
            .from('bank_connections')
            .update({ consent_status: 'revoked' })
            .eq('payer_cpf', payerCpf)
            .neq('consent_status', 'revoked');
        } catch { /* log acessório */ }
      }

      return res.status(200).json({ ok: true, event });
    }

    // Evento desconhecido: 200 para a Technospeed não ficar reenviando
    return res.status(200).json({ ok: true, ignored: event });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return res.status(500).json({ error: msg });
  }
}
