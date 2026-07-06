import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminToken } from '../lib/verifyToken';

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

function getAdminId(authHeader: string): string | null {
  return verifyAdminToken(authHeader);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const requesterId = getAdminId(req.headers.authorization ?? '');
  if (!requesterId) return res.status(403).json({ error: 'Forbidden' });

  try {
    const { householdId, clientClerkId } = req.body;
    if (!householdId) return res.status(400).json({ error: 'Missing householdId' });

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    await db.from('households').delete().eq('id', householdId);

    if (clientClerkId) {
      await fetch(`https://api.clerk.com/v1/users/${clientClerkId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('delete-client error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
