import type { VercelRequest, VercelResponse } from '@vercel/node';
import jwt from 'jsonwebtoken';

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET!;
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

function verifyAdmin(authHeader: string): string | null {
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const secret = Buffer.from(SUPABASE_JWT_SECRET, 'base64');
    const payload = jwt.verify(token, secret) as { sub?: string };
    const userId = payload.sub;
    if (!userId || !ADMIN_IDS.includes(userId)) return null;
    return userId;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const requesterId = verifyAdmin(req.headers.authorization ?? '');
  if (!requesterId) return res.status(403).json({ error: 'Forbidden' });

  try {
    const { householdId, clientClerkId } = req.body;
    if (!householdId || !clientClerkId) return res.status(400).json({ error: 'Missing fields' });

    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    await db.from('households').delete().eq('id', householdId);

    await fetch(`https://api.clerk.com/v1/users/${clientClerkId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('delete-client error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
