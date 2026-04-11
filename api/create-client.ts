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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const requesterId = verifyAdmin(req.headers.authorization ?? '');
  if (!requesterId) return res.status(403).json({ error: 'Forbidden: not an admin' });

  try {
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

    // 2. Cria household no Supabase com service key
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: household, error: hhError } = await db
      .from('households')
      .insert({
        start_month: startMonth ?? new Date().getMonth(),
        start_year: startYear ?? new Date().getFullYear(),
      })
      .select('id')
      .single();

    if (hhError || !household) {
      console.error('household error:', hhError);
      return res.status(500).json({ error: 'Failed to create household' });
    }

    const householdId = household.id;

    // 3. Associa o cliente como owner
    await db.from('household_members').insert({
      household_id: householdId,
      clerk_user_id: clientClerkId,
      role: 'owner',
    });

    // 4. Dá acesso do consultor a todos os admins por 5 meses
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

    // 5. Insere itens financeiros pré-preenchidos (replicados 12 meses)
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

    return res.status(200).json({ success: true, householdId, clientId: clientClerkId, clientName: name, clientEmail: email });

  } catch (err: any) {
    console.error('create-client error:', err);
    return res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
}
