import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
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
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

// Aceita super-admin OU assistente (e-mail cadastrado em admin_users) —
// mesmo padrão do list-clients. Liberado em 2026-07-16 a pedido do Eduardo
// para a assistente criar/ativar perfis de clientes.
async function getStaffId(authHeader: string, db: SupabaseClient): Promise<string | null> {
  const claims = verifyAuthToken(authHeader);
  if (!claims) return null;
  if (ADMIN_IDS.includes(claims.sub)) return claims.sub;
  try {
    const r = await fetch(`https://api.clerk.com/v1/users/${claims.sub}`, {
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    });
    if (!r.ok) return null;
    const u = await r.json() as { email_addresses?: Array<{ email_address: string }> };
    const email = (u.email_addresses?.[0]?.email_address ?? '').toLowerCase();
    if (!email) return null;
    const { data } = await db.from('admin_users').select('id').eq('email', email).maybeSingle();
    return data ? claims.sub : null;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authDb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const requesterId = await getStaffId(req.headers.authorization ?? '', authDb);
  if (!requesterId) return res.status(403).json({ error: 'Forbidden: not an admin' });

  try {
    const { name, email, parsedItems, startMonth, startYear } = req.body;
    if (!email || !name) return res.status(400).json({ error: 'name and email required' });

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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

    // Coach access para todos os super-admins E para a assistente que criou
    // (o RLS do coach view checa coach_access — sem a linha dela, ela criaria
    // o perfil mas não conseguiria preenchê-lo). coach_user_id + coach_clerk_
    // user_id: a tabela tem as duas colunas (legado) e rotas diferentes
    // filtram por uma ou outra — preenche ambas.
    const coachIds = Array.from(new Set([...ADMIN_IDS, requesterId]));
    for (const coachId of coachIds) {
      await db.from('coach_access').insert({
        household_id: householdId,
        coach_clerk_user_id: coachId,
        coach_user_id: coachId,
        status: 'approved',
        coaching_started_at: new Date().toISOString(),
        coaching_ends_at: new Date(Date.now() + 5 * 30 * 24 * 60 * 60 * 1000).toISOString(),
        approved_at: new Date().toISOString(),
      });
    }

    if (parsedItems && parsedItems.length > 0) {
      const now = new Date().toISOString();
      const rows = parsedItems.map((item: any, i: number) => ({
        household_id: householdId,
        description: item.description,
        category: item.isIncome ? 'Renda' : 'Contas Fixas',
        values: new Array(12).fill(item.value),
        paid_status: new Array(12).fill(false),
        sort_order: i,
        updated_at: now,
      }));
      const { error: fiError } = await db.from('finance_items').insert(rows);
      if (fiError) {
        console.error('finance_items insert error:', fiError);
        return res.status(500).json({ error: 'Perfil criado mas erro ao salvar itens: ' + fiError.message });
      }
    }

    return res.status(200).json({ success: true, householdId, prospectName: name, prospectEmail: email });
  } catch (err: any) {
    console.error('create-client error:', err);
    return res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
}
