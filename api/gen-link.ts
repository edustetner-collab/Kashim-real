import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
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
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const APP_URL = 'https://app.kashim.com.br';

// Aceita super-admin OU assistente (e-mail em admin_users) — liberado
// 2026-07-16 para a assistente gerar link de acesso dos clientes.
async function getStaffId(authHeader: string, db: SupabaseClient): Promise<string | null> {
  const claims = verifyAuthToken(authHeader);
  if (!claims) return null;
  if (ADMIN_IDS.includes(claims.sub)) return claims.sub;
  try {
    const r = await fetch(`https://api.clerk.com/v1/users/${claims.sub}`, {
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    });
    if (!r.ok) return null;
    const u = await r.json() as { email_addresses?: Array<{ email_address: string }> };
    const email = (u.email_addresses?.[0]?.email_address ?? '').toLowerCase();
    if (!email) return null;
    const { data } = await db.from('admin_users').select('id').eq('email', email).maybeSingle();
    return data ? claims.sub : null;
  } catch {
    return null;
  }
}

async function shortenUrl(longUrl: string): Promise<string> {
  try {
    const r = await fetch(`https://is.gd/create.php?format=json&url=${encodeURIComponent(longUrl)}`);
    if (!r.ok) return longUrl;
    const data = await r.json();
    return data.shorturl ?? longUrl;
  } catch {
    return longUrl;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const requesterId = await getStaffId(req.headers.authorization ?? '', db);
  if (!requesterId) return res.status(403).json({ error: 'Forbidden' });

  try {
    const { householdId } = req.body;
    if (!householdId) return res.status(400).json({ error: 'householdId required' });

    const { data: member } = await db
      .from('household_members')
      .select('clerk_user_id')
      .eq('household_id', householdId)
      .single();

    if (!member?.clerk_user_id) return res.status(404).json({ error: 'Cliente não encontrado' });

    const tokenRes = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLERK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: member.clerk_user_id,
        expires_in_seconds: 7 * 24 * 60 * 60,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.json();
      return res.status(400).json({ error: err.errors?.[0]?.message ?? 'Erro ao gerar link' });
    }

    const tokenData = await tokenRes.json();
    const token: string | null = tokenData.token ?? null;
    let signInUrl: string | null = null;
    if (token) {
      const longUrl = `${APP_URL}?sign_in_token=${token}`;
      signInUrl = await shortenUrl(longUrl);
    }
    return res.status(200).json({ signInUrl });
  } catch (err: any) {
    console.error('gen-link error:', err);
    return res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
}
