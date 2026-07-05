import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminToken } from './_verifyToken';

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const APP_URL = 'https://app.kashim.com.br';

async function shortenUrl(longUrl: string): Promise<string> {
  try {
    const r = await fetch(`https://is.gd/create.php?format=json&url=${encodeURIComponent(longUrl)}`);
    if (!r.ok) return longUrl;
    const data = await r.json();
    return data.shorturl ?? longUrl;
  } catch {
    return longUrl;
  }
}

function getAdminId(authHeader: string): string | null {
  return verifyAdminToken(authHeader);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const requesterId = getAdminId(req.headers.authorization ?? '');
  if (!requesterId) return res.status(403).json({ error: 'Forbidden: not an admin' });

  try {
    const { householdId } = req.body;
    if (!householdId) return res.status(400).json({ error: 'householdId required' });

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: household, error: hhError } = await db
      .from('households')
      .select('prospect_name, prospect_email, status')
      .eq('id', householdId)
      .single();

    if (hhError || !household) return res.status(404).json({ error: 'Household not found' });
    if (household.status === 'active') return res.status(400).json({ error: 'Already activated' });

    const email = household.prospect_email ?? '';
    const name = household.prospect_name ?? '';
    const [firstName, ...rest] = name.trim().split(' ');
    const lastName = rest.join(' ') || '';

    // Cria conta no Clerk — o cliente acessa via código de verificação no email
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
      return res.status(400).json({ error: err.errors?.[0]?.message ?? 'Erro ao criar conta' });
    }

    const clerkUser = await clerkRes.json();
    const clientClerkId = clerkUser.id;

    await db.from('household_members').insert({
      household_id: householdId,
      clerk_user_id: clientClerkId,
      role: 'owner',
    });

    await db.from('households').update({ status: 'active' }).eq('id', householdId);

    // Grant 5 months of free coaching access
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setMonth(expiresAt.getMonth() + 5);
    await db.from('coach_access').insert({
      household_id: householdId,
      coach_user_id: requesterId,
      status: 'approved',
      expires_at: expiresAt.toISOString(),
      approved_at: now.toISOString(),
    });

    // Gera link mágico de acesso (válido por 7 dias)
    let signInUrl: string | null = null;
    const tokenRes = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLERK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: clientClerkId,
        expires_in_seconds: 7 * 24 * 60 * 60,
      }),
    });
    if (tokenRes.ok) {
      const tokenData = await tokenRes.json();
      const token: string | null = tokenData.token ?? null;
      if (token) {
        const longUrl = `https://app.kashim.com.br?sign_in_token=${token}`;
        signInUrl = await shortenUrl(longUrl) ?? longUrl;
      }
    }

    return res.status(200).json({ success: true, clientId: clientClerkId, signInUrl });
  } catch (err: any) {
    console.error('activate-client error:', err);
    return res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
}
