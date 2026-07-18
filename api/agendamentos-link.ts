import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

// ── Vinculação Kashim <-> Sistema de Agendamentos ─────────────────────────────
// GET  ?householdId=X  → { currentLinkId: string|null, clients: AgendClient[] }
// POST { householdId, agendamentosClientId: string|null } → { ok: true }
// Só admin. O vínculo fica em households.agendamentos_client_id (TEXT nullable).
// ─────────────────────────────────────────────────────────────────────────────

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

const KASHIM_URL = process.env.VITE_SUPABASE_URL!;
const KASHIM_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

// Supabase do sistema de agendamentos (projeto separado)
// Aceita service key (preferencial) ou anon key (suficiente pois clients não tem RLS com Supabase Auth)
const AGEND_URL = process.env.AGENDAMENTOS_SUPABASE_URL ?? '';
const AGEND_KEY = process.env.AGENDAMENTOS_SERVICE_KEY || process.env.AGENDAMENTOS_ANON_KEY || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');

  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });
  if (!ADMIN_IDS.includes(claims.sub)) return res.status(403).json({ error: 'Sem permissao' });

  if (!AGEND_URL || !AGEND_KEY) {
    return res.status(503).json({ error: 'AGENDAMENTOS_SUPABASE_URL ou AGENDAMENTOS_SERVICE_KEY nao configurados' });
  }

  const kashim = createClient(KASHIM_URL, KASHIM_SERVICE_KEY);
  const agend = createClient(AGEND_URL, AGEND_KEY);

  try {
    // ── GET: retorna link atual + lista todos os clientes do agendamentos ──────
    if (req.method === 'GET') {
      const householdId = String(req.query.householdId ?? '');
      if (!householdId) return res.status(400).json({ error: 'householdId obrigatorio' });

      const [{ data: hh }, { data: rawClients, error: agendErr }] = await Promise.all([
        kashim.from('households').select('agendamentos_client_id').eq('id', householdId).maybeSingle(),
        agend.from('clients').select('id, name, phone_digits, start_month_year, status_by_month').order('name'),
      ]);

      if (agendErr) return res.status(500).json({ error: 'Erro ao buscar clientes do agendamentos: ' + agendErr.message });

      const TERMINAL_STATUSES = new Set(['CANCELLED_EARLY', 'FINALIZADO', 'CANCELED']);
      const clients = (rawClients ?? [])
        .filter((c: any) => {
          const sbm = (c.status_by_month ?? {}) as Record<string, { status?: string }>;
          return !Object.values(sbm).some(v => TERMINAL_STATUSES.has(v?.status ?? ''));
        })
        .map((c: any) => ({
          id: c.id as string,
          name: c.name as string,
          phoneDigits: (c.phone_digits ?? '') as string,
          startMonthYear: (c.start_month_year ?? '') as string,
        }));

      return res.status(200).json({
        currentLinkId: hh?.agendamentos_client_id ?? null,
        clients,
      });
    }

    // ── POST: salva ou remove o vínculo ─────────────────────────────────────────
    if (req.method === 'POST') {
      const { householdId, agendamentosClientId } = (req.body ?? {}) as {
        householdId?: string;
        agendamentosClientId?: string | null;
      };

      if (!householdId) return res.status(400).json({ error: 'householdId obrigatorio' });

      const { error } = await kashim
        .from('households')
        .update({ agendamentos_client_id: agendamentosClientId ?? null })
        .eq('id', householdId);

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'erro desconhecido' });
  }
}
