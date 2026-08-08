import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

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

// ─── Cliente Technospeed (embutido: Vercel não empacota import local) ────────

const TS_BASE_URL = (process.env.TECHNOSPEED_BASE_URL ?? 'https://api.pagamentobancario.com.br').replace(/\/$/, '');
const TS_CNPJ_SH = process.env.TECHNOSPEED_CNPJ_SH ?? '';
const TS_TOKEN_SH = process.env.TECHNOSPEED_TOKEN_SH ?? '';

class TSError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: unknown,
  ) {
    super(`Technospeed ${status} ${path}`);
  }
}

interface TSAccountInfo {
  accountHash: string;
  bankCode?: string;
  openFinanceLink?: string | null;
  openfinanceLink?: string | null;
}

async function tsReq<T>(method: string, path: string, payerCpf: string, body?: unknown): Promise<T> {
  const res = await fetch(`${TS_BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      cnpjsh: TS_CNPJ_SH,
      tokensh: TS_TOKEN_SH,
      payercpfcnpj: payerCpf,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = text; }

  if (!res.ok) throw new TSError(res.status, path, json);
  return json as T;
}

interface TSAddress {
  neighborhood: string;
  city: string;
  state: string;
  zipcode: string;
  street?: string;
  addressNumber?: string;
}

/**
 * Garante um pagador com Extrato Open Finance ativo.
 * Quando o CPF já existe não basta buscá-lo: um pagador antigo pode estar com
 * `statementActived: false`, e sem o PUT de ativação o Extrato nunca liga.
 */
async function ensurePayer(name: string, cpf: string, address: TSAddress): Promise<void> {
  try {
    await tsReq('POST', '/api/v1/payer', cpf, {
      name,
      cpfCnpj: cpf,
      neighborhood: address.neighborhood,
      city: address.city,
      state: address.state,
      zipcode: address.zipcode,
      street: address.street,
      addressNumber: address.addressNumber,
      statementActived: true,
    });
    return;
  } catch (err) {
    // 422 costuma significar "pagador já cadastrado" — segue para a ativação
    if (!(err instanceof TSError) || err.status !== 422) throw err;
  }

  const existing = await tsReq<{ statementActived?: boolean }>('GET', '/api/v1/payer', cpf);
  if (existing?.statementActived === true) return;

  await tsReq('PUT', '/api/v1/payer', cpf, { statementActived: true });
}

/** A API alterna entre openfinanceLink e openFinanceLink conforme a rota. */
function extractLink(obj: Record<string, unknown> | undefined): string | null {
  const v = obj?.openfinanceLink ?? obj?.openFinanceLink;
  return typeof v === 'string' && v.startsWith('http') ? v : null;
}

/**
 * Cria a conta com Extrato Open Finance ativo.
 * O POST já devolve o `openfinanceLink` — é o link do conector que o cliente
 * abre para escolher o banco e autorizar. Não é preciso um PUT depois.
 */
async function createAccount(
  payerCpf: string,
  params: { bankCode: string; agency: string; agencyDigit?: string; accountNumber: string; accountNumberDigit?: string },
): Promise<{ accountHash: string; openFinanceLink: string }> {
  const result = await tsReq<{ accounts: TSAccountInfo[] }>('POST', '/api/v1/account', payerCpf, [
    {
      bankCode: params.bankCode,
      agency: params.agency,
      agencyDigit: params.agencyDigit ?? '',
      accountNumber: params.accountNumber,
      accountNumberDigit: params.accountNumberDigit ?? '',
      statementActived: true,
    },
  ]);

  const account = result.accounts?.[0] as unknown as Record<string, unknown> | undefined;
  const accountHash = account?.accountHash;
  if (typeof accountHash !== 'string' || !accountHash) {
    throw new Error('Technospeed não retornou accountHash');
  }

  let link = extractLink(account);

  // Conta já existente costuma voltar sem o link — consultar para recuperá-lo
  if (!link) {
    const fetched = await tsReq<{ accounts?: Record<string, unknown> }>(
      'GET', `/api/v1/account/${accountHash}`, payerCpf,
    ).catch(() => null);
    link = extractLink(fetched?.accounts);
  }

  // Conta antiga pode estar sem Extrato ativo — ativar e reconsultar
  if (!link) {
    const updated = await tsReq<Record<string, unknown>>(
      'PUT', `/api/v1/account/${accountHash}`, payerCpf, { statementActived: true },
    ).catch(() => null);
    link = extractLink(updated ?? undefined);

    if (!link) {
      const refetched = await tsReq<{ accounts?: Record<string, unknown> }>(
        'GET', `/api/v1/account/${accountHash}`, payerCpf,
      ).catch(() => null);
      link = extractLink(refetched?.accounts);
    }
  }

  if (!link) throw new Error('Technospeed não devolveu o link de autorização do Open Finance');
  return { accountHash, openFinanceLink: link };
}

async function revokeOpenFinance(payerCpf: string, accountHash: string): Promise<void> {
  await tsReq('PUT', `/api/v1/account/${accountHash}/openfinance/revoke`, payerCpf, {
    revokeAndDisable: false,
  });
}

// ─── Nomes de banco ───────────────────────────────────────────────────────────

const BANK_NAMES: Record<string, string> = {
  '001': 'Banco do Brasil',
  '033': 'Santander',
  '041': 'Banrisul',
  '070': 'BRB',
  '077': 'Inter',
  '104': 'Caixa Econômica',
  '208': 'BTG Pactual',
  '237': 'Bradesco',
  '260': 'Nubank',
  '341': 'Itaú',
  '422': 'Safra',
  '748': 'Sicredi',
  '756': 'Sicoob',
};

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });
  const sub = claims.sub;

  if (!TS_CNPJ_SH || !TS_TOKEN_SH) {
    return res.status(500).json({ error: 'Credenciais Technospeed não configuradas no servidor.' });
  }

  try {
    // ── GET — listar conexões do household ────────────────────────────────────
    if (req.method === 'GET') {
      const householdId = String(req.query.householdId ?? '');
      if (!householdId) return res.status(400).json({ error: 'householdId obrigatório' });
      if (!(await isMember(sub, householdId))) return res.status(403).json({ error: 'Forbidden' });

      const { data, error } = await db
        .from('bank_connections')
        .select('*')
        .eq('household_id', householdId);

      if (error) throw error;

      return res.status(200).json({
        connections: (data ?? []).map((r) => ({
          id: r.id,
          householdId: r.household_id,
          accountHash: r.account_hash,
          bankCode: r.bank_code,
          bankName: r.bank_name,
          accountType: r.account_type,
          displayName: r.display_name,
          consentStatus: r.consent_status,
          cardLast4: r.card_last4,
          openFinanceLink: r.open_finance_link,
          lastSyncedAt: r.last_synced_at,
          createdAt: r.created_at,
        })),
      });
    }

    // ── POST — criar nova conexão bancária ────────────────────────────────────
    if (req.method === 'POST') {
      const {
        householdId,
        ownerName,
        cpf,
        address,
        bankCode,
        agency,
        agencyDigit,
        accountNumber,
        accountNumberDigit,
        accountType = 'checking',
        cardLast4,
      } = req.body as {
        householdId?: string;
        ownerName?: string;
        cpf?: string;
        address?: TSAddress;
        bankCode?: string;
        agency?: string;
        agencyDigit?: string;
        accountNumber?: string;
        accountNumberDigit?: string;
        accountType?: 'checking' | 'credit_card';
        cardLast4?: string;
      };

      if (!householdId || !ownerName || !cpf || !address || !bankCode || !agency || !accountNumber) {
        return res.status(400).json({ error: 'Campos obrigatórios: householdId, ownerName, cpf, address, bankCode, agency, accountNumber' });
      }
      if (accountType === 'credit_card' && !cardLast4) {
        return res.status(400).json({ error: 'cardLast4 obrigatório para cartão de crédito' });
      }
      if (!/^\d{11}$/.test(cpf)) {
        return res.status(400).json({ error: 'CPF inválido — informe 11 dígitos sem pontos ou traços' });
      }
      if (!(await isMember(sub, householdId))) return res.status(403).json({ error: 'Forbidden' });

      // 1. Registrar pagador (idempotente)
      await ensurePayer(ownerName, cpf, address);

      // 2. Criar conta com Extrato ativo — a resposta já traz o link do conector
      const { accountHash, openFinanceLink } = await createAccount(cpf, {
        bankCode,
        agency,
        agencyDigit,
        accountNumber,
        accountNumberDigit,
      });

      // 4. Salvar conexão
      const bankName = BANK_NAMES[bankCode] ?? `Banco ${bankCode}`;
      const displayName = accountType === 'credit_card'
        ? `${bankName} · Cartão ••${cardLast4}`
        : `${bankName} · Conta Corrente`;

      const { data: conn, error: dbError } = await db
        .from('bank_connections')
        .upsert(
          {
            household_id: householdId,
            account_hash: accountHash,
            bank_code: bankCode,
            bank_name: bankName,
            account_type: accountType,
            display_name: displayName,
            consent_status: 'active',
            payer_cpf: cpf,
            open_finance_link: openFinanceLink,
            card_last4: cardLast4 ?? null,
          },
          { onConflict: 'household_id,account_hash', ignoreDuplicates: false },
        )
        .select('id')
        .single();

      if (dbError) throw dbError;

      // 5. Marcar household como Open Finance ativo
      await db.from('households').update({ has_open_finance: true }).eq('id', householdId);

      return res.status(201).json({
        connectionId: conn.id,
        accountHash: accountHash,
        displayName,
        openFinanceLink,
      });
    }

    // ── DELETE — revogar conexão ──────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { householdId, connectionId } = req.body as {
        householdId?: string;
        connectionId?: string;
      };

      if (!householdId || !connectionId) {
        return res.status(400).json({ error: 'householdId e connectionId obrigatórios' });
      }
      if (!(await isMember(sub, householdId))) return res.status(403).json({ error: 'Forbidden' });

      const { data: conn } = await db
        .from('bank_connections')
        .select('account_hash, payer_cpf')
        .eq('id', connectionId)
        .eq('household_id', householdId)
        .maybeSingle();

      if (!conn) return res.status(404).json({ error: 'Conexão não encontrada' });

      if (conn.payer_cpf && conn.account_hash) {
        // Falha na revogação remota não impede marcar como revogado aqui
        await revokeOpenFinance(conn.payer_cpf, conn.account_hash).catch(() => {});
      }

      await db.from('bank_connections').update({ consent_status: 'revoked' }).eq('id', connectionId);

      // Sem conexões ativas restantes → desliga a flag do household
      const { count } = await db
        .from('bank_connections')
        .select('id', { count: 'exact', head: true })
        .eq('household_id', householdId)
        .eq('consent_status', 'active');

      if (!count) {
        await db.from('households').update({ has_open_finance: false }).eq('id', householdId);
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: unknown) {
    if (err instanceof TSError) {
      const status = err.status === 422 ? 422 : 502;
      return res.status(status).json({ error: `Technospeed: ${err.message}`, detail: err.body });
    }
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return res.status(500).json({ error: msg });
  }
}
