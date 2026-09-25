import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// Lista as assistentes cadastradas — só para o super-admin.
//
// A tela de Equipe lia `admin_users` direto pelo cliente e recebia lista vazia
// desde que a tabela foi revogada para authenticated (lock-admin-users.sql).
// A leitura passa a ser aqui, com service key e portão de super-admin.

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

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
  if (!ADMIN_IDS.includes(claims.sub)) return res.status(403).json({ error: 'Forbidden' });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase não configurado' });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data, error } = await db
    .from('admin_users')
    .select('id, email, name, created_at')
    .order('created_at');

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ assistants: data ?? [] });
}
