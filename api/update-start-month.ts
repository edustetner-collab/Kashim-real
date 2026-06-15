import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

function verifyToken(authHeader?: string): { sub: string } | null {
  const token = (authHeader ?? '').replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')) as { sub?: string; exp?: number };
    if (!payload.sub) return null;
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const payload = verifyToken(req.headers.authorization as string);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });

  const { householdId, startMonth, startYear } = req.body as {
    householdId?: string;
    startMonth?: number;
    startYear?: number;
  };

  if (!householdId || startMonth == null || startYear == null) {
    return res.status(400).json({ error: 'householdId, startMonth e startYear são obrigatórios' });
  }

  // Verify the user belongs to this household
  const { data: member } = await supabase
    .from('household_members')
    .select('id')
    .eq('household_id', householdId)
    .eq('clerk_user_id', payload.sub)
    .maybeSingle();

  // Allow if user is a direct member OR if they are a coach (admin) with coach_access
  const { data: coachAccess } = member ? { data: null } : await supabase
    .from('coach_access')
    .select('id')
    .eq('household_id', householdId)
    .eq('coach_user_id', payload.sub)
    .maybeSingle();

  if (!member && !coachAccess) {
    return res.status(403).json({ error: 'Sem permissão para este household' });
  }

  const { error } = await supabase
    .from('households')
    .update({ start_month: startMonth, start_year: startYear })
    .eq('id', householdId);

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ ok: true });
}
