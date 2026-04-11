import type { VercelRequest, VercelResponse } from '@vercel/node';

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization ?? '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const verifyRes = await fetch('https://api.clerk.com/v1/tokens/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const verifyData = await verifyRes.json();
    const requesterId = verifyData?.sub ?? verifyData?.user_id;

    if (!ADMIN_IDS.includes(requesterId)) return res.status(403).json({ error: 'Forbidden' });

    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Busca todos os households onde o coach tem acesso
    const { data: accesses } = await db
      .from('coach_access')
      .select('household_id, coaching_started_at, coaching_ends_at, households(created_at)')
      .eq('coach_clerk_user_id', requesterId)
      .eq('status', 'approved');

    if (!accesses || accesses.length === 0) return res.status(200).json({ clients: [] });

    const householdIds = accesses.map((a: any) => a.household_id);

    // Busca membros dos households (os clientes)
    const { data: members } = await db
      .from('household_members')
      .select('household_id, clerk_user_id, joined_at')
      .in('household_id', householdIds)
      .not('clerk_user_id', 'in', `(${ADMIN_IDS.map(id => `"${id}"`).join(',')})`);

    if (!members || members.length === 0) return res.status(200).json({ clients: [] });

    // Busca info dos usuários no Clerk
    const clients = await Promise.all(
      members.map(async (member: any) => {
        const clerkRes = await fetch(`https://api.clerk.com/v1/users/${member.clerk_user_id}`, {
          headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
        });
        const clerkUser = clerkRes.ok ? await clerkRes.json() : null;

        const access = accesses.find((a: any) => a.household_id === member.household_id);

        return {
          householdId: member.household_id,
          clientId: member.clerk_user_id,
          clientName: clerkUser
            ? `${clerkUser.first_name ?? ''} ${clerkUser.last_name ?? ''}`.trim() || clerkUser.email_addresses?.[0]?.email_address
            : 'Cliente',
          clientEmail: clerkUser?.email_addresses?.[0]?.email_address ?? '',
          createdAt: member.joined_at,
          coachingEndsAt: access?.coaching_ends_at ?? new Date().toISOString(),
        };
      })
    );

    return res.status(200).json({ clients });
  } catch (err) {
    console.error('list-clients error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
