import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Marca "o cliente mexeu no app agora" em households.last_active_at. Chamado na
// abertura do app (fire-and-forget). É a base do push de reengajamento: sem
// saber a última atividade, não dá para acordar quem sumiu há 3 dias.
//
// O cliente não pode escrever em households (UPDATE revogado na blindagem de
// segurança), então a gravação passa por aqui com a service key.

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

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { data: membership } = await db
      .from('household_members')
      .select('household_id')
      .eq('clerk_user_id', claims.sub)
      .maybeSingle();

    if (!membership) return res.status(200).json({ ok: true }); // sem household ainda: nada a marcar

    await db
      .from('households')
      .update({ last_active_at: new Date().toISOString() })
      .eq('id', membership.household_id);

    return res.status(200).json({ ok: true });
  } catch {
    // Heartbeat é acessório: nunca falha de um jeito que atrapalhe o app.
    return res.status(200).json({ ok: true });
  }
}
