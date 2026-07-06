import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { verifyAuthToken } from '../lib/verifyToken';

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

function getUserId(authHeader: string): string | null {
  return verifyAuthToken(authHeader)?.sub ?? null;
}

async function getClerkEmail(userId: string): Promise<string | null> {
  try {
    const r = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u.email_addresses?.[0]?.email_address ?? null;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const userId = getUserId(req.headers.authorization ?? '');
  if (!userId) return res.status(403).json({ error: 'Forbidden' });

  const isSuperAdmin = ADMIN_IDS.includes(userId);

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Se não é super admin, verifica se é assistente pela tabela admin_users
    if (!isSuperAdmin) {
      const email = await getClerkEmail(userId);
      if (!email) return res.status(403).json({ error: 'Forbidden' });
      const { data: assistant } = await db
        .from('admin_users')
        .select('id')
        .eq('email', email.toLowerCase())
        .single();
      if (!assistant) return res.status(403).json({ error: 'Forbidden' });
    }

    // Assistente usa o ID do super admin para buscar clientes vinculados
    const coachId = isSuperAdmin ? userId : ADMIN_IDS[0];

    const { data: accesses } = await db
      .from('coach_access')
      .select('household_id, coaching_started_at, coaching_ends_at')
      .eq('coach_clerk_user_id', coachId)
      .eq('status', 'approved');

    if (!accesses || accesses.length === 0) return res.status(200).json({ clients: [] });

    const householdIds = accesses.map((a: any) => a.household_id);

    let query = db
      .from('households')
      .select('id, status, prospect_name, prospect_email, created_at, is_private')
      .in('id', householdIds);

    // Assistente não vê perfis privados
    if (!isSuperAdmin) {
      query = query.eq('is_private', false);
    }

    const { data: households } = await query;

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
            isPrivate: household.is_private ?? false,
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
          isPrivate: household.is_private ?? false,
        };
      })
    );

    return res.status(200).json({ clients, isSuperAdmin });
  } catch (err) {
    console.error('list-clients error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
