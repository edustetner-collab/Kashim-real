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

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization as string);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });
  const userId = claims.sub;

  const { householdId } = req.query as { householdId?: string };
  if (!householdId) return res.status(400).json({ error: 'householdId required' });

  const isAdmin = ADMIN_IDS.includes(userId);

  // Admins podem checar qualquer household (usam quando visualizam clientes).
  // Não-admins precisam ser membros do household.
  if (!isAdmin) {
    const { data: member } = await supabase
      .from('household_members')
      .select('id')
      .eq('household_id', householdId)
      .eq('clerk_user_id', userId)
      .maybeSingle();
    if (!member) return res.status(403).json({ error: 'Forbidden' });
  }

  // Busca TODOS os registros de coach_access para este household (qualquer status)
  // → isCoachClient: household já esteve sob algum coach = merece trial estendido
  const { data: allAccess } = await supabase
    .from('coach_access')
    .select('expires_at, coaching_ends_at, status')
    .eq('household_id', householdId)
    .order('created_at', { ascending: false })
    .limit(10);

  const records = allAccess ?? [];

  // isCoachClient: teve relação de coaching em qualquer status (inclusive antigos)
  const isCoachClient = records.length > 0;

  // hasCoach / expired: baseado no registro 'approved' mais recente
  const approvedRecord = records.find(r => r.status === 'approved') ?? null;
  const coachingEndsAt = approvedRecord?.coaching_ends_at ?? approvedRecord?.expires_at ?? null;
  const hasCoach = !!approvedRecord;
  // expired = data de fim passou. Se coaching_ends_at é null, nunca expira (legacy).
  const expired = coachingEndsAt ? new Date(coachingEndsAt) < new Date() : false;

  return res.status(200).json({ hasCoach, expired, coachingEndsAt, isCoachClient });
}
