import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * GRAVAÇÃO do consultor e da assistente, com service key.
 *
 * Por que existe: LER já passava pelo servidor (`load-finance-items.ts`), que
 * autoriza a assistente pelo e-mail em `admin_users`. GRAVAR ia direto ao
 * Supabase com o token dela, e o RLS de `finance_items` exige uma linha em
 * `coach_access` com o id dela — que só existe nos clientes que ela mesma
 * criou. Nos demais a gravação era recusada, o `catch` do salvamento
 * automático mandava o erro para o console e a tela não dizia nada.
 *
 * O resultado: a assistente do Eduardo preencheu o plano de dois clientes
 * (Ivan e Pedro Ivo), saiu da tela, voltou, e não havia nada (2026-09-25).
 * Uma hora de trabalho perdida em silêncio.
 *
 * A regra de acesso é a MESMA da leitura, de propósito — inclusive o perfil
 * privado (`is_private`), que continua exclusivo do super-admin. Quem lê pode
 * gravar; quem não lê não grava.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? '';
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// A Vercel não empacota import local em `api/` — por isso esta cópia.
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
    if (!String(claims.sub).startsWith('user_')) return null;
    if (typeof claims.exp === 'number' && claims.exp < Math.floor(Date.now() / 1000)) return null;
    return { sub: claims.sub };
  } catch {
    return null;
  }
}

/** Assistente: e-mail em `admin_users`, e nunca em perfil privado. */
async function isAssistantAllowed(sub: string, householdId: string): Promise<boolean> {
  try {
    const r = await fetch(`https://api.clerk.com/v1/users/${sub}`, {
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    });
    if (!r.ok) return false;
    const u = await r.json() as { email_addresses?: Array<{ email_address: string }> };
    const email = (u.email_addresses?.[0]?.email_address ?? '').toLowerCase();
    if (!email) return false;
    const { data: assistant } = await db.from('admin_users').select('id').eq('email', email).maybeSingle();
    if (!assistant) return false;
    const { data: hh } = await db.from('households').select('is_private').eq('id', householdId).maybeSingle();
    return !hh?.is_private;
  } catch {
    return false;
  }
}

async function hasCoachRow(sub: string, householdId: string): Promise<boolean> {
  const { data: c1 } = await db
    .from('coach_access').select('id')
    .eq('household_id', householdId).eq('coach_clerk_user_id', sub).maybeSingle();
  if (c1) return true;
  const { data: c2 } = await db
    .from('coach_access').select('id')
    .eq('household_id', householdId).eq('coach_user_id', sub).maybeSingle();
  return !!c2;
}

async function canAccess(sub: string, householdId: string): Promise<boolean> {
  if (ADMIN_IDS.includes(sub)) return true;
  const { data: member } = await db
    .from('household_members').select('id')
    .eq('household_id', householdId).eq('clerk_user_id', sub).maybeSingle();
  if (member) return true;
  if (await hasCoachRow(sub, householdId)) return true;
  return isAssistantAllowed(sub, householdId);
}

/** O lançamento não tem household_id: o vínculo é pela linha do plano. */
async function casaDoLancamento(financeItemId: string): Promise<string | null> {
  const { data } = await db
    .from('finance_items').select('household_id').eq('id', financeItemId).maybeSingle();
  return (data?.household_id as string) ?? null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  const { acao, householdId, row, financeItemId, partial, id } = req.body as {
    acao?: 'item' | 'item_delete' | 'partial_add' | 'partial_delete';
    householdId?: string;
    /** Linha de `finance_items` já no formato do banco (financeItemToRow). */
    row?: Record<string, unknown>;
    financeItemId?: string;
    partial?: Record<string, unknown>;
    id?: string;
  };

  try {
    if (acao === 'item') {
      if (!householdId || !row) return res.status(400).json({ error: 'householdId e row obrigatórios' });
      if (!(await canAccess(claims.sub, householdId))) return res.status(403).json({ error: 'Sem permissão' });
      // A casa vem do SERVIDOR, não do corpo: assim ninguém grava numa casa
      // diferente da que acabou de ser autorizada.
      const payload = { ...row, household_id: householdId };
      const { data, error } = await db
        .from('finance_items').upsert(payload).select('id').single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ id: data?.id });
    }

    if (acao === 'item_delete') {
      if (!id) return res.status(400).json({ error: 'id obrigatório' });
      const casa = await casaDoLancamento(id);
      if (!casa) return res.status(200).json({ ok: true, motivo: 'linha já não existe' });
      if (!(await canAccess(claims.sub, casa))) return res.status(403).json({ error: 'Sem permissão' });
      const { error } = await db.from('finance_items').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (acao === 'partial_add') {
      if (!financeItemId || !partial) return res.status(400).json({ error: 'financeItemId e partial obrigatórios' });
      const casa = await casaDoLancamento(financeItemId);
      if (!casa) return res.status(400).json({ error: 'linha do plano não encontrada' });
      if (!(await canAccess(claims.sub, casa))) return res.status(403).json({ error: 'Sem permissão' });
      const { error } = await db.from('partial_expenses')
        .insert({ ...partial, finance_item_id: financeItemId });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (acao === 'partial_delete') {
      if (!id) return res.status(400).json({ error: 'id obrigatório' });
      const { data: pe } = await db
        .from('partial_expenses').select('finance_item_id').eq('id', id).maybeSingle();
      if (!pe) return res.status(200).json({ ok: true, motivo: 'lançamento já não existe' });
      const casa = await casaDoLancamento(pe.finance_item_id as string);
      if (!casa || !(await canAccess(claims.sub, casa))) return res.status(403).json({ error: 'Sem permissão' });
      const { error } = await db.from('partial_expenses').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'ação inválida' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return res.status(500).json({ error: msg });
  }
}
