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

function getUserId(authHeader?: string): string | null {
  return verifyAuthToken(authHeader)?.sub ?? null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const userId = getUserId(req.headers.authorization as string);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { householdId } = req.query as { householdId?: string };
  if (!householdId) return res.status(400).json({ error: 'householdId required' });

  // Confirm user belongs to this household
  const { data: member } = await supabase
    .from('household_members')
    .select('id')
    .eq('household_id', householdId)
    .eq('clerk_user_id', userId)
    .maybeSingle();

  if (!member) return res.status(403).json({ error: 'Forbidden' });

  // Query coach_access — handle both column naming conventions
  const { data: access } = await supabase
    .from('coach_access')
    .select('expires_at, coaching_ends_at, status')
    .eq('household_id', householdId)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const expiresAt = access?.expires_at ?? access?.coaching_ends_at ?? null;
  const hasCoach = !!access;
  const expired = expiresAt ? new Date(expiresAt) < new Date() : false;

  return res.status(200).json({ hasCoach, expired, expiresAt });
}
