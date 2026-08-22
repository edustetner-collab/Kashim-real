import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Consulta o estado REAL de um consentimento na Technospeed.
 *
 * Por que existe: até aqui o app decidia o status por conta própria — primeiro
 * gravava `active` ao criar a conta, depois `authorized_fetching` quando o
 * cliente clicava "Já autorizei". Os dois são chute. Um Itaú que nunca concluiu
 * a jornada aparecia como "Importando histórico" para sempre.
 *
 * Quem sabe se a autorização existe é a Technospeed, e a resposta está em
 * `statusOpenfinance` + `openfinanceId`. O botão da tela vira gatilho para
 * PERGUNTAR, não afirmação de que aconteceu.
 */

// ─── Auth (duplicado por rota: Vercel não empacota import local em api/) ─────

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

// ─── Portão de acesso (espelha lib/ofAccess.ts) ──────────────────────────────

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? '';
const OF_BETA_USER_IDS = (process.env.OF_BETA_USER_IDS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const OF_BETA_EMAILS = ['eduardo_cda@hotmail.com'];

async function hasOpenFinanceAccess(sub: string): Promise<boolean> {
  if (OF_BETA_USER_IDS.includes(sub)) return true;
  if (!CLERK_SECRET_KEY) return false;

  try {
    const r = await fetch(`https://api.clerk.com/v1/users/${sub}`, {
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    });
    if (!r.ok) return false;
    const u = await r.json() as { email_addresses?: Array<{ email_address?: string }> };
    return (u.email_addresses ?? []).some(
      (e) => OF_BETA_EMAILS.includes((e.email_address ?? '').toLowerCase()),
    );
  } catch {
    return false;
  }
}

// ─── Cliente Technospeed via proxy de IP fixo ────────────────────────────────

const TS_BASE_URL = (process.env.TECHNOSPEED_BASE_URL ?? 'https://api.pagamentobancario.com.br').replace(/\/$/, '');
const TS_CNPJ_SH = process.env.TECHNOSPEED_CNPJ_SH ?? '';
const TS_TOKEN_SH = process.env.TECHNOSPEED_TOKEN_SH ?? '';
const PROXY_URL = (process.env.PROXY_URL ?? '').replace(/\/$/, '');
const PROXY_SECRET = process.env.PROXY_SECRET ?? '';

async function tsReq<T>(method: string, path: string, payerCpf: string): Promise<T> {
  if (PROXY_URL) {
    const res = await fetch(`${PROXY_URL}/proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROXY_SECRET}` },
      body: JSON.stringify({ method, path, payerCpf }),
    });
    const text = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = text; }

    const envelope = parsed && typeof parsed === 'object' && 'status' in parsed
      ? parsed as { status: number; body: unknown }
      : null;
    if (!envelope) throw new Error(`Proxy respondeu ${res.status}`);
    if (envelope.status < 200 || envelope.status >= 300) {
      throw new Error(`Technospeed ${envelope.status} ${path}`);
    }
    return envelope.body as T;
  }

  const res = await fetch(`${TS_BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      cnpjsh: TS_CNPJ_SH,
      tokensh: TS_TOKEN_SH,
      payercpfcnpj: payerCpf,
    },
  });
  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`Technospeed ${res.status} ${path}`);
  return json as T;
}

// ─── Tradução do status ───────────────────────────────────────────────────────

/**
 * Converte o `statusOpenfinance` bruto no nosso `consent_status`.
 *
 * Ciclo de vida, dito pelo Gabriel (Tecnospeed) no kick-off de 2026-08-11:
 *   criar conta            → PENDENTE_ATIVACAO
 *   cliente clica no link  → PROCESSANDO   (banco tem de 1min a 1h)
 *   banco libera a conexão → CONCLUIDO     (só aqui dá para pedir extrato)
 *
 * `PROCESSANDO` precisa cair em `authorized_fetching`, nunca em `active`: pedir
 * extrato antes do banco liberar volta falha. O valor cru continua gravado em
 * `openfinance_status` porque a grafia exata dos dois últimos ainda não foi
 * vista em produção — só `PENDENTE_ATIVACAO` foi.
 */
function deriveConsentStatus(raw: string | null, openfinanceId: string | null): string {
  const s = (raw ?? '').toUpperCase();

  if (/REVOG|CANCEL/.test(s)) return 'revoked';
  if (/EXPIR|VENCID/.test(s)) return 'expired';
  // Antes de PROCESS: "PENDENTE_ATIVACAO" não pode ser lido como concluído.
  if (/PENDENTE|AGUARD/.test(s)) return 'pending_authorization';
  if (/PROCESS/.test(s)) return 'authorized_fetching';
  // `ATIVO` é o que a API devolve de verdade (visto em produção na conta
  // Bradesco PHqs1Xi0tx). O kick-off falou "CONCLUÍDO" — aceitamos os dois.
  // A ordem importa: "PENDENTE_ATIVACAO" já saiu na linha acima.
  if (/FALHA|FALHOU|ERRO|ERROR|FAIL/.test(s)) return 'failed';
  if (/ATIVO|CONCLU|SUCESSO|SUCCESS/.test(s)) return 'active';

  // Sem openfinanceId não existe consentimento, qualquer que seja o rótulo.
  if (!openfinanceId) return 'pending_authorization';

  // Status desconhecido NUNCA vira 'active' por dedução. Foi assim que um
  // consentimento em FALHA virou "Itaú está conectado" num e-mail: o rótulo
  // não batia com nenhuma regra e o openfinanceId sozinho foi tomado como
  // prova de sucesso. Na dúvida, continua aguardando.
  return 'pending_authorization';
}

function pickAccount(payload: unknown): Record<string, unknown> | null {
  const accounts = (payload as { accounts?: unknown } | null)?.accounts;
  if (Array.isArray(accounts)) return (accounts[0] as Record<string, unknown>) ?? null;
  if (accounts && typeof accounts === 'object') return accounts as Record<string, unknown>;
  if (payload && typeof payload === 'object') return payload as Record<string, unknown>;
  return null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });
  const sub = claims.sub;

  if (!(await hasOpenFinanceAccess(sub))) {
    return res.status(403).json({ error: 'Open Finance ainda não está disponível para esta conta.' });
  }

  const { householdId, connectionId } = req.body as { householdId?: string; connectionId?: string };
  if (!householdId || !connectionId) {
    return res.status(400).json({ error: 'householdId e connectionId obrigatórios' });
  }
  if (!(await isMember(sub, householdId))) return res.status(403).json({ error: 'Forbidden' });

  try {
    const { data: conn } = await db
      .from('bank_connections')
      .select('account_hash, payer_cpf, consent_status')
      .eq('id', connectionId)
      .eq('household_id', householdId)
      .maybeSingle();

    if (!conn) return res.status(404).json({ error: 'Conexão não encontrada' });
    if (!conn.payer_cpf || !conn.account_hash) {
      return res.status(400).json({ error: 'Conexão sem CPF ou accountHash registrados' });
    }

    const payload = await tsReq<unknown>('GET', `/api/v1/account/${conn.account_hash}`, conn.payer_cpf);
    const account = pickAccount(payload);

    const openfinanceStatus = str(account?.statusOpenfinance);
    const openfinanceId = str(account?.openfinanceId);
    const consentStatus = deriveConsentStatus(openfinanceStatus, openfinanceId);

    await db
      .from('bank_connections')
      .update({
        consent_status: consentStatus,
        openfinance_status: openfinanceStatus,
        openfinance_id: openfinanceId,
      })
      .eq('id', connectionId);

    return res.status(200).json({
      connectionId,
      consentStatus,
      openfinanceStatus,
      openFinanceId: openfinanceId,
      authorized: consentStatus === 'active',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return res.status(502).json({ error: msg });
  }
}
