import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

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
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Autoriza: super-admin, membro da casa, coach com acesso à casa, ou
// assistente (e-mail em admin_users) — exceto perfis privados.
async function canAccess(sub: string, householdId: string): Promise<boolean> {
  if (ADMIN_IDS.includes(sub)) return true;
  const { data: member } = await db
    .from('household_members').select('id')
    .eq('household_id', householdId).eq('clerk_user_id', sub).maybeSingle();
  if (member) return true;
  const { data: coach } = await db
    .from('coach_access').select('id')
    .eq('household_id', householdId).eq('coach_user_id', sub).maybeSingle();
  if (coach) return true;
  try {
    const r = await fetch(`https://api.clerk.com/v1/users/${sub}`, {
      headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });
  const sub = claims.sub;

  try {
    // ── Listar ──────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const householdId = String(req.query.householdId ?? '');
      if (!householdId) return res.status(400).json({ error: 'householdId obrigatório' });
      if (!(await canAccess(sub, householdId))) return res.status(403).json({ error: 'Forbidden' });
      const { data, error } = await db
        .from('debts').select('*')
        .eq('household_id', householdId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ debts: data ?? [] });
    }

    // ── Criar / atualizar ────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { householdId, debt } = req.body as { householdId?: string; debt?: any };
      if (!householdId || !debt) return res.status(400).json({ error: 'householdId e debt obrigatórios' });
      if (!(await canAccess(sub, householdId))) return res.status(403).json({ error: 'Forbidden' });

      const row = {
        household_id: householdId,
        name: String(debt.name ?? ''),
        installment_value: Number(debt.installment_value) || 0,
        installment_count: parseInt(debt.installment_count) || 0,
        payoff_value: Number(debt.payoff_value) || 0,
        interest_rate: debt.interest_rate == null || debt.interest_rate === '' ? null : Number(debt.interest_rate),
        sort_order: parseInt(debt.sort_order) || 0,
      };

      const isUuid = typeof debt.id === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(debt.id);
      if (isUuid) {
        const { data, error } = await db.from('debts').update(row).eq('id', debt.id).eq('household_id', householdId).select('*').single();
        if (error) throw error;
        return res.status(200).json({ debt: data });
      }
      const { data, error } = await db.from('debts').insert(row).select('*').single();
      if (error) throw error;
      return res.status(200).json({ debt: data });
    }

    // ── Excluir ──────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { householdId, id } = req.body as { householdId?: string; id?: string };
      if (!householdId || !id) return res.status(400).json({ error: 'householdId e id obrigatórios' });
      if (!(await canAccess(sub, householdId))) return res.status(403).json({ error: 'Forbidden' });
      const { error } = await db.from('debts').delete().eq('id', id).eq('household_id', householdId);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    console.error('debts error:', err);
    return res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
}
