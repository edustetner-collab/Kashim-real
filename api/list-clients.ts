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
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const requesterId = getAdminId(req.headers.authorization ?? '');
  if (!requesterId) return res.status(403).json({ error: 'Forbidden' });

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: accesses } = await db
      .from('coach_access')
      .select('household_id, coaching_started_at, coaching_ends_at')
      .eq('coach_clerk_user_id', requesterId)
      .eq('status', 'approved');

    if (!accesses || accesses.length === 0) return res.status(200).json({ clients: [] });

    const householdIds = accesses.map((a: any) => a.household_id);

    const { data: households } = await db
      .from('households')
      .select('id, status, prospect_name, prospect_email, created_at')
      .in('id', householdIds);

    const { data: members } = await db
      .from('household_members')
      .select('household_id, clerk_user_id, joined_at')
      .in('household_id', householdIds)
      .not('clerk_user_id', 'in', `(${ADMIN_IDS.map(id => `"${id}"`).join(',')})`);

    const clients = await Promise.all(
      (households ?? []).map(async (household: any) => {
        const access = accesses.find((a: any) => a.household_id === household.id);
        const member = (members ?? []).find((m: any) => m.household_id === household.id);

        if (household.status === 'draft' || !member) {
          return {
            householdId: household.id,
            clientId: null,
            clientName: household.prospect_name ?? 'Cliente',
            clientEmail: household.prospect_email ?? '',
            createdAt: household.created_at,
            coachingEndsAt: access?.coaching_ends_at ?? new Date().toISOString(),
            status: 'draft',
          };
        }

        const clerkRes = await fetch(`https://api.clerk.com/v1/users/${member.clerk_user_id}`, {
          headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
        });
        const clerkUser = clerkRes.ok ? await clerkRes.json() : null;

        return {
          householdId: household.id,
          clientId: member.clerk_user_id,
          clientName: clerkUser
            ? `${clerkUser.first_name ?? ''} ${clerkUser.last_name ?? ''}`.trim() || clerkUser.email_addresses?.[0]?.email_address
            : (household.prospect_name ?? 'Cliente'),
          clientEmail: clerkUser?.email_addresses?.[0]?.email_address ?? household.prospect_email ?? '',
          createdAt: member.joined_at,
          coachingEndsAt: access?.coaching_ends_at ?? new Date().toISOString(),
          status: 'active',
        };
      })
    );

    return res.status(200).json({ clients });
  } catch (err) {
    console.error('list-clients error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
