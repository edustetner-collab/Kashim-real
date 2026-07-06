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
function verifyAdminToken(authHeader?: string): string | null {
  const claims = verifyAuthToken(authHeader);
  if (!claims) return null;
  const adminIds = (process.env.ADMIN_USER_IDS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return adminIds.includes(claims.sub) ? claims.sub : null;
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

function getSuperAdminId(authHeader: string): string | null {
  return verifyAdminToken(authHeader);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const requesterId = getSuperAdminId(req.headers.authorization ?? '');
  if (!requesterId) return res.status(403).json({ error: 'Forbidden' });

  const { householdId, isPrivate } = req.body;
  if (!householdId || typeof isPrivate !== 'boolean') {
    return res.status(400).json({ error: 'householdId e isPrivate são obrigatórios' });
  }

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { error } = await db
      .from('households')
      .update({ is_private: isPrivate })
      .eq('id', householdId);

    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('toggle-privacy error:', err);
    return res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
}
