import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

/**
 * Liga e desliga o e-mail de "chegaram gastos novos".
 *
 * A preferência precisa viver no BANCO, não no aparelho: quem envia é o cron,
 * que não enxerga o localStorage. O push continua sendo controlado pelo
 * registro do aparelho (`api/push-register`) — são dois canais diferentes, e o
 * cliente pode querer só um (Eduardo, 2026-09-23: "fiquei insatisfeito com a
 * quantidade de e-mails do Kashim na minha caixa").
 */

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';

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
  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  if (req.method === 'GET') {
    const { data } = await db
      .from('user_preferences')
      .select('email_transacoes')
      .eq('clerk_user_id', claims.sub)
      .maybeSingle();
    // Sem linha ainda = recebe, que é o padrão de quem nunca mexeu.
    return res.status(200).json({ ligado: data?.email_transacoes !== false });
  }

  if (req.method === 'POST') {
    const { ligado } = req.body as { ligado?: boolean };
    const { error } = await db.from('user_preferences').upsert({
      clerk_user_id: claims.sub,
      email_transacoes: ligado !== false,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'clerk_user_id' });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ligado: ligado !== false });
  }

  return res.status(405).json({ error: 'method not allowed' });
}
