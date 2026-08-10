import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

/**
 * Sincronização automática do Extrato Open Finance.
 *
 * Por que é um cron e não um botão: o Open Finance é assíncrono por natureza —
 * o banco leva de 6 a 24h para liberar o histórico depois da autorização, e a
 * Technospeed permite gerar 1 protocolo a cada 6 horas por conta. Não existe
 * "sincronizar agora" que funcione; o que traz os dados é a rotina.
 *
 * Roda 2x ao dia (ver crons no vercel.json). Cada execução, por conexão:
 *   1. reaproveita o protocolo da janela de 6h, ou gera um novo
 *   2. faz UMA leitura (a resposta fica em cache por 1h — polling é inútil)
 *   3. importa o que estiver pronto
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const CRON_SECRET = process.env.CRON_SECRET ?? '';

const TS_BASE_URL = (process.env.TECHNOSPEED_BASE_URL ?? 'https://api.pagamentobancario.com.br').replace(/\/$/, '');
const TS_CNPJ_SH = process.env.TECHNOSPEED_CNPJ_SH ?? '';
const TS_TOKEN_SH = process.env.TECHNOSPEED_TOKEN_SH ?? '';

// Proxy de IP fixo (Droplet DigitalOcean). A Technospeed libera por IP e o
// Vercel não tem IP de saída estável, então toda chamada passa por aqui.
// Sem PROXY_URL configurado, cai no caminho direto (útil em dev).
const PROXY_URL = (process.env.PROXY_URL ?? '').replace(/\/$/, '');
const PROXY_SECRET = process.env.PROXY_SECRET ?? '';

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── Limites da Technospeed ──────────────────────────────────────────────────
const PROTOCOL_WINDOW_MS = 6 * 60 * 60 * 1000; // 1 protocolo a cada 6h por conta
const READ_GAP_MS = 21_000;                    // leitura: 3 req/min → 1 a cada 20s

// ─── Cliente HTTP (embutido: Vercel não empacota import local em api/) ───────

class TSError extends Error {
  constructor(public readonly status: number, public readonly path: string, public readonly body: unknown) {
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
      'User-Agent': 'Kashim/1.0',
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

// ─── Categorização (espelha lib/openfinance/categoryMap.ts) ──────────────────

const CAT_INCOME = 'Renda';
const CAT_FIXED = 'Contas Fixas';
const CAT_VARIABLE = 'Contas Variáveis';
const CAT_LEISURE = 'Lazer e Gastos Pessoais';

type OFDirection = 'expense' | 'income' | 'savings' | 'ignore';
type OFAccountType = 'credit_card' | 'checking';

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

function suggestCategory(p: {
  accountType: OFAccountType; rawDirection: 'credit' | 'debit'; code: string; ofCategory: string | null;
}): { category: string | null; direction: OFDirection; confidence: 'high' | 'medium' | 'low' } {
  const { accountType, rawDirection, code, ofCategory } = p;
  if (code === 'CREDITCARDPAYMENT') return { category: null, direction: 'ignore', confidence: 'high' };
  if (code === 'TEV') return { category: null, direction: 'ignore', confidence: 'high' };

  const label = ofCategory ? normalizeLabel(ofCategory) : '';

  if (accountType === 'checking') {
    if (label) {
      const dir = LABEL_DIRECTION_MAP[label];
      if (dir === 'income') return { category: CAT_INCOME, direction: 'income', confidence: 'high' };
      if (dir === 'savings') return { category: null, direction: 'savings', confidence: 'high' };
      if (dir === 'ignore') return { category: null, direction: 'ignore', confidence: 'high' };
    }
    if (rawDirection === 'credit') return { category: CAT_INCOME, direction: 'income', confidence: 'low' };
    if (label) {
      const cat = LABEL_CATEGORY_MAP[label];
      if (cat) return { category: cat, direction: 'expense', confidence: 'high' };
    }
    return { category: CAT_VARIABLE, direction: 'expense', confidence: 'low' };
  }

  if (rawDirection === 'credit') return { category: null, direction: 'ignore', confidence: 'high' };

  const ccCat = CC_CODE_MAP[code?.toUpperCase() ?? ''];
  if (ccCat) return { category: ccCat, direction: 'expense', confidence: 'medium' };
  if (label) {
    const c = LABEL_CATEGORY_MAP[label];
    if (c) return { category: c, direction: 'expense', confidence: 'medium' };
  }
  return { category: CAT_VARIABLE, direction: 'expense', confidence: 'low' };
}

// ─── Parser ──────────────────────────────────────────────────────────────────

interface RawTx {
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

interface RawBlock { credit?: RawTx[]; debit?: RawTx[] }

interface Envelope {
  statement: { status?: string; type?: string; totalTransactions?: string };
  transaction?: RawBlock;
  transactionDuplicated?: RawBlock;
}

function fixMojibake(s: string): string {
  if (!s) return s;
  try {
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
    const decoded = new TextDecoder('utf-8').decode(bytes);
    return decoded.includes('�') ? s : decoded;
  } catch { return s; }
}

function detectInstallment(desc: string) {
  const m = desc.match(/\s(\d{2})\/(\d{2})$/);
  if (!m) return null;
  const current = parseInt(m[1], 10), total = parseInt(m[2], 10);
  if (isNaN(current) || isNaN(total) || total === 0) return null;
  return { current, total };
}

function parseStatement(env: Envelope) {
  const accountType: OFAccountType = env.statement?.type === 'credit_card' ? 'credit_card' : 'checking';
  // `transaction` pode vir vazio com tudo em `transactionDuplicated` — ler os dois
  const credits = [...(env.transaction?.credit ?? []), ...(env.transactionDuplicated?.credit ?? [])];
  const debits = [...(env.transaction?.debit ?? []), ...(env.transactionDuplicated?.debit ?? [])];

  const out: Array<ReturnType<typeof normalize>> = [];

  function normalize(raw: RawTx, direction: OFDirection) {
    const desc = fixMojibake(raw.description ?? '').trim();
    const ofCategory = raw.category ? fixMojibake(raw.category) : null;
    const s = suggestCategory({ accountType, rawDirection: raw.transactionType, code: raw.code, ofCategory });
    return {
      transactionId: raw.transactionId,
      fitid: raw.fitid ?? null,
      accountType,
      direction,
      amount: Math.abs(parseFloat(raw.amount) || 0),
      date: raw.date,
      description: desc,
      ofCode: raw.code ?? null,
      ofCategory,
      paymentMethod: raw.paymentMethod ?? null,
      cardLast4: raw.creditCardNumber ?? null,
      billDueDate: raw.creditCardBill?.dueDate ?? null,
      billTotal: raw.creditCardBill?.totalAmount ?? null,
      suggestedCategory: s.direction === 'ignore' ? null : s.category,
      suggestionConfidence: s.confidence,
      installment: detectInstallment(desc),
    };
  }

  for (const tx of debits) {
    const s = suggestCategory({ accountType, rawDirection: 'debit', code: tx.code, ofCategory: tx.category });
    if (s.direction === 'ignore') continue;
    out.push(normalize(tx, s.direction));
  }
  for (const tx of credits) {
    if (tx.code === 'CREDITCARDPAYMENT' || tx.code === 'TEV') continue;
    if (accountType === 'credit_card') continue; // estornos — fora do MVP
    const s = suggestCategory({ accountType, rawDirection: 'credit', code: tx.code, ofCategory: tx.category });
    if (s.direction === 'ignore') continue;
    out.push(normalize(tx, s.direction));
  }
  return out;
}

// ─── Datas ───────────────────────────────────────────────────────────────────

const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

function cutoffDate(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`;
}

function syncRange(lastSyncedAt: string | null) {
  const today = toDateStr(new Date());
  if (lastSyncedAt) {
    const d = new Date(lastSyncedAt);
    if (!isNaN(d.getTime())) {
      d.setDate(d.getDate() - 2); // recua para pegar lançamento atrasado
      return { dateStart: toDateStr(d), dateEnd: today };
    }
  }
  const s = new Date();
  s.setDate(s.getDate() - 90);
  return { dateStart: toDateStr(s), dateEnd: today };
}

// ─── Sync de uma conexão ─────────────────────────────────────────────────────

interface Conn {
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

async function syncOne(conn: Conn): Promise<{ status: string; upserted?: number; reason?: string }> {
  const statementType = conn.account_type === 'credit_card' ? 'CREDIT_CARD' : 'BANK';

  const age = conn.last_protocol_at ? Date.now() - new Date(conn.last_protocol_at).getTime() : Infinity;
  const reaproveitar = !!conn.last_protocol_id && age < PROTOCOL_WINDOW_MS;

  let protocolId: string;
  if (reaproveitar) {
    protocolId = conn.last_protocol_id!;
  } else {
    const { dateStart, dateEnd } = syncRange(conn.last_synced_at);
    const r = await tsReq<Record<string, unknown>>('POST', '/api/v1/statement/openfinance', conn.payer_cpf, {
      accountHash: conn.account_hash,
      dateStart,
      dateEnd,
      statementType,
      ...(statementType === 'CREDIT_CARD' && conn.card_last4 ? { cardNumber: conn.card_last4 } : {}),
    });
    const id = r?.uniqueId ?? r?.uniqueid;
    if (typeof id !== 'string' || !id) return { status: 'error', reason: 'sem uniqueId no protocolo' };
    protocolId = id;
    await db.from('bank_connections')
      .update({ last_protocol_id: protocolId, last_protocol_at: new Date().toISOString() })
      .eq('id', conn.id);
  }

  const env = await tsReq<Envelope>('GET', `/api/v1/statement/openfinance/${protocolId}`, conn.payer_cpf);
  const status = (env.statement?.status ?? '').toUpperCase();

  if (status === 'ERROR' || status === 'FAILED') return { status: 'error', reason: 'processamento falhou' };
  if (status === 'PROCESSING' || status === 'PENDING') return { status: 'processing' };

  const cutoff = cutoffDate();
  const txs = parseStatement(env).filter((t) => t.date >= cutoff);

  if (txs.length === 0) {
    await db.from('bank_connections')
      .update({ last_synced_at: new Date().toISOString(), needs_resync: false })
      .eq('id', conn.id);
    return { status: 'done', upserted: 0 };
  }

  const rows = txs.map((t) => ({
    household_id: conn.household_id,
    connection_id: conn.id,
    transaction_id: t.transactionId,
    fitid: t.fitid,
    account_type: t.accountType,
    transaction_type: t.direction,
    of_code: t.ofCode,
    of_category: t.ofCategory,
    amount: t.amount,
    transaction_date: t.date,
    description: t.description,
    payment_method: t.paymentMethod,
    card_last4: t.cardLast4,
    bill_due_date: t.billDueDate,
    bill_total: t.billTotal,
    suggested_category: t.suggestedCategory,
    suggestion_confidence: t.suggestionConfidence,
    installment_current: t.installment?.current ?? null,
    installment_total: t.installment?.total ?? null,
    status: 'pending',
  }));

  const { data, error } = await db
    .from('bank_transactions')
    .upsert(rows, { onConflict: 'household_id,transaction_id', ignoreDuplicates: true })
    .select('id');
  if (error) throw error;

  await db.from('bank_connections')
    .update({ last_synced_at: new Date().toISOString(), needs_resync: false })
    .eq('id', conn.id);

  return { status: 'done', upserted: data?.length ?? 0 };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');

  // Vercel Cron envia "Authorization: Bearer ${CRON_SECRET}" automaticamente
  const auth = (req.headers.authorization as string | undefined) ?? '';
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!TS_CNPJ_SH || !TS_TOKEN_SH) {
    return res.status(500).json({ error: 'Credenciais Technospeed não configuradas' });
  }

  try {
    // needs_resync primeiro (webhook sinalizou transação nova), depois as mais antigas
    const { data: conns, error } = await db
      .from('bank_connections')
      .select('id, household_id, account_hash, payer_cpf, account_type, card_last4, last_synced_at, last_protocol_id, last_protocol_at, needs_resync')
      .eq('consent_status', 'active')
      .order('needs_resync', { ascending: false })
      .order('last_synced_at', { ascending: true, nullsFirst: true })
      .limit(40);

    if (error) throw error;
    if (!conns || conns.length === 0) return res.status(200).json({ ok: true, connections: 0 });

    let done = 0, processing = 0, errors = 0, upserted = 0;
    const deadline = Date.now() + 240_000; // margem dentro do maxDuration de 300s

    for (const conn of conns) {
      if (Date.now() > deadline) break; // resto fica para a próxima execução
      try {
        const r = await syncOne(conn as Conn);
        if (r.status === 'done') { done++; upserted += r.upserted ?? 0; }
        else if (r.status === 'processing') processing++;
        else errors++;
      } catch {
        errors++;
      }
      // Respeita 3 leituras/min: uma conexão a cada ~21s
      await new Promise((r) => setTimeout(r, READ_GAP_MS));
    }

    return res.status(200).json({ ok: true, done, processing, errors, upserted });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return res.status(500).json({ error: msg });
  }
}
