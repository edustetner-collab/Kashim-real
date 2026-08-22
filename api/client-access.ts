import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Controle de acesso de um cliente, pelo painel do coach.
 *
 * Duas ações que não existiam em lugar nenhum:
 *   revoke    — encerra o vínculo com um cliente que já terminou a consultoria
 *   reactivate — concede N dias extras depois dos 5 meses vencidos
 *
 * Só o coach dono do cliente (ou admin) pode chamar.
 */

// ─── Auth (duplicado por rota: Vercel não empacota import local em api/) ─────

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

/** Teto por concessão: ~2 anos. Evita que um erro de digitação vire acesso eterno. */
const MAX_REACTIVATION_DAYS = 730;

/** Regra do Eduardo: todo cliente tem 5 meses contados do primeiro acesso. */
const PLAN_MONTHS = 5;

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * Prazo devido a um cliente: 5 meses a partir do primeiro acesso.
 * Sem `first_access_at` o relógio ainda não começou — conta de agora, nunca de
 * `created_at`, senão um perfil criado em janeiro e aberto em junho já nasce
 * com metade do prazo gasto.
 */
function prazoDevido(hh: { first_access_at?: string | null }): Date {
  const base = hh.first_access_at ? new Date(hh.first_access_at) : new Date();
  return addMonths(base, PLAN_MONTHS);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });
  const sub = claims.sub;

  const { householdId, action, days } = req.body as {
    householdId?: string;
    action?: 'revoke' | 'reactivate' | 'regularize-all';
    /** Dias de acesso extra a conceder, contados a partir de agora. */
    days?: number;
  };

  if (!action) return res.status(400).json({ error: 'action obrigatório' });
  if (action !== 'revoke' && action !== 'reactivate' && action !== 'regularize-all') {
    return res.status(400).json({ error: 'action inválida' });
  }
  if (action !== 'regularize-all' && !householdId) {
    return res.status(400).json({ error: 'householdId obrigatório' });
  }

  try {
    // Autorização: admin, ou o coach que tem registro para este household.
    const isAdmin = ADMIN_IDS.includes(sub);

    // ── regularize-all: dá a todo mundo o prazo devido (5 meses do 1º acesso) ──
    // É a régua da casa aplicada de uma vez, para ninguém ficar preso num
    // relógio de 30 dias por causa de vínculo que não gravou direito.
    // Só ESTENDE: quem já tem prazo maior não é tocado.
    if (action === 'regularize-all') {
      if (!isAdmin) return res.status(403).json({ error: 'Forbidden' });

      const { data: hhs, error: readErr } = await db
        .from('households')
        .select('id, first_access_at, access_until, subscription_status');
      if (readErr) throw readErr;

      const agora = Date.now();
      let atualizados = 0;
      for (const hh of hhs ?? []) {
        if (hh.subscription_status === 'active') continue; // pagante não precisa
        const devido = prazoDevido(hh);
        const atual = hh.access_until ? new Date(hh.access_until).getTime() : 0;
        if (devido.getTime() <= atual || devido.getTime() <= agora) continue;
        const { error } = await db
          .from('households')
          .update({ access_until: devido.toISOString() })
          .eq('id', hh.id);
        if (!error) atualizados++;
      }

      return res.status(200).json({ ok: true, action, atualizados, total: (hhs ?? []).length });
    }

    if (!isAdmin) {
      const { data: own } = await db
        .from('coach_access')
        .select('id')
        .eq('household_id', householdId)
        .eq('coach_clerk_user_id', sub)
        .maybeSingle();
      if (!own) return res.status(403).json({ error: 'Forbidden' });
    }

    if (action === 'revoke') {
      // Encerra apenas o VÍNCULO do coach: ele sai da conta do cliente porque
      // a consultoria acabou. O prazo do cliente NÃO é tocado aqui — os 5 meses
      // contam do `first_access_at` dele e seguem correndo do mesmo jeito.
      // Revogar não reinicia, não adia e não encurta nada.
      const { error } = await db
        .from('coach_access')
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('household_id', householdId)
        .eq('status', 'approved');
      if (error) throw error;

      return res.status(200).json({ ok: true, action: 'revoke' });
    }

    // reactivate — devolve acesso por N dias a partir de agora.
    // Conta de HOJE, não do vencimento: se o prazo venceu há dois meses,
    // "30 dias" tem que ser 30 dias úteis de app, não 30 dias já queimados.
    const n = Math.min(Math.max(1, Math.floor(Number(days) || 30)), MAX_REACTIVATION_DAYS);
    const until = addDays(new Date(), n).toISOString();

    const { error } = await db
      .from('households')
      .update({ access_until: until })
      .eq('id', householdId);
    if (error) throw error;

    return res.status(200).json({ ok: true, action: 'reactivate', days: n, accessUntil: until });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return res.status(500).json({ error: msg });
  }
}
