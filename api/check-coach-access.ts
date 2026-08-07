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

const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization as string);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });
  const userId = claims.sub;

  const { householdId } = req.query as { householdId?: string };
  if (!householdId) return res.status(400).json({ error: 'householdId required' });

  let isAdmin = ADMIN_IDS.includes(userId);

  // Fallback: se não está na lista de env vars, verifica se este usuário é coach
  // de qualquer household (coach_clerk_user_id = userId). Isso detecta coaches
  // mesmo que ADMIN_USER_IDS esteja com valor errado ou vazio no Vercel.
  if (!isAdmin) {
    const { data: coachRow } = await supabase
      .from('coach_access')
      .select('id')
      .eq('coach_clerk_user_id', userId)
      .limit(1)
      .maybeSingle();
    if (coachRow) isAdmin = true;
  }

  // Admins/coaches podem checar qualquer household sem ser membros.
  if (!isAdmin) {
    const { data: member } = await supabase
      .from('household_members')
      .select('id')
      .eq('household_id', householdId)
      .eq('clerk_user_id', userId)
      .maybeSingle();
    if (!member) return res.status(403).json({ error: 'Forbidden' });
  }

  // ── 1. Tenta coach_access (select * para não explodir se alguma coluna não existe) ──
  const { data: coachRows, error: caError } = await supabase
    .from('coach_access')
    .select('*')
    .eq('household_id', householdId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (caError) {
    console.error('[check-coach-access] coach_access query error:', caError.message);
  }

  const records = coachRows ?? [];
  const approvedRecord = records.find((r: any) => r.status === 'approved') ?? null;

  // Tenta extrair a data de fim do coaching (nome da coluna pode variar)
  const coachingEndsAt: string | null =
    approvedRecord?.coaching_ends_at ??
    approvedRecord?.expires_at ??
    null;

  const hasCoach = !!approvedRecord;
  const expired = coachingEndsAt ? new Date(coachingEndsAt) < new Date() : false;

  // isCoachClient primário: tem qualquer registro em coach_access
  let isCoachClient = records.length > 0;

  // ── 2. Fallback: se coach_access vazio, checar se household foi criado pelo coach ──
  // Households criados via create-client têm status='draft'. Espontâneos têm
  // status='active' (set pelo ensure-household) ou null.
  if (!isCoachClient) {
    const { data: hh } = await supabase
      .from('households')
      .select('status, prospect_name, prospect_email')
      .eq('id', householdId)
      .maybeSingle();

    // 'draft' ou presença de prospect_name/email = criado pelo coach
    if (hh && (hh.status === 'draft' || hh.prospect_name || hh.prospect_email)) {
      isCoachClient = true;
    }
  }

  // isAdminVerified: o servidor confirma — não depende do VITE_ do frontend
  return res.status(200).json({ hasCoach, expired, coachingEndsAt, isCoachClient, isAdminVerified: isAdmin });
}
