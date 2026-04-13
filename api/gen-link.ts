import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

function getAdminId(authHeader: string): string | null {
  const token = (authHeader ?? '').replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    const userId: string = payload.sub;
    if (!userId || !ADMIN_IDS.includes(userId)) return null;
    return userId;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const requesterId = getAdminId(req.headers.authorization ?? '');
  if (!requesterId) return res.status(403).json({ error: 'Forbidden' });

  try {
    const { householdId } = req.body;
    if (!householdId) return res.status(400).json({ error: 'householdId required' });

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: member } = await db
      .from('household_members')
      .select('clerk_user_id')
      .eq('household_id', householdId)
      .single();

    if (!member?.clerk_user_id) return res.status(404).json({ error: 'Cliente não encontrado' });

    const tokenRes = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLERK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: member.clerk_user_id,
        expires_in_seconds: 7 * 24 * 60 * 60,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.json();
      return res.status(400).json({ error: err.errors?.[0]?.message ?? 'Erro ao gerar link' });
    }

    const tokenData = await tokenRes.json();
    const APP_URL = 'https://kashim-gilt.vercel.app';
    const rawUrl: string | null = tokenData.url ?? null;
    const signInUrl = rawUrl ? `${rawUrl}&redirect_url=${encodeURIComponent(APP_URL)}` : null;
    return res.status(200).json({ signInUrl });
  } catch (err: any) {
    console.error('gen-link error:', err);
    return res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
}
