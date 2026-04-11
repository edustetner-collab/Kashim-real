import type { VercelRequest, VercelResponse } from '@vercel/node';

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const verifyRes = await fetch('https://api.clerk.com/v1/tokens/verify', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLERK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    });
    const verifyData = await verifyRes.json();
    const requesterId = verifyData?.sub ?? verifyData?.user_id;

    if (!ADMIN_IDS.includes(requesterId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { householdId, clientClerkId } = req.body;
    if (!householdId || !clientClerkId) return res.status(400).json({ error: 'Missing fields' });

    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Deleta household (cascade apaga tudo)
    await db.from('households').delete().eq('id', householdId);

    // Deleta usuário no Clerk
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
