import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Vercel não empacota import local em `api/` — por isso o verifyAuthToken vive
// colado em cada rota. Ver CLAUDE.md.

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

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');

  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  // ── DELETE — o cliente desligou o push ou saiu deste aparelho ──────────────
  if (req.method === 'DELETE') {
    const { onesignalId } = req.body as { onesignalId?: string };
    if (!onesignalId) return res.status(400).json({ error: 'onesignalId obrigatório' });
    await db.from('push_devices').delete()
      .eq('clerk_user_id', claims.sub).eq('onesignal_id', onesignalId);
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { householdId, onesignalId, platform } = req.body as {
    householdId?: string; onesignalId?: string; platform?: string;
  };
  if (!onesignalId) return res.status(400).json({ error: 'onesignalId obrigatório' });

  /**
   * O household vem do BANCO, não do corpo do pedido.
   *
   * Confiar no `householdId` que o cliente manda deixaria qualquer um se
   * inscrever para receber os avisos de outra família. O que o token prova é
   * quem a pessoa é; a casa dela nós olhamos aqui.
   */
  const { data: membro } = await db
    .from('household_members')
    .select('household_id')
    .eq('clerk_user_id', claims.sub)
    .maybeSingle();

  const casa = membro?.household_id ?? null;
  if (householdId && casa && householdId !== casa) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { error } = await db.from('push_devices').upsert({
    clerk_user_id: claims.sub,
    household_id: casa,
    onesignal_id: onesignalId,
    platform: platform ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'clerk_user_id,onesignal_id' });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}
