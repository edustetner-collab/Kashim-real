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

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

const MAX_MEMBERS = 2;

/**
 * Aceita um convite de "Modo Casal" com validação server-side.
 * Este é o ÚNICO caminho autorizado para virar membro de um household de
 * outra pessoa — tudo acontece com a service key.
 *
 * SEGURANÇA (decisão 2026-07-27): a autorização é por POSSE DO TOKEN. O token
 * tem 256 bits (dois UUIDs), é imprevisível e o próprio dono do plano o envia
 * em privado ao parceiro. A exigência anterior de e-mail idêntico ao do convite
 * foi REMOVIDA porque quebrava o uso real (o parceiro quase sempre se cadastra
 * com um e-mail diferente do que foi digitado) — era a causa nº 1 do "modo
 * casal não funciona". O limite de 2 membros e o convite poder ser cancelado
 * pelo dono continuam sendo as travas. Modelo idêntico ao "qualquer um com o
 * link entra" de convites de produtos como Notion/Figma.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });
  const clerkUserId = claims.sub;

  const { token } = req.body as { token?: string };
  if (!token) return res.status(400).json({ error: 'token obrigatório' });

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Busca o convite pendente PRIMEIRO — precisamos do household de destino antes
  // de decidir o que fazer com uma associação existente.
  const { data: invite } = await db
    .from('household_invites')
    .select('id, household_id, status')
    .eq('token', token)
    .eq('status', 'pending')
    .maybeSingle();
  if (!invite) return res.status(404).json({ error: 'Convite inválido ou já usado' });

  const markAccepted = async () => {
    await db
      .from('household_invites')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', invite.id);
  };

  // Quantos membros o household de destino já tem?
  const destCount = async (): Promise<number> => {
    const { count } = await db
      .from('household_members')
      .select('*', { count: 'exact', head: true })
      .eq('household_id', invite.household_id);
    return count ?? 0;
  };

  // Já é membro de algum household?
  const { data: existing } = await db
    .from('household_members')
    .select('id, household_id')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle();

  if (existing) {
    // Já está no household certo → idempotente.
    if (existing.household_id === invite.household_id) {
      await markAccepted();
      return res.status(200).json({ householdId: invite.household_id, alreadyMember: true });
    }

    // Está em OUTRO household. Se compartilha com mais alguém, não mexemos —
    // ele já faz parte de outra conta de casal.
    const { count: ownCount } = await db
      .from('household_members')
      .select('*', { count: 'exact', head: true })
      .eq('household_id', existing.household_id);
    if ((ownCount ?? 0) > 1) {
      return res.status(409).json({ error: 'Você já faz parte de outra conta compartilhada. Saia dela antes de entrar em outra.' });
    }

    // Household SOLO (só ele): candidato a mover para o household do convite.
    // É o caso dos clientes que ficaram "presos" numa conta solo criada por
    // engano. MAS só movemos se a conta solo estiver VAZIA — se tiver qualquer
    // lançamento, mover orfanaria dados reais (lição dura de perda de dados do
    // projeto). Nesse caso, barra e orienta a falar com o suporte.
    const { data: soloItems } = await db
      .from('finance_items')
      .select('values')
      .eq('household_id', existing.household_id);
    const hasData = (soloItems ?? []).some(
      (r: { values: number[] | null }) => Array.isArray(r.values) && r.values.some(v => (v ?? 0) > 0)
    );
    if (hasData) {
      return res.status(409).json({
        error: 'Você já tem lançamentos na sua conta. Para unir com a conta do seu parceiro sem perder dados, fale com o suporte.',
      });
    }

    if ((await destCount()) >= MAX_MEMBERS) {
      return res.status(409).json({ error: 'Limite de membros atingido' });
    }
    const { error: mvErr } = await db
      .from('household_members')
      .update({ household_id: invite.household_id, role: 'member' })
      .eq('id', existing.id);
    if (mvErr) return res.status(500).json({ error: 'Erro ao entrar na conta compartilhada' });
    await markAccepted();
    return res.status(200).json({ householdId: invite.household_id, moved: true });
  }

  // Não é membro de nada ainda: entra direto.
  if ((await destCount()) >= MAX_MEMBERS) {
    return res.status(409).json({ error: 'Limite de membros atingido' });
  }
  const { error: insErr } = await db.from('household_members').insert({
    household_id: invite.household_id,
    clerk_user_id: clerkUserId,
    role: 'member',
  });
  if (insErr) {
    // Corrida: aceite simultâneo já vinculou este usuário (UNIQUE em
    // clerk_user_id barra o 2º insert). Idempotente: devolve o household atual.
    const { data: joined } = await db
      .from('household_members')
      .select('household_id')
      .eq('clerk_user_id', clerkUserId)
      .maybeSingle();
    if (joined) return res.status(200).json({ householdId: joined.household_id, alreadyMember: true });
    return res.status(500).json({ error: 'Erro ao entrar no household' });
  }

  await markAccepted();
  return res.status(200).json({ householdId: invite.household_id });
}
