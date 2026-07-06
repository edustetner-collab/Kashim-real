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

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

const MAX_MEMBERS = 2;

async function getClerkEmail(userId: string): Promise<string | null> {
  try {
    const r = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u.email_addresses?.[0]?.email_address?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/**
 * Aceita um convite de "Modo Casal" com validação server-side.
 * Este é o ÚNICO caminho autorizado para virar membro de um household de
 * outra pessoa — a inserção acontece com a service key e só depois de
 * confirmar que o convite é válido E que o e-mail convidado é o do usuário.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });
  const clerkUserId = claims.sub;

  const { token } = req.body as { token?: string };
  if (!token) return res.status(400).json({ error: 'token obrigatório' });

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Se já é membro de algum household, retorna esse (idempotente)
  const { data: existing } = await db
    .from('household_members')
    .select('household_id')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle();
  if (existing) return res.status(200).json({ householdId: existing.household_id, alreadyMember: true });

  // Busca o convite pendente
  const { data: invite } = await db
    .from('household_invites')
    .select('id, household_id, email, status')
    .eq('token', token)
    .eq('status', 'pending')
    .maybeSingle();
  if (!invite) return res.status(404).json({ error: 'Convite inválido ou já usado' });

  // Confirma que o e-mail convidado é o do usuário autenticado
  const userEmail = await getClerkEmail(clerkUserId);
  if (!userEmail || userEmail !== (invite.email ?? '').toLowerCase()) {
    return res.status(403).json({ error: 'Este convite foi enviado para outro e-mail' });
  }

  // Confirma limite de membros
  const { count } = await db
    .from('household_members')
    .select('*', { count: 'exact', head: true })
    .eq('household_id', invite.household_id);
  if ((count ?? 0) >= MAX_MEMBERS) {
    return res.status(409).json({ error: 'Limite de membros atingido' });
  }

  // Insere a associação (service key → não depende do RLS do cliente)
  const { error: insErr } = await db.from('household_members').insert({
    household_id: invite.household_id,
    clerk_user_id: clerkUserId,
    role: 'member',
  });
  if (insErr) return res.status(500).json({ error: 'Erro ao entrar no household' });

  await db
    .from('household_invites')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', invite.id);

  return res.status(200).json({ householdId: invite.household_id });
}
