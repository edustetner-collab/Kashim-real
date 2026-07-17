import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
function verifyAuthToken(authHeader?: string): { sub: string; [k: string]: unknown } | null {
  if (!SUPABASE_JWT_SECRET) return null;
  const token = (authHeader ?? '').replace('Bearer ', '').trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const [h, p, s] = parts;
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    if (header.alg !== 'HS256') return null;
    const expected = createHmac('sha256', SUPABASE_JWT_SECRET).update(`${h}.${p}`).digest();
    const provided = Buffer.from(s, 'base64url');
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (!claims.sub) return null;
    if (typeof claims.exp === 'number' && claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}
const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

function verifyToken(authHeader?: string): { sub: string } | null {
  const claims = verifyAuthToken(authHeader);
  return claims ? { sub: claims.sub } : null;
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

  // Super-admin (consultor) pode reprojetar qualquer cliente na visão de coach
  const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const isSuperAdmin = ADMIN_IDS.includes(payload.sub);

  // Verify the user belongs to this household
  const { data: member } = isSuperAdmin ? { data: { id: 'admin' } } : await supabase
    .from('household_members')
    .select('id')
    .eq('household_id', householdId)
    .eq('clerk_user_id', payload.sub)
    .maybeSingle();

  // Allow if user is a direct member OR if they are a coach with coach_access
  const { data: coachAccess } = member ? { data: null } : await supabase
    .from('coach_access')
    .select('id')
    .eq('household_id', householdId)
    .eq('coach_user_id', payload.sub)
    .maybeSingle();

  // Assistente (e-mail em admin_users) também pode — exceto perfis privados
  let isAssistant = false;
  if (!member && !coachAccess) {
    try {
      const r = await fetch(`https://api.clerk.com/v1/users/${payload.sub}`, {
        headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
      });
      if (r.ok) {
        const u = await r.json() as { email_addresses?: Array<{ email_address: string }> };
        const email = (u.email_addresses?.[0]?.email_address ?? '').toLowerCase();
        if (email) {
          const { data: assistant } = await supabase.from('admin_users').select('id').eq('email', email).maybeSingle();
          if (assistant) {
            const { data: hh } = await supabase.from('households').select('is_private').eq('id', householdId).maybeSingle();
            isAssistant = !hh?.is_private;
          }
        }
      }
    } catch { /* segue bloqueado */ }
  }

  if (!member && !coachAccess && !isAssistant) {
    return res.status(403).json({ error: 'Sem permissão para este household' });
  }

  const { error } = await supabase
    .from('households')
    .update({ start_month: startMonth, start_year: startYear })
    .eq('id', householdId);

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ ok: true });
}
