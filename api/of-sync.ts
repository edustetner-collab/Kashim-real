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

// ─── Categorias do Kashim (espelha CategoryType em types.ts) ─────────────────

const CAT_INCOME = 'Renda';
const CAT_FIXED = 'Contas Fixas';
const CAT_VARIABLE = 'Contas Variáveis';
const CAT_LEISURE = 'Lazer e Gastos Pessoais';

type OFDirection = 'expense' | 'income' | 'savings' | 'ignore';
type OFAccountType = 'credit_card' | 'checking';

// ─── Mapa de categorias (espelha lib/openfinance/categoryMap.ts) ─────────────

const CC_CODE_MAP: Record<string, string> = {
  ELECTRICITY: CAT_FIXED, UTILITIES: CAT_FIXED, TELECOM: CAT_FIXED, INTERNET: CAT_FIXED,
  INSURANCE: CAT_FIXED, RENT: CAT_FIXED, MORTGAGE: CAT_FIXED, SCHOOL: CAT_FIXED,
  HEALTH: CAT_FIXED, MEDICALSERVICES: CAT_FIXED, SUBSCRIPTION: CAT_FIXED, WELLNESSANDFITNESS: CAT_FIXED,
  SERVICES: CAT_VARIABLE, VEHICLEMAINTENANCE: CAT_VARIABLE, AUTOMOTIVE: CAT_VARIABLE,
  GASSTATIONS: CAT_VARIABLE, FOOD: CAT_VARIABLE, SUPERMARKET: CAT_VARIABLE, RESTAURANT: CAT_VARIABLE,
  TRANSPORT: CAT_VARIABLE, CLOTHING: CAT_VARIABLE, HOMEIMPROVEMENT: CAT_VARIABLE,
  DIGITALSERVICES: CAT_VARIABLE, ENTREPRENEURIALACTIVITIES: CAT_VARIABLE,
  LATEPAYMENTANDOVERDRAFTCOSTS: CAT_VARIABLE,
  ENTERTAINMENT: CAT_LEISURE, RECREATION: CAT_LEISURE, PERSONALCARE: CAT_LEISURE,
  TRAVEL: CAT_LEISURE, BARS: CAT_LEISURE,
};

const LABEL_DIRECTION_MAP: Record<string, OFDirection> = {
  salário: 'income', salario: 'income', rendimentos: 'income', renda: 'income',
  remuneração: 'income', remuneracao: 'income', vendas: 'income', reembolso: 'income',
  investimentos: 'savings', investimento: 'savings', aplicação: 'savings', aplicacao: 'savings',
  transferência: 'ignore', transferencia: 'ignore',
};

const LABEL_CATEGORY_MAP: Record<string, string> = {
  moradia: CAT_FIXED, aluguel: CAT_FIXED, condomínio: CAT_FIXED, condominio: CAT_FIXED,
  utilidades: CAT_FIXED, utilidade: CAT_FIXED, água: CAT_FIXED, agua: CAT_FIXED,
  energia: CAT_FIXED, luz: CAT_FIXED, gás: CAT_FIXED, gas: CAT_FIXED, internet: CAT_FIXED,
  telefone: CAT_FIXED, saúde: CAT_FIXED, saude: CAT_FIXED, plano: CAT_FIXED, escola: CAT_FIXED,
  educação: CAT_FIXED, educacao: CAT_FIXED, academia: CAT_FIXED,
  alimentação: CAT_VARIABLE, alimentacao: CAT_VARIABLE, supermercado: CAT_VARIABLE,
  mercado: CAT_VARIABLE, restaurante: CAT_VARIABLE, transporte: CAT_VARIABLE,
  combustível: CAT_VARIABLE, combustivel: CAT_VARIABLE, veículo: CAT_VARIABLE, veiculo: CAT_VARIABLE,
  serviços: CAT_VARIABLE, servicos: CAT_VARIABLE, serviço: CAT_VARIABLE, servico: CAT_VARIABLE,
  lazer: CAT_LEISURE, entretenimento: CAT_LEISURE, viagem: CAT_LEISURE, pessoal: CAT_LEISURE,
};

function normalizeLabel(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

interface CategorySuggestion {
  category: string | null;
  direction: OFDirection;
  confidence: 'high' | 'medium' | 'low';
}

function suggestCategory(params: {
  accountType: OFAccountType;
  rawDirection: 'credit' | 'debit';
  code: string;
  ofCategory: string | null;
}): CategorySuggestion {
  const { accountType, rawDirection, code, ofCategory } = params;

  if (code === 'CREDITCARDPAYMENT') return { category: null, direction: 'ignore', confidence: 'high' };
  if (code === 'TEV') return { category: null, direction: 'ignore', confidence: 'high' };

  const normalizedLabel = ofCategory ? normalizeLabel(ofCategory) : '';

  if (accountType === 'checking') {
    if (normalizedLabel) {
      const dirOverride = LABEL_DIRECTION_MAP[normalizedLabel];
      if (dirOverride === 'income') return { category: CAT_INCOME, direction: 'income', confidence: 'high' };
      if (dirOverride === 'savings') return { category: null, direction: 'savings', confidence: 'high' };
      if (dirOverride === 'ignore') return { category: null, direction: 'ignore', confidence: 'high' };
    }

    if (rawDirection === 'credit') {
      return { category: CAT_INCOME, direction: 'income', confidence: 'low' };
    }

    if (normalizedLabel) {
      const cat = LABEL_CATEGORY_MAP[normalizedLabel];
      if (cat) return { category: cat, direction: 'expense', confidence: 'high' };
    }
    return { category: CAT_VARIABLE, direction: 'expense', confidence: 'low' };
  }

  if (rawDirection === 'credit') {
    return { category: null, direction: 'ignore', confidence: 'high' };
  }

  const ccCat = CC_CODE_MAP[code?.toUpperCase() ?? ''];
  if (ccCat) return { category: ccCat, direction: 'expense', confidence: 'medium' };

  if (normalizedLabel) {
    const labelCat = LABEL_CATEGORY_MAP[normalizedLabel];
    if (labelCat) return { category: labelCat, direction: 'expense', confidence: 'medium' };
  }

  return { category: CAT_VARIABLE, direction: 'expense', confidence: 'low' };
}

// ─── Parser (espelha lib/openfinance/parser.ts) ──────────────────────────────

interface OFRawTransaction {
  transactionId: string;
  transactionType: 'credit' | 'debit';
  code: string;
  amount: string;
  date: string;
  description: string;
  fitid: string | null;
  category: string | null;
  creditCardNumber?: string | null;
  creditCardBill?: { dueDate: string | null; totalAmount: number | null };
  paymentMethod?: string | null;
}

interface OFRawBlock {
  credit?: OFRawTransaction[];
  debit?: OFRawTransaction[];
}

interface OFRawEnvelope {
  statement: { bankCode: string; accountHash: string; status?: string; type?: string; totalTransactions?: string };
  transaction?: OFRawBlock;
  /**
   * A API separa em outro bloco as transações que já constaram em protocolos
   * anteriores. Em alguns retornos `transaction` vem vazio e TUDO cai aqui —
   * por isso lemos os dois. A duplicata real é barrada pelo UNIQUE
   * (household_id, transaction_id) no upsert.
   */
  transactionDuplicated?: OFRawBlock;
}

interface OFTransaction {
  transactionId: string;
  fitid: string | null;
  accountType: OFAccountType;
  direction: OFDirection;
  amount: number;
  date: string;
  description: string;
  ofCode: string;
  ofCategory: string | null;
  paymentMethod: string | null;
  cardLast4: string | null;
  billDueDate: string | null;
  billTotal: number | null;
  suggestedCategory: string | null;
  suggestionConfidence: 'high' | 'medium' | 'low';
  installmentInfo: { current: number; total: number } | null;
}

/** "SalÃ¡rio" → "Salário" (bytes Latin-1 lidos como UTF-8) */
function fixMojibake(s: string): string {
  if (!s) return s;
  try {
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
    const decoded = new TextDecoder('utf-8').decode(bytes);
    return decoded.includes('�') ? s : decoded;
  } catch {
    return s;
  }
}

function detectInstallment(desc: string): { current: number; total: number } | null {
  const match = desc.match(/\s(\d{2})\/(\d{2})$/);
  if (!match) return null;
  const current = parseInt(match[1], 10);
  const total = parseInt(match[2], 10);
  if (isNaN(current) || isNaN(total) || total === 0) return null;
  return { current, total };
}

function normalizeTx(
  raw: OFRawTransaction,
  accountType: OFAccountType,
  direction: OFDirection,
): OFTransaction {
  const desc = fixMojibake(raw.description ?? '').trim();
  const ofCategory = raw.category ? fixMojibake(raw.category) : null;

  const suggestion = suggestCategory({
    accountType,
    rawDirection: raw.transactionType,
    code: raw.code,
    ofCategory,
  });

  return {
    transactionId: raw.transactionId,
    fitid: raw.fitid ?? null,
    accountType,
    direction,
    amount: Math.abs(parseFloat(raw.amount) || 0),
    date: raw.date,
    description: desc,
    ofCode: raw.code,
    ofCategory,
    paymentMethod: raw.paymentMethod ?? null,
    cardLast4: raw.creditCardNumber ?? null,
    billDueDate: raw.creditCardBill?.dueDate ?? null,
    billTotal: raw.creditCardBill?.totalAmount ?? null,
    suggestedCategory: suggestion.direction === 'ignore' ? null : suggestion.category,
    suggestionConfidence: suggestion.confidence,
    installmentInfo: detectInstallment(desc),
  };
}

/**
 * Achata o envelope da Technospeed em transações normalizadas.
 * CREDITCARDPAYMENT, TEV e estornos de cartão são descartados —
 * pagamento de fatura não é gasto (a compra original já foi contada).
 */
function parseStatement(envelope: OFRawEnvelope): OFTransaction[] {
  const stmt = envelope.statement;
  const accountType: OFAccountType = stmt.type === 'credit_card' ? 'credit_card' : 'checking';

  // Juntar os dois blocos: há retornos em que `transaction` vem vazio e as
  // movimentações aparecem só em `transactionDuplicated`.
  const credits = [
    ...(envelope.transaction?.credit ?? []),
    ...(envelope.transactionDuplicated?.credit ?? []),
  ];
  const debits = [
    ...(envelope.transaction?.debit ?? []),
    ...(envelope.transactionDuplicated?.debit ?? []),
  ];
  const results: OFTransaction[] = [];

  for (const tx of debits) {
    const suggestion = suggestCategory({
      accountType,
      rawDirection: 'debit',
      code: tx.code,
      ofCategory: tx.category,
    });
    if (suggestion.direction === 'ignore') continue;
    results.push(normalizeTx(tx, accountType, suggestion.direction));
  }

  for (const tx of credits) {
    if (tx.code === 'CREDITCARDPAYMENT') continue;
    if (tx.code === 'TEV') continue;
    if (accountType === 'credit_card') continue; // estornos — fora do MVP

    const suggestion = suggestCategory({
      accountType,
      rawDirection: 'credit',
      code: tx.code,
      ofCategory: tx.category,
    });
    if (suggestion.direction === 'ignore') continue;
    results.push(normalizeTx(tx, accountType, suggestion.direction));
  }

  return results;
}

// ─── Cliente Technospeed (embutido) ──────────────────────────────────────────

const TS_BASE_URL = (process.env.TECHNOSPEED_BASE_URL ?? 'https://api.pagamentobancario.com.br').replace(/\/$/, '');
const TS_CNPJ_SH = process.env.TECHNOSPEED_CNPJ_SH ?? '';
const TS_TOKEN_SH = process.env.TECHNOSPEED_TOKEN_SH ?? '';

// Proxy de IP fixo (Droplet DigitalOcean). A Technospeed libera por IP e o
// Vercel não tem IP de saída estável, então toda chamada passa por aqui.
// Sem PROXY_URL configurado, cai no caminho direto (útil em dev).
const PROXY_URL = (process.env.PROXY_URL ?? '').replace(/\/$/, '');
const PROXY_SECRET = process.env.PROXY_SECRET ?? '';

class TSError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: unknown,
  ) {
    super(`Technospeed ${status} ${path}`);
  }
}

/** Chama a Technospeed através do proxy de IP fixo. */
async function tsViaProxy<T>(method: string, path: string, payerCpf: string, body?: unknown): Promise<T> {
  const res = await fetch(`${PROXY_URL}/proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PROXY_SECRET}`,
    },
    body: JSON.stringify({ method, path, payerCpf, body }),
  });

  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }

  // O proxy devolve { status, body } repetindo o status original da Technospeed.
  // Qualquer outro formato é falha do próprio proxy (401, 502, fora do ar).
  const envelope = parsed && typeof parsed === 'object' && 'status' in parsed
    ? parsed as { status: number; body: unknown }
    : null;
  if (!envelope) throw new TSError(res.status, path, parsed);

  if (envelope.status < 200 || envelope.status >= 300) {
    throw new TSError(envelope.status, path, envelope.body);
  }
  return envelope.body as T;
}

async function tsReq<T>(method: string, path: string, payerCpf: string, body?: unknown): Promise<T> {
  if (PROXY_URL) return tsViaProxy<T>(method, path, payerCpf, body);

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

/**
 * Solicita a geração do extrato e devolve o protocolo.
 * A documentação alterna entre `uniqueid` e `uniqueId` conforme a página —
 * aceitamos as duas grafias para não quebrar por causa de um "I".
 */
async function requestStatement(
  payerCpf: string,
  params: { accountHash: string; dateStart: string; dateEnd: string; statementType: 'BANK' | 'CREDIT_CARD'; cardNumber?: string },
): Promise<string> {
  const res = await tsReq<Record<string, unknown>>('POST', '/api/v1/statement/openfinance', payerCpf, {
    accountHash: params.accountHash,
    dateStart: params.dateStart,
    dateEnd: params.dateEnd,
    statementType: params.statementType,
    ...(params.cardNumber ? { cardNumber: params.cardNumber } : {}),
  });

  const id = res?.uniqueId ?? res?.uniqueid;
  if (typeof id !== 'string' || !id) {
    throw new Error('Technospeed não devolveu o protocolo (uniqueId) do extrato');
  }
  return id;
}

/**
 * Lê o extrato inteiro numa requisição só.
 * Existe uma variante `/paginated`, mas com limite de 3 req/min não compensa:
 * buscar 5 páginas levaria mais de um minuto e estouraria a cota.
 */
async function fetchStatement(payerCpf: string, uniqueId: string): Promise<OFRawEnvelope> {
  return tsReq('GET', `/api/v1/statement/openfinance/${uniqueId}`, payerCpf);
}

// ─── Helpers de data ──────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Primeiro dia do mês corrente — nada anterior é importado (§3.3 do design) */
function cutoffDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function syncRange(lastSyncedAt: string | null): { dateStart: string; dateEnd: string } {
  const today = toDateStr(new Date());
  if (lastSyncedAt) {
    // Recua 2 dias para pegar lançamentos que o banco publicou com atraso
    const d = new Date(lastSyncedAt);
    if (!isNaN(d.getTime())) {
      d.setDate(d.getDate() - 2);
      return { dateStart: toDateStr(d), dateEnd: today };
    }
  }
  const start = new Date();
  start.setDate(start.getDate() - 90);
  return { dateStart: toDateStr(start), dateEnd: today };
}

// ─── Limites da Technospeed (documentados na base de conhecimento) ───────────
//
//   POST /statement/openfinance ......... 1 SUCESSO a cada 6 HORAS
//   GET  /statement/openfinance/{id} .... 3 req/min, resposta em cache por 1h
//
// Por isso NÃO fazemos polling: com cache de 1 hora, insistir devolve sempre a
// mesma resposta e só queima a cota. Fazemos uma leitura por execução; se ainda
// não estiver pronto, devolvemos 'processing' e a próxima execução tenta de novo.

const PROTOCOL_WINDOW_MS = 6 * 60 * 60 * 1000;

// ─── Sync de uma conexão ──────────────────────────────────────────────────────

interface SyncResult {
  status: 'done' | 'processing' | 'error';
  upserted?: number;
  uniqueId?: string;
  reason?: string;
  connectionId?: string;
}

interface ConnectionRow {
  id: string;
  household_id: string;
  account_hash: string;
  payer_cpf: string;
  account_type: string;
  card_last4: string | null;
  last_synced_at: string | null;
  last_protocol_id: string | null;
  last_protocol_at: string | null;
}

async function syncConnection(conn: ConnectionRow): Promise<SyncResult> {
  const {
    household_id, account_hash, payer_cpf, account_type, card_last4,
    last_synced_at, last_protocol_id, last_protocol_at,
  } = conn;
  const statementType: 'BANK' | 'CREDIT_CARD' = account_type === 'credit_card' ? 'CREDIT_CARD' : 'BANK';

  // 1. Protocolo: reaproveitar o da janela de 6h em vez de pedir um novo.
  //    Gerar protocolo tem limite de 1 sucesso a cada 6 horas por conta.
  const protocolAge = last_protocol_at ? Date.now() - new Date(last_protocol_at).getTime() : Infinity;
  const protocolAindaValido = !!last_protocol_id && protocolAge < PROTOCOL_WINDOW_MS;

  let protocolId: string;
  if (protocolAindaValido) {
    protocolId = last_protocol_id!;
  } else {
    const { dateStart, dateEnd } = syncRange(last_synced_at);
    protocolId = await requestStatement(payer_cpf, {
      accountHash: account_hash,
      dateStart,
      dateEnd,
      statementType,
      ...(statementType === 'CREDIT_CARD' && card_last4 ? { cardNumber: card_last4 } : {}),
    });
    await db
      .from('bank_connections')
      .update({ last_protocol_id: protocolId, last_protocol_at: new Date().toISOString() })
      .eq('id', conn.id);
  }

  // 2. Uma única leitura. Sem polling: a resposta fica em cache por 1 hora,
  //    então insistir devolveria o mesmo resultado e queimaria a cota de 3/min.
  const envelope = await fetchStatement(payer_cpf, protocolId);
  const status = (envelope.statement?.status ?? '').toUpperCase();

  if (status === 'ERROR' || status === 'FAILED') {
    return {
      status: 'error', uniqueId: protocolId, connectionId: conn.id,
      reason: 'A Technospeed não conseguiu processar o extrato',
    };
  }
  // Só tratamos como "ainda processando" quando a API diz isso explicitamente:
  // há retornos de sucesso que vêm SEM o campo `status`, e exigir 'SUCCESS'
  // faria o extrato pronto nunca ser importado.
  if (status === 'PROCESSING' || status === 'PENDING') {
    return { status: 'processing', uniqueId: protocolId, connectionId: conn.id };
  }

  // 3. Parseia e aplica o corte do mês corrente
  const cutoff = cutoffDate();
  const allTx = parseStatement(envelope).filter((tx) => tx.date >= cutoff);

  if (allTx.length === 0) {
    await db.from('bank_connections').update({ last_synced_at: new Date().toISOString() }).eq('id', conn.id);
    return { status: 'done', upserted: 0, connectionId: conn.id };
  }

  // 5. Upsert idempotente — transação já categorizada nunca é resetada
  const rows = allTx.map((tx) => ({
    household_id,
    connection_id: conn.id,
    transaction_id: tx.transactionId,
    fitid: tx.fitid,
    account_type: tx.accountType,
    transaction_type: tx.direction,
    of_code: tx.ofCode ?? null,
    of_category: tx.ofCategory,
    amount: tx.amount,
    transaction_date: tx.date,
    description: tx.description,
    payment_method: tx.paymentMethod,
    card_last4: tx.cardLast4,
    bill_due_date: tx.billDueDate,
    bill_total: tx.billTotal,
    suggested_category: tx.suggestedCategory,
    suggestion_confidence: tx.suggestionConfidence,
    installment_current: tx.installmentInfo?.current ?? null,
    installment_total: tx.installmentInfo?.total ?? null,
    status: 'pending',
  }));

  const { data: upserted, error } = await db
    .from('bank_transactions')
    .upsert(rows, { onConflict: 'household_id,transaction_id', ignoreDuplicates: true })
    .select('id');

  if (error) throw error;

  await db.from('bank_connections').update({ last_synced_at: new Date().toISOString() }).eq('id', conn.id);

  return { status: 'done', upserted: upserted?.length ?? 0, connectionId: conn.id };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });
  const sub = claims.sub;

  if (!TS_CNPJ_SH || !TS_TOKEN_SH) {
    return res.status(500).json({ error: 'Credenciais Technospeed não configuradas no servidor.' });
  }

  try {
    const { householdId, connectionId } = req.body as {
      householdId?: string;
      connectionId?: string;
    };

    if (!householdId) return res.status(400).json({ error: 'householdId obrigatório' });
    if (!(await isMember(sub, householdId))) return res.status(403).json({ error: 'Forbidden' });

    let query = db
      .from('bank_connections')
      .select('id, household_id, account_hash, payer_cpf, account_type, card_last4, last_synced_at, last_protocol_id, last_protocol_at')
      .eq('household_id', householdId)
      .eq('consent_status', 'active');

    if (connectionId) query = query.eq('id', connectionId);

    const { data: connections, error: connError } = await query;
    if (connError) throw connError;
    if (!connections || connections.length === 0) {
      return res.status(404).json({ error: 'Nenhuma conexão bancária ativa encontrada' });
    }

    // Sequencial, não em paralelo: a leitura do protocolo tem limite de
    // 3 req/min. Em paralelo, um household com várias contas estouraria.
    const results: SyncResult[] = [];
    for (const conn of connections) {
      const r = await syncConnection(conn as ConnectionRow).catch((err): SyncResult => ({
        status: 'error',
        connectionId: conn.id,
        reason: err instanceof TSError
          ? `Technospeed respondeu ${err.status}`
          : err instanceof Error ? err.message : 'Erro desconhecido',
      }));
      results.push(r);
    }

    const totalUpserted = results.reduce((sum, r) => sum + (r.upserted ?? 0), 0);
    const anyProcessing = results.some((r) => r.status === 'processing');
    const errors = results.filter((r) => r.status === 'error');

    return res.status(200).json({
      status: anyProcessing
        ? 'processing'
        : errors.length === results.length ? 'error' : 'done',
      upserted: totalUpserted,
      // uniqueId volta para o cliente reenviar sem gerar novo protocolo
      pending: results
        .filter((r) => r.status === 'processing')
        .map((r) => ({ uniqueId: r.uniqueId, connectionId: r.connectionId })),
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: unknown) {
    if (err instanceof TSError) {
      return res.status(502).json({ error: `Technospeed: ${err.message}`, detail: err.body });
    }
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return res.status(500).json({ error: msg });
  }
}
