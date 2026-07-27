import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

// ─── Dashboard do administrador ──────────────────────────────────────────────
// Junta Clerk (usuários + último acesso) com Supabase (households, trial,
// assinatura, coach_access) e devolve métricas agregadas + lista por cliente.
// SÓ super-admin (ADMIN_USER_IDS) — a assistente não vê faturamento.

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
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Preços vigentes (espelho de api/create-checkout.ts — manter em sincronia)
const PRICE_MONTHLY = 14.99;
const PRICE_ANNUAL = 131.88;

// Espelho da regra de lib/access.ts (Vercel não empacota import local em api/)
// Trial unificado: 5 meses grátis para todos (decisão Eduardo, 2026-07-27).
const TRIAL_MONTHS_COACH_CLIENT = 5;

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

interface ClerkUser {
  id: string;
  first_name?: string;
  last_name?: string;
  last_sign_in_at?: number | null;
  created_at?: number;
  primary_email_address_id?: string;
  email_addresses?: Array<{ id: string; email_address: string }>;
}

async function listAllClerkUsers(): Promise<ClerkUser[]> {
  const users: ClerkUser[] = [];
  const PAGE = 100;
  for (let offset = 0; offset < 1000; offset += PAGE) {
    const r = await fetch(`https://api.clerk.com/v1/users?limit=${PAGE}&offset=${offset}&order_by=-last_sign_in_at`, {
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    });
    if (!r.ok) break;
    const page = await r.json() as ClerkUser[];
    users.push(...page);
    if (page.length < PAGE) break;
  }
  return users;
}

// Lista de usuários ocultados do dashboard fica na private_metadata do
// PRÓPRIO admin no Clerk (sem migração no banco; sincroniza web + celular).
async function getHiddenIds(adminId: string): Promise<string[]> {
  const r = await fetch(`https://api.clerk.com/v1/users/${adminId}`, {
    headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
  });
  if (!r.ok) return [];
  const u = await r.json() as { private_metadata?: { hidden_metrics_users?: string[] } };
  return u.private_metadata?.hidden_metrics_users ?? [];
}

async function setHiddenIds(adminId: string, ids: string[]): Promise<void> {
  await fetch(`https://api.clerk.com/v1/users/${adminId}/metadata`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ private_metadata: { hidden_metrics_users: ids } }),
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');

  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims || !ADMIN_IDS.includes(claims.sub)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // POST { userId, hide } — oculta/mostra um usuário na métrica (não apaga nada)
  if (req.method === 'POST') {
    const { userId, hide } = (req.body ?? {}) as { userId?: string; hide?: boolean };
    if (!userId) return res.status(400).json({ error: 'userId obrigatório' });
    const current = await getHiddenIds(claims.sub);
    const next = hide
      ? Array.from(new Set([...current, userId]))
      : current.filter(id => id !== userId);
    await setHiddenIds(claims.sub, next);
    return res.status(200).json({ ok: true, hidden: next });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const [clerkUsers, hiddenIds, { data: households }, { data: members }, { data: coachRows }] = await Promise.all([
      listAllClerkUsers(),
      getHiddenIds(claims.sub),
      db.from('households').select('*'),
      db.from('household_members').select('household_id, clerk_user_id'),
      db.from('coach_access').select('*'),
    ]);
    const hiddenSet = new Set(hiddenIds);

    const now = Date.now();
    const hhById = new Map((households ?? []).map(h => [h.id, h]));
    const hhByUser = new Map<string, string>();
    for (const m of members ?? []) hhByUser.set(m.clerk_user_id, m.household_id);

    const coachByHh = new Map<string, { isCoachClient: boolean; coachActive: boolean }>();
    for (const c of coachRows ?? []) {
      if (c.status !== 'approved') continue;
      const ends = c.expires_at ?? c.coaching_ends_at;
      const active = !ends || new Date(ends).getTime() > now;
      const prev = coachByHh.get(c.household_id);
      coachByHh.set(c.household_id, {
        isCoachClient: true,
        coachActive: (prev?.coachActive ?? false) || active,
      });
    }

    type Status = 'coach' | 'pagante' | 'trial' | 'expirado' | 'sem_conta';
    interface ClientRow {
      id: string;
      name: string;
      email: string;
      lastSignInAt: number | null;
      status: Status;
      trialDaysLeft: number | null;
      isAnnual: boolean;
      hidden: boolean;
    }

    const rows: ClientRow[] = [];
    const D7 = 7 * 24 * 60 * 60 * 1000;
    const D30 = 30 * 24 * 60 * 60 * 1000;
    let active7d = 0, active30d = 0, paying = 0, payingAnnual = 0, inTrial = 0, expired = 0, coachActive = 0;

    for (const u of clerkUsers) {
      if (ADMIN_IDS.includes(u.id)) continue; // não conta a si próprio/assistentes-admin
      const isHidden = hiddenSet.has(u.id);

      const primary = u.email_addresses?.find(e => e.id === u.primary_email_address_id) ?? u.email_addresses?.[0];
      const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || primary?.email_address?.split('@')[0] || '—';
      const last = u.last_sign_in_at ?? null;
      if (!isHidden && last && now - last <= D7) active7d++;
      if (!isHidden && last && now - last <= D30) active30d++;

      const hhId = hhByUser.get(u.id);
      const hh = hhId ? hhById.get(hhId) : undefined;

      let status: Status = 'sem_conta';
      let trialDaysLeft: number | null = null;
      let isAnnual = false;

      if (hh) {
        const coach = coachByHh.get(hh.id);
        const subActive = hh.subscription_status === 'active' &&
          (!hh.subscription_expires_at || new Date(hh.subscription_expires_at).getTime() > now);
        if (coach?.coachActive) {
          status = 'coach';
          if (!isHidden) coachActive++;
          // Consultoria também tem relógio: dias até o fim dos 5 meses grátis
          // (= quando começa a pagar), mesmo cálculo do trial de coach-client.
          if (hh.created_at) {
            const trialEnd = addMonths(new Date(hh.created_at), TRIAL_MONTHS_COACH_CLIENT);
            trialDaysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - now) / (24 * 60 * 60 * 1000)));
          }
        } else if (subActive) {
          status = 'pagante';
          if (!isHidden) paying++;
          // anual se a janela started→expires passa de 6 meses
          if (hh.subscription_started_at && hh.subscription_expires_at) {
            const span = new Date(hh.subscription_expires_at).getTime() - new Date(hh.subscription_started_at).getTime();
            isAnnual = span > 6 * 30 * 24 * 60 * 60 * 1000;
            if (isAnnual && !isHidden) payingAnnual++;
          }
        } else if (hh.created_at) {
          const created = new Date(hh.created_at);
          const trialEnd = addMonths(created, TRIAL_MONTHS_COACH_CLIENT);
          if (trialEnd.getTime() > now) {
            status = 'trial';
            trialDaysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - now) / (24 * 60 * 60 * 1000)));
            if (!isHidden) inTrial++;
          } else {
            status = 'expirado';
            if (!isHidden) expired++;
          }
        }
      }

      rows.push({ id: u.id, name, email: primary?.email_address ?? '—', lastSignInAt: last, status, trialDaysLeft, isAnnual, hidden: isHidden });
    }

    // Mais recentes primeiro; quem nunca logou vai pro fim
    rows.sort((a, b) => (b.lastSignInAt ?? 0) - (a.lastSignInAt ?? 0));

    const payingMonthly = paying - payingAnnual;
    const mrr = payingMonthly * PRICE_MONTHLY + payingAnnual * (PRICE_ANNUAL / 12);

    return res.status(200).json({
      totals: {
        totalUsers: rows.filter(r => !r.hidden).length,
        active7d,
        active30d,
        paying,
        inTrial,
        coachActive,
        expired,
        mrr: Math.round(mrr * 100) / 100,
        // se todo mundo em trial virasse pagante mensal
        potentialMrr: Math.round((mrr + inTrial * PRICE_MONTHLY) * 100) / 100,
      },
      clients: rows,
      prices: { monthly: PRICE_MONTHLY, annual: PRICE_ANNUAL },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erro desconhecido';
    return res.status(500).json({ error: msg });
  }
}
