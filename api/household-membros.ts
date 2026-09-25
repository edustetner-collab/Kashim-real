import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

/**
 * Quem está nesta conta.
 *
 * O Modo Casal mostrava só que a conta era compartilhada, sem dizer COM QUEM —
 * o cliente via "conta conjunta" e não sabia se o convite tinha ido para o
 * e-mail certo (Eduardo, 2026-09-20).
 *
 * O nome e o e-mail moram no Clerk; o vínculo, no Supabase. Por isso a junção
 * acontece aqui, no servidor, e não na tela.
 */

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
    const [h, p, sig] = parts;
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    if (header.alg !== 'HS256') return null;
    const expected = createHmac('sha256', SUPABASE_JWT_SECRET).update(`${h}.${p}`).digest();
    const provided = Buffer.from(sig, 'base64url');
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
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  const householdId = req.query.householdId as string | undefined;
  if (!householdId) return res.status(400).json({ error: 'householdId obrigatório' });

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: membros } = await db
    .from('household_members')
    .select('clerk_user_id, role')
    .eq('household_id', householdId);

  // Só quem é da casa vê quem mais está nela.
  const souDaCasa = (membros ?? []).some(m => m.clerk_user_id === claims.sub);
  if (!souDaCasa) return res.status(403).json({ error: 'Forbidden' });

  const pessoas = await Promise.all((membros ?? []).map(async (m) => {
    const uid = m.clerk_user_id as string;
    let nome = '';
    let email = '';
    try {
      const r = await fetch(`https://api.clerk.com/v1/users/${uid}`, {
        headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
      });
      if (r.ok) {
        const u = await r.json() as {
          first_name?: string; last_name?: string;
          email_addresses?: Array<{ email_address?: string }>;
        };
        nome = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
        email = u.email_addresses?.[0]?.email_address ?? '';
      }
    } catch { /* sem o Clerk, devolve o vínculo sem nome */ }
    return {
      clerkUserId: uid,
      papel: m.role === 'owner' ? 'dono' : 'parceiro',
      nome: nome || null,
      email: email || null,
      ehVoce: uid === claims.sub,
    };
  }));

  // Convite ainda não aceito: é o que explica "somos dois mas só apareço eu".
  const { data: convites } = await db
    .from('household_invites')
    .select('email, status, created_at')
    .eq('household_id', householdId)
    .eq('status', 'pending');

  return res.status(200).json({
    membros: pessoas,
    convitesPendentes: (convites ?? []).map(c => ({ email: c.email, enviadoEm: c.created_at })),
  });
}
