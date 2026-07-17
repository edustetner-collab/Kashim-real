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
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Assistente (e-mail em admin_users) pode acessar clientes — MENOS perfis
// privados (cadeado, is_private), que são exclusivos do super-admin.
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

// Coluna real do coach é coach_clerk_user_id; coach_user_id fica como
// fallback de schema legado (a query numa coluna inexistente retorna erro,
// que tratamos como "sem linha").
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  const householdId = String(req.query.householdId ?? '');
  if (!householdId) return res.status(400).json({ error: 'householdId obrigatório' });
  if (!(await canAccess(claims.sub, householdId))) return res.status(403).json({ error: 'Sem permissão' });

  const { data, error } = await db
    .from('finance_items')
    .select('*, partial_expenses(*)')
    .eq('household_id', householdId)
    .order('sort_order', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ items: data ?? [] });
}
