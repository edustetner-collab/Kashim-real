import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';

// Endpoint dedicado para a Donna (assistente pessoal local). Não usa o fluxo
// de autenticação do Clerk/household — é protegido por um segredo próprio,
// só de leitura, e só devolve as contas que vencem hoje e ainda não foram
// pagas (mesmo critério de lib/notifications.ts:buildBillNotifications, mas
// para o dia corrente em vez de futuro).

const DONNA_API_SECRET = process.env.DONNA_API_SECRET ?? '';
const DONNA_HOUSEHOLD_ID = process.env.DONNA_HOUSEHOLD_ID ?? '';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const BILL_CATEGORIES = new Set(['Cartão de Crédito', 'Contas Fixas']);

function authorized(req: VercelRequest): boolean {
  if (!DONNA_API_SECRET) return false;
  const provided = String(req.headers['x-donna-key'] ?? '');
  const expected = DONNA_API_SECRET;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface FinanceItemRow {
  description: string;
  category: string;
  values: number[] | null;
  paid_status: boolean[] | null;
  due_day: number | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!DONNA_HOUSEHOLD_ID) return res.status(500).json({ error: 'DONNA_HOUSEHOLD_ID não configurado' });

  const now = new Date();
  const monthIndex = now.getMonth();
  const today = now.getDate();

  const { data, error } = await db
    .from('finance_items')
    .select('description, category, values, paid_status, due_day')
    .eq('household_id', DONNA_HOUSEHOLD_ID);

  if (error) return res.status(500).json({ error: error.message });

  const lastDayOfMonth = new Date(now.getFullYear(), monthIndex + 1, 0).getDate();

  const bills = ((data ?? []) as FinanceItemRow[])
    .filter((item) => BILL_CATEGORIES.has(item.category))
    .filter((item) => item.due_day != null)
    .filter((item) => Math.min(item.due_day as number, lastDayOfMonth) === today)
    .map((item) => ({
      description: item.description,
      category: item.category,
      value: item.values?.[monthIndex] ?? 0,
      paid: !!item.paid_status?.[monthIndex],
    }))
    .filter((item) => item.value > 0 && !item.paid);

  return res.status(200).json({
    date: now.toISOString().slice(0, 10),
    bills,
  });
}
