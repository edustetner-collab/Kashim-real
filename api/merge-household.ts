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

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const MAX_MEMBERS = 2;

/**
 * Une dois households solos em um: move os finance_items do household atual
 * do usuário para o household do convite e reassocia o membro. Chamado quando
 * accept-invite retorna 409 "lançamentos" e o usuário confirma o merge.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });
  const clerkUserId = claims.sub;

  const { token } = req.body as { token?: string };
  if (!token) return res.status(400).json({ error: 'token obrigatório' });

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Valida o convite
  const { data: invite } = await db
    .from('household_invites')
    .select('id, household_id, status')
    .eq('token', token)
    .eq('status', 'pending')
    .maybeSingle();
  if (!invite) return res.status(404).json({ error: 'Convite inválido ou já usado' });

  // Busca o household atual do usuário
  const { data: existing } = await db
    .from('household_members')
    .select('id, household_id')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Usuário sem household' });

  // Idempotente: já está no household de destino
  if (existing.household_id === invite.household_id) {
    await db.from('household_invites').update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', invite.id);
    return res.status(200).json({ householdId: invite.household_id });
  }

  // Verifica capacidade do household de destino
  const { count: destCount } = await db
    .from('household_members')
    .select('*', { count: 'exact', head: true })
    .eq('household_id', invite.household_id);
  if ((destCount ?? 0) >= MAX_MEMBERS) {
    return res.status(409).json({ error: 'Limite de membros atingido' });
  }

  try {
    /**
     * Tudo que é do usuário MUDA de casa antes de a casa velha morrer.
     *
     * `households` tem ON DELETE CASCADE em quase todas essas tabelas. Antes só
     * os `finance_items` eram movidos, então o parceiro que entrava perdia em
     * silêncio as conexões bancárias, as transações ainda por categorizar, a
     * memória dos estabelecimentos, as metas e as dívidas — descobria depois,
     * sem saber por quê (auditoria de 2026-09-17).
     *
     * `teto_columns` vem junto: card repetido dá para apagar na tela, card
     * perdido ninguém recupera.
     */
    const mudarDeCasa = ['finance_items', 'bank_connections', 'bank_transactions',
      'merchant_memories', 'goals', 'debts', 'teto_columns'] as const;
    for (const tabela of mudarDeCasa) {
      const { error } = await db
        .from(tabela)
        .update({ household_id: invite.household_id })
        .eq('household_id', existing.household_id);
      // Tabela que ainda não existe no banco não pode abortar a unificação;
      // erro de verdade, sim — parar aqui preserva a casa antiga com os dados.
      if (error && !/does not exist|schema cache/i.test(error.message ?? '')) throw error;
    }

    // Reassocia o membro
    const { error: memberErr } = await db
      .from('household_members')
      .update({ household_id: invite.household_id, role: 'member' })
      .eq('id', existing.id);
    if (memberErr) throw memberErr;

    // Deleta o household antigo (agora vazio). Se falhar, não faz drama: a
    // casa órfã não aparece para ninguém, e o dado já está no destino.
    const { error: delErr } = await db.from('households').delete().eq('id', existing.household_id);
    if (delErr) console.error('merge-household: casa antiga não foi apagada', delErr);

    // Marca convite como aceito
    await db
      .from('household_invites')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', invite.id);

    return res.status(200).json({ householdId: invite.household_id });
  } catch (err) {
    console.error('merge-household error:', err);
    return res.status(500).json({ error: 'Erro ao unificar contas' });
  }
}
