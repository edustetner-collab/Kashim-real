import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from './_rateLimit';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

function getUserId(authHeader?: string): string | null {
  const token = (authHeader ?? '').replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { sub?: string; exp?: number };
    if (!payload.sub) return null;
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] ?? 'unknown';
  if (!rateLimit(`check-coach:${ip}`, 30, 60_000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

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
