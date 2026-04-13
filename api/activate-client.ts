import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyAdmin } from './_auth';

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const requesterId = await verifyAdmin(req.headers.authorization ?? '');
  if (!requesterId) return res.status(403).json({ error: 'Forbidden: not an admin' });

  try {
    const { householdId } = req.body;
    if (!householdId) return res.status(400).json({ error: 'householdId required' });

    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Busca dados do prospecto
    const { data: household, error: hhError } = await db
      .from('households')
      .select('prospect_name, prospect_email, status')
      .eq('id', householdId)
      .single();

    if (hhError || !household) return res.status(404).json({ error: 'Household not found' });
    if (household.status === 'active') return res.status(400).json({ error: 'Already activated' });

    const name = household.prospect_name ?? '';
    const email = household.prospect_email ?? '';
    const [firstName, ...rest] = name.trim().split(' ');
    const lastName = rest.join(' ') || '';

    // Cria usuário no Clerk e envia convite por e-mail
    const clerkRes = await fetch('https://api.clerk.com/v1/users', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLERK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email_address: [email],
        first_name: firstName,
        last_name: lastName,
        skip_password_requirement: true,
        public_metadata: { role: 'client' },
      }),
    });

    if (!clerkRes.ok) {
      const err = await clerkRes.json();
      return res.status(400).json({ error: err.errors?.[0]?.message ?? 'Clerk error' });
    }

    const clerkUser = await clerkRes.json();
    const clientClerkId = clerkUser.id;

    // Cria household_member (dono do perfil)
    await db.from('household_members').insert({
      household_id: householdId,
      clerk_user_id: clientClerkId,
      role: 'owner',
    });

    // Atualiza status para ativo
    await db.from('households').update({ status: 'active' }).eq('id', householdId);

    return res.status(200).json({ success: true, clientId: clientClerkId });
  } catch (err: any) {
    console.error('activate-client error:', err);
    return res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
}
