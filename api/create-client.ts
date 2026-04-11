import type { VercelRequest, VercelResponse } from '@vercel/node';

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

// IDs dos admins (coach + assistente)
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verifica se o solicitante é admin via Clerk token
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // Verifica o token com Clerk
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
      return res.status(403).json({ error: 'Forbidden: not an admin' });
    }

    const { name, email, parsedItems, startMonth, startYear } = req.body;
    if (!email || !name) return res.status(400).json({ error: 'name and email required' });

    // 1. Cria usuário no Clerk
    const [firstName, ...rest] = name.trim().split(' ');
    const lastName = rest.join(' ') || '';

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
        skip_password_requirement: true, // Clerk envia email de onboarding
        public_metadata: { role: 'client' },
      }),
    });

    if (!clerkRes.ok) {
      const err = await clerkRes.json();
      return res.status(400).json({ error: err.errors?.[0]?.message ?? 'Clerk error' });
    }

    const clerkUser = await clerkRes.json();
    const clientClerkId = clerkUser.id;

    // 2. Envia email de convite (magic link)
    await fetch(`https://api.clerk.com/v1/users/${clientClerkId}/email_addresses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLERK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email_address: email }),
    });

    // 3. Cria household no Supabase com service key
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Cria household
    const { data: household } = await db
      .from('households')
      .insert({
        start_month: startMonth ?? new Date().getMonth(),
        start_year: startYear ?? new Date().getFullYear(),
        coaching_started_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (!household) return res.status(500).json({ error: 'Failed to create household' });

    const householdId = household.id;

    // Associa o cliente
    await db.from('household_members').insert({
      household_id: householdId,
      clerk_user_id: clientClerkId,
      role: 'owner',
    });

    // Dá acesso do coach a todos os admins
    for (const adminId of ADMIN_IDS) {
      await db.from('coach_access').insert({
        household_id: householdId,
        coach_clerk_user_id: adminId,
        status: 'approved',
        coaching_started_at: new Date().toISOString(),
        coaching_ends_at: new Date(Date.now() + 5 * 30 * 24 * 60 * 60 * 1000).toISOString(),
        approved_at: new Date().toISOString(),
      });
    }

    // 4. Insere os itens financeiros pré-preenchidos
    if (parsedItems && parsedItems.length > 0) {
      const rows = parsedItems.map((item: any, i: number) => ({
        household_id: householdId,
        description: item.description,
        category: item.isIncome ? 'Renda' : 'Contas Fixas',
        values: new Array(12).fill(item.value),
        paid_status: new Array(12).fill(false),
        sort_order: i,
      }));
      await db.from('finance_items').insert(rows);
    }

    return res.status(200).json({
      success: true,
      householdId,
      clientId: clientClerkId,
      clientName: name,
      clientEmail: email,
    });

  } catch (err: any) {
    console.error('create-client error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
