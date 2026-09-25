import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization ?? '');
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  const clerkUserId = claims.sub;

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: member } = await db
      .from('household_members')
      .select('id, household_id, role')
      .eq('clerk_user_id', clerkUserId)
      .maybeSingle();

    /**
     * Conta compartilhada (Modo Casal): NUNCA apaga o plano.
     *
     * `households` tem ON DELETE CASCADE em finance_items, conexões bancárias,
     * transações, metas e snapshots. Como qualquer membro podia chamar esta
     * rota, o parceiro que excluísse a própria conta levava junto o plano
     * inteiro do outro, sem aviso e sem volta (auditoria de 2026-09-17).
     *
     * Com duas pessoas na casa, excluir a conta passa a significar SAIR: o
     * vínculo e o login desta pessoa somem, o plano fica com quem ficou.
     * Apagar o plano inteiro exige o outro sair antes — ou seja, os dois
     * precisam concordar.
     */
    let modo: 'apagou_tudo' | 'saiu_da_conta_compartilhada' = 'apagou_tudo';

    if (member?.household_id) {
      const { count } = await db
        .from('household_members')
        .select('*', { count: 'exact', head: true })
        .eq('household_id', member.household_id);

      if ((count ?? 1) > 1) {
        modo = 'saiu_da_conta_compartilhada';
        const { error: saiErr } = await db
          .from('household_members')
          .delete()
          .eq('id', member.id);
        if (saiErr) return res.status(500).json({ error: 'Não consegui remover seu vínculo com a conta compartilhada.' });
      } else {
        const { error: delErr } = await db.from('households').delete().eq('id', member.household_id);
        // Falha silenciosa aqui deixava o usuário achando que os dados sumiram.
        if (delErr) return res.status(500).json({ error: 'Não consegui apagar os dados. Nada foi excluído.' });
      }
    }

    // Deleta o usuário no Clerk
    await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    });

    return res.status(200).json({ success: true, modo });
  } catch (err) {
    console.error('delete-account error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
