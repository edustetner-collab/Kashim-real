import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

function getSuperAdminId(authHeader: string): string | null {
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

  const requesterId = getSuperAdminId(req.headers.authorization ?? '');
  if (!requesterId) return res.status(403).json({ error: 'Forbidden' });

  const { householdId, isPrivate } = req.body;
  if (!householdId || typeof isPrivate !== 'boolean') {
    return res.status(400).json({ error: 'householdId e isPrivate são obrigatórios' });
  }

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { error } = await db
      .from('households')
      .update({ is_private: isPrivate })
      .eq('id', householdId);

    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('toggle-privacy error:', err);
    return res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
}
