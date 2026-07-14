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
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

// Remove uma assistente: só o super-admin pode. Apaga a linha em admin_users
// (service key — o cliente não tem permissão, por isso o botão falhava) e
// revoga qualquer convite pendente no Clerk, para permitir um recadastro limpo.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims || !ADMIN_IDS.includes(claims.sub)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { id, email } = req.body as { id?: string; email?: string };
  if (!id && !email) return res.status(400).json({ error: 'id ou email obrigatório' });

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    if (id) {
      const { error } = await db.from('admin_users').delete().eq('id', id);
      if (error) throw error;
    } else if (email) {
      const { error } = await db.from('admin_users').delete().eq('email', email.toLowerCase().trim());
      if (error) throw error;
    }

    // Limpa o estado no Clerk para permitir um recadastro 100% limpo:
    // (1) revoga convites pendentes; (2) APAGA a conta Clerk dela, se existir —
    // é isso que destrava o "já tem conta" sem link. Assistente não tem dados
    // próprios, então apagar a conta de login é seguro. Tudo best-effort.
    if (email) {
      const clean = email.toLowerCase().trim();
      const headers = { Authorization: `Bearer ${CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' };

      // (1) Revoga convites pendentes
      try {
        const listRes = await fetch('https://api.clerk.com/v1/invitations?status=pending&limit=100', { headers });
        if (listRes.ok) {
          const list = await listRes.json();
          const arr: any[] = Array.isArray(list) ? list : (list.data ?? []);
          const pending = arr.filter(i => (i.email_address ?? '').toLowerCase() === clean);
          for (const inv of pending) {
            await fetch(`https://api.clerk.com/v1/invitations/${inv.id}/revoke`, { method: 'POST', headers }).catch(() => {});
          }
        }
      } catch { /* best-effort */ }

      // (2) Apaga a conta Clerk existente (se houver)
      try {
        const usersRes = await fetch(
          `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(clean)}`,
          { headers }
        );
        if (usersRes.ok) {
          const users = await usersRes.json();
          const arr: any[] = Array.isArray(users) ? users : (users.data ?? []);
          for (const u of arr) {
            if (u?.id) {
              await fetch(`https://api.clerk.com/v1/users/${u.id}`, { method: 'DELETE', headers }).catch(() => {});
            }
          }
        }
      } catch { /* best-effort */ }
    }

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('remove-assistant error:', err);
    return res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
}
