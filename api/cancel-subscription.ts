import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '../lib/rateLimit';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

function getUserId(authHeader?: string): string | null {
  const token = (authHeader ?? '').replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { sub?: string; exp?: number };
    if (!payload.sub) return null;
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] ?? 'unknown';
  if (!rateLimit(`cancel-sub:${ip}`, 5, 60_000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const userId = getUserId(req.headers.authorization as string);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { householdId } = req.body as { householdId?: string };
  if (!householdId) return res.status(400).json({ error: 'householdId obrigatório' });

  // Confirma que o usuário pertence a este household
  const { data: member } = await supabase
    .from('household_members')
    .select('id')
    .eq('household_id', householdId)
    .eq('clerk_user_id', userId)
    .maybeSingle();

  if (!member) return res.status(403).json({ error: 'Sem permissão' });

  // Marca como cancelado no banco
  // TODO: quando a conta Pagar.me do Kashim estiver ativa, chamar a API deles aqui
  // para cancelar o plano recorrente antes de atualizar o status.
  const { error } = await supabase
    .from('households')
    .update({
      subscription_status: 'cancelled',
    })
    .eq('id', householdId);

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ ok: true });
}
