import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { verifyAdmin } from './_auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const requesterId = await verifyAdmin(req.headers.authorization ?? '');
  if (!requesterId) return res.status(403).json({ error: 'Forbidden: not an admin' });

  try {
    const { name, email, parsedItems, startMonth, startYear } = req.body;
    if (!email || !name) return res.status(400).json({ error: 'name and email required' });

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 1. Cria household como rascunho (sem login/senha ainda)
    const { data: household, error: hhError } = await db
      .from('households')
      .insert({
        status: 'draft',
        prospect_name: name.trim(),
        prospect_email: email.trim().toLowerCase(),
        start_month: startMonth ?? new Date().getMonth(),
        start_year: startYear ?? new Date().getFullYear(),
      })
      .select('id')
      .single();

    if (hhError || !household) {
      console.error('household error:', hhError);
      return res.status(500).json({ error: 'Failed to create household: ' + hhError?.message });
    }

    const householdId = household.id;

    // 2. Dá acesso do consultor por 5 meses
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

    // 3. Insere itens financeiros
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

    return res.status(200).json({ success: true, householdId, prospectName: name, prospectEmail: email });
  } catch (err: any) {
    console.error('create-client error:', err);
    return res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
}
