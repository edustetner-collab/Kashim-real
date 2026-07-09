import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';

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
    if (typeof claims.exp === 'number' && claims.exp < Math.floor(Date.now() / 1000)) return null;
    return { sub: claims.sub };
  } catch {
    return null;
  }
}

/**
 * Cria (ou retorna) o household do usuário logado usando a service key, que
 * ignora o RLS. Necessário porque o cliente não tem permissão de INSERT em
 * households — mover isto pro servidor destrava o cadastro de usuário novo.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });
  const clerkUserId = claims.sub;

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Já é membro de algum household? Retorna esse.
  const { data: membership } = await db
    .from('household_members')
    .select('household_id')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle();
  if (membership) return res.status(200).json({ householdId: membership.household_id });

  // Cria o household
  const { data: household, error: hhError } = await db
    .from('households')
    .insert({ start_month: new Date().getMonth(), start_year: new Date().getFullYear() })
    .select('id')
    .single();
  if (hhError || !household) {
    return res.status(500).json({ error: `households.insert: ${hhError?.message ?? 'sem dados'}` });
  }

  // Associa o usuário como owner
  const { error: memberError } = await db.from('household_members').insert({
    household_id: household.id,
    clerk_user_id: clerkUserId,
    role: 'owner',
  });
  if (memberError) {
    // Corrida: uma requisição simultânea (ex.: app aberto em 2 abas logo após o
    // signup) já criou a membership deste usuário. A UNIQUE constraint em
    // household_members.clerk_user_id barra o segundo insert (código 23505).
    // Recupera o household que venceu a corrida e descarta o órfão recém-criado.
    const { data: winner } = await db
      .from('household_members')
      .select('household_id')
      .eq('clerk_user_id', clerkUserId)
      .maybeSingle();
    if (winner) {
      await db.from('households').delete().eq('id', household.id);
      return res.status(200).json({ householdId: winner.household_id });
    }
    return res.status(500).json({ error: `household_members.insert: ${memberError.message}` });
  }

  return res.status(200).json({ householdId: household.id });
}
