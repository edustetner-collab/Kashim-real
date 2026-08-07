import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

// ─── Auth (same pattern as api/debts.ts) ─────────────────────────────────────

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

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function isMember(sub: string, householdId: string): Promise<boolean> {
  if (ADMIN_IDS.includes(sub)) return true;
  const { data } = await db
    .from('household_members')
    .select('id')
    .eq('household_id', householdId)
    .eq('clerk_user_id', sub)
    .maybeSingle();
  return !!data;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

// POST { householdId, merchantKey, category, itemId? }
// Upserts into merchant_memories, incrementing usage_count on conflict.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  const { householdId, merchantKey: key, category, itemId } = req.body as {
    householdId?: string;
    merchantKey?: string;
    category?: string;
    itemId?: string;
  };

  if (!householdId || !key || !category) {
    return res.status(400).json({ error: 'householdId, merchantKey e category obrigatórios' });
  }
  if (!(await isMember(claims.sub, householdId))) return res.status(403).json({ error: 'Forbidden' });

  try {
    const now = new Date().toISOString();
    const { data: existing } = await db
      .from('merchant_memories')
      .select('id, usage_count')
      .eq('household_id', householdId)
      .eq('merchant_key', key)
      .maybeSingle();

    if (existing) {
      const { error } = await db
        .from('merchant_memories')
        .update({
          kashim_category: category,
          kashim_item_id: itemId ?? null,
          usage_count: (existing.usage_count as number) + 1,
          updated_at: now,
        })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await db.from('merchant_memories').insert({
        household_id: householdId,
        merchant_key: key,
        kashim_category: category,
        kashim_item_id: itemId ?? null,
        usage_count: 1,
        updated_at: now,
      });
      if (error) throw error;
    }

    return res.status(200).json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return res.status(500).json({ error: msg });
  }
}
