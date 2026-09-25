import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// Diz se o usuário logado é staff (assistente cadastrada em admin_users).
//
// Existe porque `admin_users` é a lista de quem tem poder de staff e, por isso,
// está revogada para anon/authenticated (docs/sql/lock-admin-users.sql). O
// frontend consultava a tabela direto e levava 42501 em toda sessão — ruído que
// parecia falha de permissão do usuário. A checagem passa a ser aqui, com
// service key, e o cliente só recebe um booleano.

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? '';

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
    // Só token do CLERK. O mesmo segredo assina os tokens do GoTrue do
    // Supabase: sem esta linha, um cadastro direto no Supabase entraria como
    // usuário do app (revisão de segurança, 2026-09-24).
    if (!String(claims.sub).startsWith('user_')) return null;
    if (typeof claims.exp === 'number' && claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization ?? '');
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !CLERK_SECRET_KEY) {
    return res.json({ isStaff: false });
  }

  try {
    // O e-mail vem do Clerk pelo sub do token, nunca do corpo da requisição:
    // aceitar e-mail do cliente deixaria qualquer um se declarar staff.
    const r = await fetch(`https://api.clerk.com/v1/users/${claims.sub}`, {
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    });
    if (!r.ok) return res.json({ isStaff: false });

    const u = await r.json() as { email_addresses?: Array<{ email_address?: string }> };
    const emails = (u.email_addresses ?? [])
      .map(e => (e.email_address ?? '').toLowerCase().trim())
      .filter(Boolean);
    if (emails.length === 0) return res.json({ isStaff: false });

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data } = await db
      .from('admin_users')
      .select('id')
      .in('email', emails)
      .maybeSingle();

    return res.json({ isStaff: !!data });
  } catch {
    return res.json({ isStaff: false });
  }
}
