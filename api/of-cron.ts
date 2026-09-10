import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

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
const STATUS_GAP_MS = 2_000;                   // folga entre consultas de status
const MAX_STATUS_CHECKS = 10;                  // teto para não comer o deadline
// 4 protocolos/dia por conta: 1 vai para a conta corrente, sobram 3 para cartões.
const MAX_CARDS_PER_ACCOUNT = 3;

// ─── Aviso por e-mail ────────────────────────────────────────────────────────

const resend = new Resend(process.env.RESEND_API_KEY);
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? '';
const OF_BETA_USER_IDS = (process.env.OF_BETA_USER_IDS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const OF_BETA_EMAILS = ['eduardo_cda@hotmail.com'];

/**
 * Destinatário do aviso — já filtrado pelo portão do Open Finance.
 *
 * O portão vale para e-mail também: um "seus gastos chegaram" na caixa de
 * entrada é superfície de Open Finance tanto quanto um botão na tela. Cliente
 * fora da lista não recebe nada, mesmo que a conexão dele exista no banco.
 */
/**
 * Push para os aparelhos daquela casa (OneSignal).
 *
 * Roda ao lado do e-mail, não no lugar dele: o e-mail alcança quem não instalou
 * o app e serve de registro; o push é o que traz a pessoa de volta na hora. O
 * cliente pediu exatamente isto — saber que chegou transação nova sem precisar
 * abrir o app para descobrir (Eduardo, 2026-09-10).
 *
 * Silencioso de propósito quando não há credencial ou aparelho: até a build com
 * push chegar na App Store, `push_devices` fica vazia e isto não faz nada. O
 * aviso continua saindo por e-mail.
 */
async function pushParaCasa(householdId: string, titulo: string, corpo: string): Promise<boolean> {
  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) return false;

  const { data: devices } = await db
    .from('push_devices')
    .select('onesignal_id')
    .eq('household_id', householdId);

  // `apns:...` é o registro de reserva que o push-register grava quando o
  // OneSignal não devolveu o id da inscrição. Não serve para disparar.
  const ids = (devices ?? [])
    .map((d) => d.onesignal_id as string)
    .filter((x) => x && !x.startsWith('apns:'));
  if (ids.length === 0) return false;

  try {
    const r = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify({
        app_id: appId,
        include_subscription_ids: ids,
        headings: { en: titulo, pt: titulo },
        contents: { en: corpo, pt: corpo },
        // Abre direto no Extrato em vez da home: o aviso é sobre a fila, e
        // fazer o cliente procurar onde clicar desperdiça o clique que ele já deu.
        url: 'https://app.kashim.com.br/?abrir=extrato',
        ios_sound: 'kashim.wav',
        android_channel_id: undefined,
      }),
    });
    return r.ok;
  } catch {
    return false; // push é acessório: falha aqui nunca derruba a sincronização
  }
}

async function notifyTargetFor(householdId: string): Promise<{ email: string; firstName: string } | null> {
  if (!CLERK_SECRET_KEY) return null;

  const { data: members } = await db
    .from('household_members')
    .select('clerk_user_id')
    .eq('household_id', householdId);

  for (const m of members ?? []) {
    const uid = m.clerk_user_id as string | null;
    if (!uid) continue;
    try {
      const r = await fetch(`https://api.clerk.com/v1/users/${uid}`, {
        headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
      });
      if (!r.ok) continue;
      const u = await r.json() as {
        first_name?: string;
        primary_email_address_id?: string;
        email_addresses?: Array<{ id: string; email_address: string }>;
      };
      const primary = u.email_addresses?.find((e) => e.id === u.primary_email_address_id)
        ?? u.email_addresses?.[0];
      const email = primary?.email_address;
      if (!email) continue;

      const allowed = OF_BETA_USER_IDS.includes(uid) || OF_BETA_EMAILS.includes(email.toLowerCase());
      if (!allowed) continue;

      return { email, firstName: u.first_name ?? '' };
    } catch { /* tenta o próximo membro */ }
  }
  return null;
}

function emailShell(title: string, body: string, cta: string): string {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#141413">
  <h1 style="font-size:22px;font-weight:800;margin:0 0 12px">${title}</h1>
  <div style="font-size:15px;line-height:1.6;color:#3a3a3c">${body}</div>
  <a href="https://kashim.com.br" style="display:inline-block;margin-top:24px;background:#7ab800;color:#fff;font-weight:700;font-size:14px;text-decoration:none;padding:13px 26px;border-radius:12px">${cta}</a>
  <p style="font-size:12px;color:#8e8e93;margin-top:28px">Kashim · seus gastos, sem digitar</p>
</div>`;
}

async function sendMail(to: string, subject: string, html: string): Promise<void> {
  try {
    await resend.emails.send({ from: 'Kashim <noreply@kashim.com.br>', to, subject, html });
  } catch { /* aviso é acessório: nunca derruba a sincronização */ }
}

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

/**
 * Nunca é gasto. Medido no extrato real do Bradesco em 2026-08-11: estes três
 * somavam R$ 78.278, ou 57% de tudo que o app contava como despesa.
 * CREDITCARDFEES é a FATURA — as compras do cartão já entram uma a uma, então
 * contar o pagamento da fatura soma tudo duas vezes.
 * Espelha `IGNORE_CODES` de lib/openfinance/categoryMap.ts.
 */
const IGNORE_CODES = new Set([
  'CREDITCARDPAYMENT', 'CREDITCARDFEES',
  'SAMEPERSONTRANSFER', 'SAMEPERSONTRANSFERCASH', 'TEV',
]);

/** Ambíguo (pagar alguém ou só remanejar): entra sem sugestão, cliente decide. */
const ASK_USER_CODES = new Set(['TRANSFERPIX', 'TRANSFERBANKSLIP', 'TRANSFERTED', 'TRANSFERDOC']);

const CC_CODE_MAP: Record<string, string> = {
  // Vocabulario REAL do Bradesco, medido no extrato de cartao em 2026-08-14.
  // Os codigos abaixo cobriam ~100 de 235 transacoes e NENHUM estava mapeado —
  // caiam todos em "Variavel" por omissao. Era por isso que nada aparecia como
  // Lazer: os codigos de lazer do nosso mapa (ENTERTAINMENT, BARS, TRAVEL)
  // nao sao usados por este banco.
  BOOKSTORE: CAT_LEISURE,            // livraria / Amazon
  ELECTRONICS: CAT_LEISURE,          // eletronicos
  SHOPPING: CAT_LEISURE,             // compras em geral
  KIDSANDTOYS: CAT_LEISURE,          // brinquedos
  MILEAGEPROGRAMS: CAT_LEISURE,      // programa de milhas
  EATINGOUT: CAT_LEISURE,           // comer fora
  PHARMACY: CAT_VARIABLE,            // farmacia
  PUBLICTRANSPORTATION: CAT_FIXED,
  DIGITALSERVICES: CAT_FIXED,      // streaming e apps — estilo de vida, nao conta
  ELECTRICITY: CAT_FIXED, UTILITIES: CAT_FIXED, TELECOM: CAT_FIXED, INTERNET: CAT_FIXED,
  WATER: CAT_FIXED, TELECOMMUNICATIONS: CAT_FIXED, HOUSING: CAT_FIXED, EDUCATION: CAT_FIXED,
  TAXES: CAT_FIXED, TAXONFINANCIALOPERATIONS: CAT_FIXED, BANKFEES: CAT_FIXED,
  GROCERIES: CAT_FIXED, OFFICESUPPLIES: CAT_VARIABLE, ONLINEBET: CAT_LEISURE,
  INSURANCE: CAT_FIXED, RENT: CAT_FIXED, MORTGAGE: CAT_FIXED, SCHOOL: CAT_FIXED,
  HEALTH: CAT_FIXED, MEDICALSERVICES: CAT_FIXED, SUBSCRIPTION: CAT_FIXED, WELLNESSANDFITNESS: CAT_FIXED,
  SERVICES: CAT_VARIABLE, VEHICLEMAINTENANCE: CAT_VARIABLE, AUTOMOTIVE: CAT_VARIABLE,
  GASSTATIONS: CAT_FIXED, FOOD: CAT_LEISURE, SUPERMARKET: CAT_FIXED, RESTAURANT: CAT_LEISURE,
  TRANSPORT: CAT_FIXED, CLOTHING: CAT_LEISURE, HOMEIMPROVEMENT: CAT_VARIABLE,
  ENTREPRENEURIALACTIVITIES: CAT_VARIABLE,
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

/**
 * Categoria pelo NOME do estabelecimento — última camada antes de desistir.
 *
 * Duplicado de lib/openfinance/categoryMap.ts porque o Vercel não empacota
 * import local em `api/`. Mudou lá, muda aqui: as duas listas precisam contar
 * a mesma história, senão o cron classifica de um jeito e a tela de outro.
 *
 * Sem esta camada tudo que o banco não rotulava caía em "Variável" — o cliente
 * via "ECO POSTO DE COMBUSTIVEL" como imprevisto e perdia a fé na sugestão.
 * As categorias seguem o método: mercado e gasolina são CONTA FIXA (têm teto
 * mensal), restaurante e delivery são LAZER, farmácia é variável.
 */
const MERCHANT_PATTERNS: Array<[RegExp, string]> = [
  [/\b(ifd\*|ifood|rappi|uber\s*eats|zedelivery)/i,                     CAT_LEISURE],
  [/\b(restaurante|pizzaria|hamburgu|burger|lanche|lanchonete)/i,         CAT_LEISURE],
  [/\b(padaria|paes\s+e\s+doces|confeitaria|cafeteria|starbucks)/i,     CAT_LEISURE],
  [/\b(bar|choperia|adega|cervejaria|pub)\b/i,                           CAT_LEISURE],
  [/\b(cinema|cinemark|teatro|ingresso|bilheteria)/i,         CAT_LEISURE],
  [/\b(posto|combustivel|combustiveis|abastec|ipiranga|shell|petrobras)/i, CAT_FIXED],
  [/\b(supermerc|mercad|atacad|hipermerc|carrefour|assai|sendas|shibata)/i, CAT_FIXED],
  [/\b(uber|99app|99\s*taxi|cabify|taxi)\b/i,                           CAT_FIXED],
  // Assinatura mensal e CONTA FIXA no metodo — "Netflix" esta na lista padrao
  // do onboarding. Eu as tinha posto em Lazer por engano em 2026-09-09.
  [/\b(netflix|spotify|youtube|prime\s*video|disney|hbo|max\s*stream|globoplay|paramount|deezer|apple\s*(music|tv|one)|icloud|google\s*(one|drive|storage)|dropbox|onedrive|canva|adobe|chatgpt|openai|microsoft\s*365|office\s*365|assinatura)/i, CAT_FIXED],
  [/\b(academia|smartfit|smart\s*fit|crossfit|pilates)/i,                CAT_FIXED],
  [/\b(farmacia|drogaria|drogasil|droga\s*raia|pacheco)/i,               CAT_VARIABLE],
  [/\b(oficina|autopecas|mecanica|borracharia|funilaria)/i,               CAT_VARIABLE],
];

/**
 * Marketplaces: mesmo nome, compra sempre diferente.
 *
 * A memória por estabelecimento existe porque "Diego Lanches" é sempre lanche —
 * decidiu uma vez, vale para sempre. Marketplace quebra essa premissa: toda
 * compra na Amazon chega como "Amazon Servicos de Varejo do Brasil LTDA",
 * seja uma calça, um cabo ou um livro. Herdar a decisão anterior faria a calça
 * jeans virar nome de tudo que vier depois (Eduardo, 2026-09-09).
 *
 * Aqui a categoria continua sendo sugerida — o que NÃO acontece é gravar e
 * reaplicar a escolha do cliente. Cada compra é perguntada de novo, que é o
 * único jeito honesto quando o nome não diz o que foi comprado.
 */
const MARKETPLACE_RE = /\b(amazon|amzn|mercado\s*(livre|pago)|mercadoliv|mercadopago|shopee|shein|aliexpress|ali\s*express|magalu|magazine\s*luiza|americanas|submarino|casas\s*bahia|kabum|netshoes|temu|ebay|olx|enjoei|mp\s\*)/i;
function ehMarketplace(nome: string | null | undefined): boolean {
  return !!nome && MARKETPLACE_RE.test(nome);
}

function categoryFromMerchant(nome: string | null | undefined): string | null {
  if (!nome) return null;
  // Marketplace nunca passa pelas regras de nome: "MERCADO*MERCADOLIVRE" casaria
  // com o radical de supermercado e viraria conta fixa, quando e compra avulsa.
  // Sem palpite por nome, decide o codigo do banco (ou fica em variavel).
  if (ehMarketplace(nome)) return null;

  for (const [re, cat] of MERCHANT_PATTERNS) if (re.test(nome)) return cat;
  return null;
}

function suggestCategory(p: {
  accountType: OFAccountType; rawDirection: 'credit' | 'debit'; code: string; ofCategory: string | null;
  merchantName?: string | null;
}): { category: string | null; direction: OFDirection; confidence: 'high' | 'medium' | 'low' } {
  const { accountType, rawDirection, code, ofCategory } = p;
  const upperCode = (code ?? '').toUpperCase();
  if (IGNORE_CODES.has(upperCode)) return { category: null, direction: 'ignore', confidence: 'high' };

  const label = ofCategory ? normalizeLabel(ofCategory) : '';

  if (accountType === 'checking') {
    if (label) {
      const dir = LABEL_DIRECTION_MAP[label];
      if (dir === 'income') return { category: CAT_INCOME, direction: 'income', confidence: 'high' };
      if (dir === 'savings') return { category: null, direction: 'savings', confidence: 'high' };
      if (dir === 'ignore') return { category: null, direction: 'ignore', confidence: 'high' };
    }
    if (rawDirection === 'credit') return { category: CAT_INCOME, direction: 'income', confidence: 'low' };
    // PIX/TED para terceiros: sem sugestão, o cliente decide.
    if (ASK_USER_CODES.has(upperCode)) return { category: null, direction: 'expense', confidence: 'low' };
    if (label) {
      const cat = LABEL_CATEGORY_MAP[label];
      if (cat) return { category: cat, direction: 'expense', confidence: 'high' };
    }
    // Faltava: o código do Open Finance vale para conta corrente também. Sem
    // isto, luz, água, escola e seguro caíam todos em "Contas Variáveis".
    const codeCat = CC_CODE_MAP[upperCode];
    if (codeCat) return { category: codeCat, direction: 'expense', confidence: 'medium' };
    const porNome = categoryFromMerchant(p.merchantName);
    if (porNome) return { category: porNome, direction: 'expense', confidence: 'medium' };
    return { category: CAT_VARIABLE, direction: 'expense', confidence: 'low' };
  }

  if (rawDirection === 'credit') return { category: null, direction: 'ignore', confidence: 'high' };

  const ccCat = CC_CODE_MAP[code?.toUpperCase() ?? ''];
  if (ccCat) return { category: ccCat, direction: 'expense', confidence: 'medium' };
  if (label) {
    const c = LABEL_CATEGORY_MAP[label];
    if (c) return { category: c, direction: 'expense', confidence: 'medium' };
  }
  const porNome = categoryFromMerchant(p.merchantName);
  if (porNome) return { category: porNome, direction: 'expense', confidence: 'medium' };
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
  /** Contraparte real. Não está na documentação, mas vem no extrato de verdade. */
  participantPayer?: OFParticipant | null;
  participantReceiver?: OFParticipant | null;
  /** Estabelecimento do cartão — nome completo, CNPJ e categoria própria. */
  creditCardMerchant?: { name?: string | null; category?: string | null } | null;
  creditCardInstallmentNumber?: string | number | null;
  creditCardTotalInstallments?: string | number | null;
}

interface OFParticipant {
  name?: string | null;
  documentNumber?: { type?: string | null; value?: string | null } | null;
}

interface RawBlock { credit?: RawTx[]; debit?: RawTx[] }

/** Só dígitos: a API devolve "368.062.738-66" e comparamos com CPF cru. */
function onlyDigits(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '');
}

/** CPF/CNPJ de quem recebeu (saída) ou pagou (entrada). */
function extractCounterpartyDoc(raw: RawTx): string | null {
  const party = raw.transactionType === 'debit' ? raw.participantReceiver : raw.participantPayer;
  const doc = onlyDigits(party?.documentNumber?.value);
  return doc.length >= 11 ? doc : null;
}

/**
 * Chave da memória por estabelecimento.
 * PRECISA ser idêntica a `merchantKey()` de lib/openfinance/categoryMap.ts — é
 * a tela que grava e o cron que lê; grafias diferentes nunca se encontram.
 */
function memoryKey(source: string | null): string {
  return (source ?? '')
    .replace(/\s+\d{2}\/\d{2}$/, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

/** Deixa "EDP SAO PAULO ... S.A." legível. Espelha lib/openfinance/parser.ts. */
function tidyMerchant(s: string): string {
  const clean = s.trim().replace(/\s+/g, ' ');
  if (clean !== clean.toUpperCase()) return clean;
  const minor = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return clean.toLowerCase().split(' ').map((w, i) => {
    if (i > 0 && minor.has(w)) return w;
    if (/^(s\.?a\.?|ltda\.?|me|epp|eireli)$/i.test(w)) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

/**
 * Nome que o cliente reconhece. O campo `name` NÃO serve: no extrato real ele é
 * o titular da conta em 110 de 110 transações.
 */
function extractMerchant(raw: RawTx): string | null {
  // Cartão não tem `participant*` — tem `creditCardMerchant`, com o nome
  // completo do estabelecimento. Sem esta linha, gasto de cartão mostrava a
  // descrição crua do banco.
  const ccName = raw.creditCardMerchant?.name?.trim();
  if (ccName) return tidyMerchant(fixMojibake(ccName));

  const party = raw.transactionType === 'debit' ? raw.participantReceiver : raw.participantPayer;
  const partyName = party?.name?.trim();
  if (partyName) return tidyMerchant(fixMojibake(partyName));
  const m = (raw.description ?? '').match(/-\s*DES:?\s+(.+?)\s*\d*$/i);
  if (m?.[1] && m[1].trim().length > 2) return tidyMerchant(fixMojibake(m[1]));
  return null;
}

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

/**
 * Parcelamento do cartão pelos campos próprios da API.
 *
 * A detecção por regex na descrição procura "01/10" no fim do texto — formato
 * que o Bradesco não usa. Por isso uma compra 1/10 da Amazon entrava como
 * compra única e não comprometia os meses seguintes.
 */
function installmentFromCard(raw: RawTx): { current: number; total: number } | null {
  const total = parseInt(String(raw.creditCardTotalInstallments ?? ''), 10);
  const current = parseInt(String(raw.creditCardInstallmentNumber ?? ''), 10);
  if (!Number.isFinite(total) || total <= 1) return null;
  if (Number.isFinite(current) && current > 0) return { current, total };

  /**
   * Sem o número da parcela, a versão antiga assumia a PRIMEIRA — e projetava
   * todas as seguintes. Uma compra 4/4, que está acabando, virava 4 parcelas
   * futuras inventadas no plano, e o cliente tinha de caçar e apagar uma por
   * uma (Eduardo, 2026-09-09: "Tapete 04/04" projetado até dezembro).
   *
   * A informação costuma estar na descrição — "MP *CAZATI 04/04" —, então ela
   * vem antes de qualquer suposição.
   */
  const daDescricao = detectInstallment(fixMojibake(raw.description ?? ''));
  if (daDescricao && daDescricao.total === total) return daDescricao;

  /**
   * Ainda sem saber: trata como a ÚLTIMA, que é o mesmo que não projetar nada.
   *
   * Errar para menos é recuperável — a próxima parcela chega na fatura do mês
   * que vem e entra sozinha. Errar para mais enche o plano de dívida que não
   * existe, e quem limpa é o cliente.
   */
  return { current: total, total };
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
    const s = suggestCategory({ accountType, rawDirection: raw.transactionType, code: raw.code, ofCategory, merchantName: extractMerchant(raw) ?? desc });
    return {
      transactionId: raw.transactionId,
      fitid: raw.fitid ?? null,
      accountType,
      direction,
      amount: Math.abs(parseFloat(raw.amount) || 0),
      date: raw.date,
      description: desc,
      merchant: extractMerchant(raw),
      counterpartyDoc: extractCounterpartyDoc(raw),
      ofCode: raw.code ?? null,
      ofCategory,
      paymentMethod: raw.paymentMethod ?? null,
      cardLast4: raw.creditCardNumber ?? null,
      billDueDate: raw.creditCardBill?.dueDate ?? null,
      billTotal: raw.creditCardBill?.totalAmount ?? null,
      suggestedCategory: s.direction === 'ignore' ? null : s.category,
      suggestionConfidence: s.confidence,
      // Campo próprio do cartão primeiro; a regex da descrição fica de reserva
      // para conta corrente, onde o banco escreve "PARC 02/06" no texto.
      installment: installmentFromCard(raw) ?? detectInstallment(desc),
    };
  }

  for (const tx of debits) {
    const s = suggestCategory({ accountType, rawDirection: 'debit', code: tx.code, ofCategory: tx.category, merchantName: tx.description ?? null });
    if (s.direction === 'ignore') continue;
    out.push(normalize(tx, s.direction));
  }
  for (const tx of credits) {
    if (tx.code === 'CREDITCARDPAYMENT' || tx.code === 'TEV') continue;
    if (accountType === 'credit_card') continue; // estornos — fora do MVP
    const s = suggestCategory({ accountType, rawDirection: 'credit', code: tx.code, ofCategory: tx.category, merchantName: tx.description ?? null });
    if (s.direction === 'ignore') continue;
    out.push(normalize(tx, s.direction));
  }
  return out;
}

// ─── Datas ───────────────────────────────────────────────────────────────────

const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Primeiro dia do plano — o corte de tudo que entra na fila de categorizar.
 *
 * Vem de `households.start_month/start_year`, NUNCA do calendário. O plano do
 * cliente começa num mês escolhido (o wizard grava, e o botão "Reprojetar
 * Ciclo" reescreve por `api/update-start-month.ts`), e é esse mês que define o
 * que faz sentido categorizar: quem monta o plano em setembro não planeja
 * agosto, e quem reprojeta para dezembro recomeça de dezembro.
 *
 * Sem household ou sem as colunas preenchidas, cai no mês corrente — que era o
 * comportamento antigo e continua sendo um padrão seguro.
 */
function cutoffDoPlano(startMonth: number | null, startYear: number | null): string {
  const n = new Date();
  const mes = startMonth ?? n.getMonth();
  const ano = startYear ?? n.getFullYear();
  return `${ano}-${String(mes + 1).padStart(2, '0')}-01`;
}

/**
 * Janela de datas do extrato.
 *
 * `wide` (cartao): sempre 12 meses para tras. Uma compra 3/10 feita em maio
 * precisa ser VISTA para projetar as 7 faturas seguintes — pedindo so os
 * ultimos dias, a projecao dos meses futuros nasce vazia. Foi o que aconteceu
 * em 2026-08-12: o cartao voltou com 3 transacoes em vez de 117.
 *
 * Estreita (conta corrente): desde a ultima sincronizacao, porque o que passou
 * ja foi importado e nao muda mais.
 */
function syncRange(lastSyncedAt: string | null, wide = false) {
  const today = toDateStr(new Date());

  if (wide) {
    const s = new Date();
    s.setMonth(s.getMonth() - 12);
    return { dateStart: toDateStr(s), dateEnd: today };
  }

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
  bank_name?: string | null;
  account_hash: string;
  payer_cpf: string;
  account_type: string;
  card_last4: string | null;
  last_synced_at: string | null;
  last_protocol_id: string | null;
  last_protocol_at: string | null;
  card_import_enabled?: boolean | null;
  card_protocol_id?: string | null;
  card_protocol_at?: string | null;
  account_import_enabled?: boolean | null;
  cards?: StoredCard[] | null;
  /** Fatura por cartão: {"7212": {"2026-09": 7863.04}}. Formato antigo era plano. */
  bill_totals?: Record<string, unknown> | null;
}

/** Cartão guardado em  (ver migrations-v9.sql). */
interface StoredCard {
  last4: string;
  enabled: boolean;
  protocolId: string | null;
  protocolAt: string | null;
}

async function syncOne(
  conn: Conn,
  allowGenerate: boolean,
  reimport = false,
  /** 'CREDIT_CARD' pede a FATURA da mesma conta — segunda passada, quando o
   *  cliente ligou a importação do cartão. */
  forceType?: 'BANK' | 'CREDIT_CARD',
  /** Cartão desta passada. Cada um tem protocolo e janela de 6h próprios. */
  card?: StoredCard,
): Promise<{ status: string; upserted?: number; reason?: string }> {
  const statementType = forceType ?? (conn.account_type === 'credit_card' ? 'CREDIT_CARD' : 'BANK');

  // Conta e fatura têm protocolos e janelas próprias — misturar as duas numa
  // coluna só faria cada passada invalidar a outra.
  const isCard = statementType === 'CREDIT_CARD';
  const prevId = isCard ? (card?.protocolId ?? conn.card_protocol_id) : conn.last_protocol_id;
  const prevAt = isCard ? (card?.protocolAt ?? conn.card_protocol_at) : conn.last_protocol_at;

  const age = prevAt ? Date.now() - new Date(prevAt).getTime() : Infinity;
  const reaproveitar = !!prevId && age < PROTOCOL_WINDOW_MS;

  let protocolId: string;
  if (reaproveitar) {
    protocolId = prevId!;
  } else if (!allowGenerate) {
    // Rodada de monitoramento: só acompanha protocolo que já existe. Gerar é
    // caro (4 por dia por conta) e fica reservado para a rodada da manhã, para
    // sobrar orçamento ao "sincronizar agora" disparado pelo cliente.
    return { status: 'skipped', reason: 'sem protocolo na janela; rodada de monitoramento' };
  } else {
    /**
     * Protocolo velho que FUNCIONOU vale mais que nenhum.
     *
     * A Technospeed limita geração (1 por 6h por conta, 4 por dia). Quando o
     * limite bate, a geração estoura e a sincronização inteira morria — mesmo
     * havendo um protocolo anterior com status SUCCESS, pronto para ler.
     *
     * Foi o que travou o Eduardo em 2026-09-10: os protocolos dos cartões 7212
     * e 6256 estavam SUCCESS com 907 e 33 lançamentos, mas tinham 5 horas a
     * mais que a janela de reaproveitamento. O cron recusava o que servia,
     * tentava gerar, tomava erro, e importava zero — todo dia, sem sair do
     * lugar.
     *
     * Dado de ontem é pior que o de hoje e MUITO melhor que nenhum. A janela de
     * 6h continua valendo para o caminho feliz; isto é só a rede de segurança.
     */
    let gerado: string | null = null;
    try {
      const { dateStart, dateEnd } = syncRange(conn.last_synced_at, isCard);
      const r = await tsReq<Record<string, unknown>>('POST', '/api/v1/statement/openfinance', conn.payer_cpf, {
        accountHash: conn.account_hash,
        dateStart,
        dateEnd,
        statementType,
        ...(isCard ? { cardNumber: card?.last4 ?? conn.card_last4 } : {}),
      });
      const id = r?.uniqueId ?? r?.uniqueid;
      if (typeof id === 'string' && id) gerado = id;
    } catch (e) {
      if (!prevId) throw e; // sem rede de segurança: o erro é o resultado
    }

    if (!gerado) {
      if (!prevId) return { status: 'error', reason: 'sem uniqueId no protocolo' };
      // Cai no anterior sem gravar nada: a janela de 6h fica como está, para a
      // próxima rodada tentar gerar de novo.
      protocolId = prevId;
    } else {
      protocolId = gerado;
      if (isCard && card) {
        // Grava o protocolo DENTRO do cartão — com uma coluna só, o segundo
        // cartão apagaria a janela do primeiro.
        const nextCards = (conn.cards ?? []).map((c) => (c.last4 === card.last4
          ? { ...c, protocolId, protocolAt: new Date().toISOString() }
          : c));
        conn.cards = nextCards;
        await db.from('bank_connections').update({ cards: nextCards }).eq('id', conn.id);
      } else {
        await db.from('bank_connections')
          .update(isCard
            ? { card_protocol_id: protocolId, card_protocol_at: new Date().toISOString() }
            : { last_protocol_id: protocolId, last_protocol_at: new Date().toISOString() })
          .eq('id', conn.id);
      }
    }
  }

  const env = await tsReq<Envelope>('GET', `/api/v1/statement/openfinance/${protocolId}`, conn.payer_cpf);
  const status = (env.statement?.status ?? '').toUpperCase();

  if (status === 'ERROR' || status === 'FAILED') {
    // Protocolo morto nao pode ficar guardado: dentro da janela de 6h ele seria
    // REAPROVEITADO e a leitura falharia de novo, todo dia, sem nunca gerar um
    // novo. Limpar aqui faz a proxima rodada pedir outro.
    if (isCard && card) {
      const limpos = (conn.cards ?? []).map((c) => (c.last4 === card.last4
        ? { ...c, protocolId: null, protocolAt: null } : c));
      conn.cards = limpos;
      await db.from('bank_connections').update({ cards: limpos }).eq('id', conn.id);
    } else {
      await db.from('bank_connections')
        .update({ last_protocol_id: null, last_protocol_at: null })
        .eq('id', conn.id);
    }

    // "Nenhuma transacao no periodo" NAO e defeito: e mes sem movimento, ou
    // janela curta demais. Tratar como erro enchia o relatorio de alarme falso.
    const motivo = String((env as unknown as { reason?: string }).reason ?? '');
    if (/nenhuma transa/i.test(motivo)) {
      await db.from('bank_connections')
        .update({ last_synced_at: new Date().toISOString(), needs_resync: false })
        .eq('id', conn.id);
      return { status: 'done', upserted: 0, reason: 'sem movimento no periodo' };
    }

    return { status: 'error', reason: motivo || 'processamento falhou' };
  }
  if (status === 'PROCESSING' || status === 'PENDING') return { status: 'processing' };

  // Mês em que o plano deste cliente começa — é ele que corta a fila abaixo.
  const { data: casa } = await db
    .from('households')
    .select('start_month, start_year')
    .eq('id', conn.household_id)
    .maybeSingle();
  const cutoff = cutoffDoPlano(casa?.start_month ?? null, casa?.start_year ?? null);
  const todasAsTx = parseStatement(env);

  // A fatura por mes usa o extrato INTEIRO, antes do corte do mes corrente:
  // uma parcela comprada em marco ainda pesa em outubro, e cortar por data
  // esvaziaria justamente a projecao dos meses futuros.
  /**
   * Fatura gravada POR CARTAO, nao por conexao.
   *
   * `bill_totals` e um campo so, mas `cards` e uma lista e a sincronizacao roda
   * uma vez por cartao. Gravando o resultado direto, cada cartao APAGAVA o do
   * anterior — sobrava a fatura do ultimo que sincronizou.
   *
   * Foi o que aconteceu com o Eduardo em 2026-09-09: a conexao Itau tem os
   * cartoes 7212 e 6256; o 6256 sincronizou 22 segundos depois do 7212 e seus
   * dois valores velhos ({2025-10: 34,16, 2026-02: 43,29}) apagaram a fatura
   * inteira do Latam. O plano ficou com numeros congelados de uma passada
   * anterior, e setembro mostrava R$ 1.435 no lugar de R$ 7.863.
   *
   * Agora a forma e {"7212": {"2026-09": 7863.04, ...}, "6256": {...}} e cada
   * cartao mexe so na sua chave. Formato antigo (plano, mes -> valor) e migrado
   * na primeira gravacao: as chaves AAAA-MM soltas sao descartadas.
   */
  if (isCard && card) {
    const totals = computeBillTotals(todasAsTx);
    const anterior = (conn.bill_totals && typeof conn.bill_totals === 'object' && !Array.isArray(conn.bill_totals))
      ? conn.bill_totals as Record<string, unknown>
      : {};
    const porCartao: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(anterior)) {
      // Descarta o formato antigo (chave de mes na raiz); mantem outros cartoes.
      if (/^\d{4}-\d{2}$/.test(k)) continue;
      porCartao[k] = v;
    }
    porCartao[card.last4] = totals;

    /**
     * A cópia em memória tem de acompanhar, senão o cartão seguinte apaga este.
     *
     * `conn` é o MESMO objeto para os dois cartões da conexão — foi carregado
     * uma vez no início da rodada. Sem esta linha, o 6256 montava o novo mapa a
     * partir do `bill_totals` velho (o de antes do 7212 gravar) e regravava sem
     * a chave do 7212. Era a sobrescrita de novo, um nível abaixo da que já
     * arrumamos no banco: o formato por cartão estava certo, e mesmo assim só o
     * último cartão sobrevivia (Eduardo, 2026-09-10).
     */
    conn.bill_totals = porCartao;

    const nextCards = (conn.cards ?? []).map((c) => (c.last4 === card.last4 ? { ...c } : c));
    conn.cards = nextCards;
    await db.from('bank_connections')
      .update({ bill_totals: porCartao })
      .eq('id', conn.id)
      .then(() => {}, () => {}); // fatura e acessoria: falha aqui nao derruba a importacao
  }

  /**
   * Corte do que vai para a fila de categorizar: DATA DA COMPRA >= início do plano.
   *
   * Vale para cartão e conta corrente igualmente, e o critério é sempre quando o
   * cliente GASTOU — não quando a fatura vence.
   *
   * POR QUE NÃO É PELO VENCIMENTO (era, até 2026-09-10): quem monta o plano em
   * setembro não planeja agosto. Cortando por vencimento, toda compra de agosto
   * cuja fatura vence em 01/09 entrava na fila — o cliente conectava o banco e
   * recebia o mês passado inteiro para categorizar, um mês que o plano dele nem
   * cobre. Foi o que o Eduardo viu em 2026-09-10: 48 itens de agosto na fila de
   * um plano que começa em setembro.
   *
   * O QUE NÃO MUDA: `computeBillTotals` acima roda sobre `todasAsTx`, sem este
   * corte. A fatura de setembro continua sendo o valor CHEIO, com as compras de
   * agosto dentro dela e as parcelas futuras projetadas — que foi o conserto de
   * 2026-09-09 (commit 25e2e75) e continua de pé. As duas coisas são
   * independentes: a fatura é um total que o cliente já deve, a fila é o que ele
   * ainda vai decidir. Confundir as duas foi o erro.
   *
   * Na prática, no primeiro mês do plano o cartão entra como uma linha só (a
   * fatura), e a fila recebe só as compras feitas dali para frente — que vencem
   * na fatura do mês seguinte. É assim que a consultoria começa.
   */
  let txs = todasAsTx.filter((t) => t.date >= cutoff);

  if (txs.length === 0) {
    await db.from('bank_connections')
      .update({ last_synced_at: new Date().toISOString(), needs_resync: false })
      .eq('id', conn.id);
    return { status: 'done', upserted: 0 };
  }

  // ── Transferência entre o casal não é gasto nem renda ──────────────────────
  // Pix de um cônjuge para o outro aparece como despesa no extrato de quem
  // enviou e como renda no de quem recebeu. Como os dois extratos caem no mesmo
  // household, o casal ganharia renda que não existe e gastaria dinheiro que
  // não saiu de casa. O banco não marca como transferência própria porque os
  // CPFs são diferentes — quem sabe que são a mesma família somos nós.
  const { data: donos } = await db
    .from('bank_connections')
    .select('payer_cpf')
    .eq('household_id', conn.household_id);
  const cpfsDaCasa = new Set(
    (donos ?? []).map((d) => (d.payer_cpf ?? '').replace(/\D/g, '')).filter((c) => c.length >= 11),
  );

  const txsAntes = txs.length;
  if (cpfsDaCasa.size > 1) {
    txs = txs.filter((t) => !(t.counterpartyDoc && cpfsDaCasa.has(t.counterpartyDoc)));
  }
  const removidasDoCasal = txsAntes - txs.length;

  // Sobrou só transferência interna: nada a importar, mas a sincronização foi
  // bem-sucedida. Sem esta saída o fluxo seguiria com uma lista vazia.
  if (txs.length === 0) {
    await db.from('bank_connections')
      .update({ last_synced_at: new Date().toISOString(), needs_resync: false })
      .eq('id', conn.id);
    return { status: 'done', upserted: 0, reason: removidasDoCasal > 0 ? 'só transferências entre o casal' : undefined };
  }

  // ── Reimportação sob demanda ───────────────────────────────────────────────
  // O upsert usa `ignoreDuplicates: true`, então transação já gravada nunca é
  // atualizada — é o que protege a categorização do cliente. O efeito colateral
  // é que uma correção de parser (nome do estabelecimento, regra de categoria)
  // não alcança o que já entrou. Apagar só as `pending` resolve sem perder
  // nada: pendente é o que o cliente ainda não tocou. Categorizada e ignorada
  // ficam intactas.
  if (reimport) {
    await db.from('bank_transactions')
      .delete()
      .eq('connection_id', conn.id)
      .eq('status', 'pending');
  }

  // ── Memória por estabelecimento ────────────────────────────────────────────
  // O que o cliente já categorizou uma vez decide sozinho na próxima. Até aqui
  // `merchant_memories` era gravada e NUNCA lida: ele reclassificava o mesmo
  // mercado todo mês. A memória vence o palpite genérico — é escolha dele,
  // não heurística nossa.
  const keys = [...new Set(txs.map((t) => memoryKey(t.merchant ?? t.description)).filter(Boolean))];
  const memory = new Map<string, { category: string; itemId: string | null }>();
  if (keys.length > 0) {
    const { data: mems } = await db
      .from('merchant_memories')
      .select('merchant_key, kashim_category, kashim_item_id')
      .eq('household_id', conn.household_id)
      .in('merchant_key', keys);
    for (const m of mems ?? []) {
      memory.set(m.merchant_key, { category: m.kashim_category, itemId: m.kashim_item_id ?? null });
    }
  }

  const rows = txs.map((t) => {
    // Marketplace nunca herda a decisao anterior: mesmo nome, compra diferente.
    const remembered = ehMarketplace(t.merchant ?? t.description)
      ? undefined
      : memory.get(memoryKey(t.merchant ?? t.description));
    return {
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
      merchant: t.merchant,
      counterparty_doc: t.counterpartyDoc,
      payment_method: t.paymentMethod,
      card_last4: t.cardLast4,
      bill_due_date: t.billDueDate,
      bill_total: t.billTotal,
      suggested_category: remembered?.category ?? t.suggestedCategory,
      // 'memory' distingue "o cliente já decidiu isto antes" de "nós achamos
      // que é isto". Só a primeira é lançada sozinha pelo app.
      suggestion_confidence: remembered ? 'memory' : t.suggestionConfidence,
      suggested_item_id: remembered?.itemId ?? null,
      installment_current: t.installment?.current ?? null,
      installment_total: t.installment?.total ?? null,
      status: 'pending',
    };
  });

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

/**
 * Fatura por mes, com as parcelas futuras projetadas.
 *
 * Chave AAAA-MM do VENCIMENTO da fatura. Duas fontes:
 *   - o que ja esta faturado, agrupado por `creditCardBill.dueDate`
 *   - o que ainda vai vencer: compra 3/10 soma o mesmo valor nas 7 faturas
 *     seguintes. E isso que preenche os meses futuros do plano — o extrato nao
 *     entrega fatura futura, mas entrega o compromisso que a forma.
 */
function computeBillTotals(txs: Array<{
  transactionId?: string | null;
  description?: string | null;
  amount: number;
  date: string;
  direction: string;
  billDueDate: string | null;
  billTotal?: number | null;
  installment: { current: number; total: number } | null;
}>): Record<string, number> {
  const totals: Record<string, number> = {};

  const addTo = (ym: string, valor: number) => {
    totals[ym] = Math.round(((totals[ym] ?? 0) + valor) * 100) / 100;
  };

  const shiftMonth = (ym: string, meses: number): string => {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + meses, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };

  const MES_VALIDO = /^[0-9]{4}-[0-9]{2}$/;

  const relevantes = txs.filter((t) => t.direction !== 'income' && t.direction !== 'ignore');

  // Ultima fatura com dado REAL. Tudo ate aqui e fato; dai para frente, projecao.
  const mesesComFatura = relevantes
    .map((t) => (t.billDueDate ?? '').slice(0, 7))
    .filter((m) => MES_VALIDO.test(m))
    .sort();
  const ultimaReal = mesesComFatura[mesesComFatura.length - 1] ?? '';

  // Compra sem fatura carimbada pertence a PROXIMA fatura, nao ao mes da compra:
  // ela aconteceu depois do fechamento. Jogar no mes corrente inflava agosto em
  // R$ 23.640 (medido contra o app do Bradesco em 2026-08-13).
  const proximaFatura = ultimaReal ? shiftMonth(ultimaReal, 1) : '';

  /**
   * 0) O TOTAL QUE O BANCO DECLARA, por mes de vencimento.
   *
   * O extrato de cartao carimba `creditCardBill.totalAmount` em cada lancamento:
   * e a fatura fechada, do jeito que o cliente ve no app do banco. Preferimos
   * ela a qualquer soma nossa.
   *
   * POR QUE SOMAR NAO BASTA (medido em 2026-09-10, cartao Latam Itau ••7212):
   * a soma dos 75 lancamentos de setembro dava R$ 7.758,04 e a fatura era
   * R$ 7.863,04. Os R$ 105,00 de diferenca sao a linha "Produtos e servicos"
   * do Itau, que a Technospeed nao entrega como lancamento nenhum — nao ha
   * transacao de R$ 105 no extrato inteiro. Somando, ela nunca apareceria.
   *
   * Isso tambem tira do caminho a ambiguidade do CREDITCARDFEES, que fica
   * ignorado (e deve ficar: no Bradesco ele e o pagamento da fatura, R$ 58 mil
   * de dupla contagem) sem com isso furar o total.
   */
  const declarado = new Map<string, number>();
  for (const t of txs) {
    const due = (t.billDueDate ?? '').slice(0, 7);
    if (!MES_VALIDO.test(due)) continue;
    const v = Number(t.billTotal);
    if (Number.isFinite(v) && v > 0) declarado.set(due, v);
  }

  // 1) Mes SEM total declarado: soma os lancamentos, como antes.
  const vistos = new Set<string>();
  for (const t of relevantes) {
    // `transaction` e `transactionDuplicated` podem trazer a mesma transacao.
    const id = t.transactionId ?? `${t.date}|${t.amount}|${t.description ?? ''}`;
    if (vistos.has(id)) continue;
    vistos.add(id);

    const due = (t.billDueDate ?? '').slice(0, 7);
    const base = MES_VALIDO.test(due) ? due : proximaFatura;
    if (!MES_VALIDO.test(base)) continue;
    if (declarado.has(base)) continue; // o banco ja disse quanto e
    addTo(base, t.amount);
  }

  // O declarado vence qualquer soma.
  for (const [mes, valor] of declarado) totals[mes] = valor;

  // 2) O que ainda vai vencer.
  //
  //    Uma compra 10x aparece como 10 transacoes. Projetar de todas multiplicava
  //    o valor, entao projetamos de UMA por compra — a parcela mais recente.
  //
  //    A chave usa o valor ARREDONDADO porque o banco distribui os centavos de
  //    forma desigual: a mesma compra vem como R$ 424,27 na 1a parcela e
  //    R$ 424,24 nas seguintes. Com o valor exato, as duas viravam "compras"
  //    diferentes e ambas projetavam — R$ 1.841/mes a mais.
  const ultimaParcelaPorCompra = new Map<string, { base: string; amount: number; current: number; total: number }>();

  for (const t of relevantes) {
    if (!t.installment || t.installment.total <= 1) continue;
    const due = (t.billDueDate ?? '').slice(0, 7);
    const base = MES_VALIDO.test(due) ? due : proximaFatura;
    if (!MES_VALIDO.test(base)) continue;

    /**
     * A parcela NAO pode entrar na identidade da compra.
     *
     * O banco escreve o numero da parcela dentro da descricao, colado no nome:
     * "MERCADO*MERCADOLIV08/10" e "MERCADO*MERCADOLIV09/10" sao a MESMA compra
     * em dois meses. Com a descricao crua na chave elas viravam duas compras e
     * as duas projetavam o resto das parcelas — cada parcelamento contado duas
     * vezes. Media em 2026-09-10: outubro saia R$ 4.920 contra R$ 4.092 do app
     * do Itau, e novembro R$ 785 contra R$ 497.
     *
     * O sufixo vem sem espaco em alguns casos ("...LIV08/10") e com espacos em
     * outros ("MP *CAZATI        03/04"), por isso o \s* dos dois lados.
     */
    const semParcela = (t.description ?? '').replace(/\s*\d{1,2}\s*\/\s*\d{1,2}\s*$/, '').trim();
    const compra = `${semParcela}|${t.installment.total}|${Math.round(t.amount)}`;
    const atual = ultimaParcelaPorCompra.get(compra);
    if (!atual || t.installment.current > atual.current) {
      ultimaParcelaPorCompra.set(compra, {
        base,
        amount: t.amount,
        current: t.installment.current,
        total: t.installment.total,
      });
    }
  }

  for (const { base, amount, current, total } of ultimaParcelaPorCompra.values()) {
    for (let k = 1; k <= total - current; k++) {
      const alvo = shiftMonth(base, k);
      // Mes que ja tem cobranca real nao recebe projecao — seria contar duas
      // vezes a mesma parcela.
      if (ultimaReal && alvo <= ultimaReal) continue;
      // Mes com total declarado pelo banco e fato fechado: projecao nao encosta.
      if (declarado.has(alvo)) continue;
      addTo(alvo, amount);
    }
  }

  /**
   * 3) O encargo que o banco cobra e NAO entrega como lancamento.
   *
   * O Itau mostra a fatura em duas linhas: "Compras" e "Produtos e servicos".
   * A segunda — seguro, anuidade, servico — nao vem como transacao nenhuma no
   * Open Finance: nao existe lancamento com esse valor no extrato inteiro.
   * Na fatura FECHADA isso nao machuca, porque usamos o total declarado. Nos
   * meses projetados, machuca todo mes.
   *
   * Medimos o encargo na ultima fatura fechada (declarado - soma dos
   * lancamentos dela) e o repetimos nos meses seguintes, porque é cobranca
   * recorrente por natureza.
   *
   * Conferido contra o app do Itau em 2026-09-10 (Latam ••7212): o encargo deu
   * R$ 105,00, e com ele novembro fecha em R$ 497,80, dezembro e janeiro em
   * R$ 105,00 — os tres exatos. Sem ele davam R$ 392,80, zero e zero.
   *
   * O teto de 10% existe para nao propagar um gasto que simplesmente faltou
   * importar: diferenca grande é buraco de dado, nao tarifa, e ai é melhor
   * projetar de menos do que inventar cobranca.
   */
  /**
   * Só de fatura RECENTE.
   *
   * Cartão parado tem a última fatura fechada meses atrás, e daí não se conclui
   * nada sobre cobrança mensal — a tarifa pode ter acabado junto com o uso.
   * Aconteceu no cartão ••6256 do Eduardo em 2026-09-10: última fatura de
   * fevereiro, e o encargo de lá era projetado para o ano inteiro.
   */
  const mesCorrente = (() => {
    const n = new Date();
    return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}`;
  })();
  const doisMesesAtras = shiftMonth(mesCorrente, -2);

  if (MES_VALIDO.test(ultimaReal) && declarado.has(ultimaReal) && ultimaReal >= doisMesesAtras) {
    const totalDeclarado = declarado.get(ultimaReal)!;
    let somaDaUltima = 0;
    const vistosUltima = new Set<string>();
    for (const t of relevantes) {
      const id = t.transactionId ?? `${t.date}|${t.amount}|${t.description ?? ''}`;
      if (vistosUltima.has(id)) continue;
      vistosUltima.add(id);
      if ((t.billDueDate ?? '').slice(0, 7) !== ultimaReal) continue;
      somaDaUltima += t.amount;
    }

    const encargo = Math.round((totalDeclarado - somaDaUltima) * 100) / 100;
    if (encargo > 0 && encargo <= totalDeclarado * 0.1) {
      // Horizonte de 12 meses: e a janela que o plano mostra.
      for (let k = 1; k <= 12; k++) {
        const alvo = shiftMonth(ultimaReal, k);
        if (declarado.has(alvo)) continue;
        addTo(alvo, encargo);
      }
    }
  }

  return totals;
}

// ─── Autorizações pendentes ──────────────────────────────────────────────────

/**
 * Espelha `deriveConsentStatus` de api/of-status.ts (Vercel não empacota import
 * local). Ciclo: PENDENTE_ATIVACAO → PROCESSANDO → CONCLUIDO.
 */
function deriveConsentStatus(raw: string | null, openfinanceId: string | null): string {
  const s = (raw ?? '').toUpperCase();
  if (/REVOG|CANCEL/.test(s)) return 'revoked';
  if (/EXPIR|VENCID/.test(s)) return 'expired';
  if (/PENDENTE|AGUARD/.test(s)) return 'pending_authorization';
  if (/PROCESS/.test(s)) return 'authorized_fetching';
  if (/FALHA|FALHOU|ERRO|ERROR|FAIL/.test(s)) return 'failed';
  if (/ATIVO|CONCLU|SUCESSO|SUCCESS/.test(s)) return 'active';
  if (!openfinanceId) return 'pending_authorization';
  // Desconhecido nunca vira 'active' por dedução — ver of-status.ts.
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

/**
 * Reconsulta as conexões que ainda não foram autorizadas e avisa quando o banco
 * confirmar.
 *
 * Por que no cron: sem isto, uma conexão aguardando autorização só sai desse
 * estado se o cliente abrir a tela e clicar "Verificar status" — exatamente o
 * consultar-de-hora-em-hora que queremos eliminar. E o `syncOne` nunca a
 * alcança, porque a busca principal filtra por `consent_status = 'active'`.
 */
async function refreshPendingAuthorizations(deadline: number): Promise<number> {
  const { data: pending } = await db
    .from('bank_connections')
    .select('id, household_id, account_hash, payer_cpf, bank_name')
    .in('consent_status', ['pending_authorization', 'authorized_fetching'])
    .limit(MAX_STATUS_CHECKS);

  let promoted = 0;

  for (const c of pending ?? []) {
    if (Date.now() > deadline) break;
    if (!c.payer_cpf || !c.account_hash) continue;

    try {
      const payload = await tsReq<unknown>('GET', `/api/v1/account/${c.account_hash}`, c.payer_cpf);
      const account = pickAccount(payload);
      const rawStatus = str(account?.statusOpenfinance);
      const openfinanceId = str(account?.openfinanceId);
      const next = deriveConsentStatus(rawStatus, openfinanceId);

      await db
        .from('bank_connections')
        .update({ consent_status: next, openfinance_status: rawStatus, openfinance_id: openfinanceId })
        .eq('id', c.id);

      if (next === 'active') {
        promoted++;
        const target = await notifyTargetFor(c.household_id);
        if (target) {
          const hi = target.firstName ? `${target.firstName}, o` : 'O';
          await sendMail(
            target.email,
            `✅ ${c.bank_name} autorizado no Kashim`,
            emailShell(
              `${c.bank_name} está conectado`,
              `<p>${hi} seu banco confirmou a autorização.</p>
               <p>Agora ele tem até <strong>24 horas</strong> para liberar o histórico. Você não precisa
               fazer mais nada — assim que os lançamentos chegarem, a gente te avisa de novo.</p>`,
              'Abrir o Kashim',
            ),
          );
        }
      }
    } catch { /* tenta na próxima execução */ }

    await new Promise((r) => setTimeout(r, STATUS_GAP_MS));
  }

  return promoted;
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
    const deadline = Date.now() + 240_000; // margem dentro do maxDuration de 300s

    // Primeiro as autorizações pendentes: uma conexão recém-aprovada precisa
    // virar 'active' agora para já entrar na sincronização logo abaixo.
    const promoted = await refreshPendingAuthorizations(deadline);

    // needs_resync primeiro (webhook sinalizou transação nova), depois as mais antigas
    const { data: conns, error } = await db
      .from('bank_connections')
      .select('id, household_id, bank_name, account_hash, payer_cpf, account_type, card_last4, last_synced_at, last_protocol_id, last_protocol_at, needs_resync, card_import_enabled, card_protocol_id, card_protocol_at, account_import_enabled, cards, bill_totals')
      .eq('consent_status', 'active')
      .order('needs_resync', { ascending: false })
      .order('last_synced_at', { ascending: true, nullsFirst: true })
      .limit(40);

    if (error) throw error;
    if (!conns || conns.length === 0) {
      return res.status(200).json({ ok: true, connections: 0, promoted });
    }

    /**
     * GERAR é caro; LER é barato. Por isso as duas cadências são diferentes.
     *
     * Gerar protocolo consome a cota da Technospeed (4 por dia por conta), e
     * eles atualizam a Pluggy às 4h, 10h, 16h e 22h — então uma geração por dia,
     * na rodada das 10h, é o que faz sentido.
     *
     * LER, não: o protocolo fica pronto em minutos e a leitura só esbarra em
     * 3 por minuto, com cache de 1 hora do lado deles. Mesmo assim o cron rodava
     * de 6 em 6 horas, e o protocolo do Eduardo ficou SUCCESS às 7h da manhã
     * esperando até as 13h para alguém olhar — seis horas de atraso somadas ao
     * atraso que o banco já tem (2026-09-10).
     *
     * Agora o vercel.json chama de hora em hora. As outras 23 rodadas caem no
     * `allowGenerate = false` e só acompanham o protocolo aberto, o que casa
     * exatamente com o cache de 1h deles.
     */
    const GENERATE_HOUR_UTC = 10;
    const allowGenerate = new Date().getUTCHours() === GENERATE_HOUR_UTC
      || String(req.query.force ?? '') === 'generate';
    // Manutenção: reprocessa o protocolo em aberto descartando as pendentes.
    // Só por chamada explícita — o cron agendado nunca faz isto.
    const reimport = String(req.query.reimport ?? '') === '1';

    let done = 0, processing = 0, errors = 0, upserted = 0, skipped = 0;
    /** Uma linha por extrato tentado: qual, o que deu, e por quê. */
    const detalhes: Array<Record<string, unknown>> = [];
    // Um aviso por household, não um por conexão: quem tem 3 bancos sincronizados
    // na mesma rodada receberia 3 e-mails idênticos.
    const newByHousehold = new Map<string, number>();

    for (const conn of conns) {
      if (Date.now() > deadline) break; // resto fica para a próxima execução
      try {
        // Conta corrente desligada: pula direto para os cartões. Desligar tem
        // que parar de puxar de verdade, senão a chave é decorativa.
        /**
         * A conta corrente não pode levar os cartões junto quando cai.
         *
         * Estourando aqui, o `catch` lá de baixo abortava a conexão inteira e o
         * laço dos cartões nunca rodava. No Eduardo (2026-09-10) a conta não
         * tinha protocolo e a geração batia no limite da Technospeed: a falha
         * dela sozinha impedia a fatura do Latam de importar, com o protocolo
         * do cartão pronto e SUCCESS esperando ao lado.
         *
         * São extratos independentes, com protocolos próprios. Um cair não diz
         * nada sobre o outro.
         */
        const wantsAccount = (conn as Conn).account_import_enabled !== false;
        let r: { status: string; upserted?: number; reason?: string };
        if (!wantsAccount) {
          r = { status: 'skipped', reason: 'conta corrente desligada pelo cliente' };
        } else {
          try {
            r = await syncOne(conn as Conn, allowGenerate, reimport);
          } catch (e) {
            r = { status: 'error', reason: `conta corrente: ${e instanceof Error ? e.message : 'falha'}` };
          }
        }
        detalhes.push({
          banco: (conn as Conn).bank_name ?? '?',
          extrato: 'conta corrente',
          status: r.status,
          upserted: r.upserted ?? 0,
          motivo: r.reason ?? null,
        });

        // Uma passada por CARTÃO ligado. Cada protocolo custa 1 dos 4 diários
        // da conta, e a conta corrente já gastou 1 — por isso o teto de 3.
        const c = conn as Conn;
        const enabledCards = (Array.isArray(c.cards) ? c.cards : [])
          .filter((card) => card?.enabled && card?.last4)
          .slice(0, MAX_CARDS_PER_ACCOUNT);

        for (const card of enabledCards) {
          if (Date.now() > deadline) break;
          await new Promise((r2) => setTimeout(r2, READ_GAP_MS));
          try {
            const rc = await syncOne(c, allowGenerate, reimport, 'CREDIT_CARD', card);
            detalhes.push({
              banco: c.bank_name ?? '?', extrato: `cartao ${card.last4}`,
              status: rc.status, upserted: rc.upserted ?? 0, motivo: rc.reason ?? null,
            });
            if (rc.status === 'done') {
              const n = rc.upserted ?? 0;
              upserted += n;
              if (n > 0) newByHousehold.set(c.household_id, (newByHousehold.get(c.household_id) ?? 0) + n);
            } else if (rc.status === 'processing') processing++;
          } catch (e) {
            detalhes.push({
              banco: c.bank_name ?? '?', extrato: `cartao ${card.last4}`,
              status: 'error', upserted: 0,
              motivo: e instanceof Error ? e.message : 'falha',
            });
            errors++;
          }
        }

        if (r.status === 'skipped') { skipped++; continue; }
        if (r.status === 'done') {
          done++;
          const n = r.upserted ?? 0;
          upserted += n;
          if (n > 0) {
            const hh = (conn as Conn).household_id;
            newByHousehold.set(hh, (newByHousehold.get(hh) ?? 0) + n);
          }
        }
        else if (r.status === 'processing') processing++;
        else errors++;
      } catch {
        errors++;
      }
      // Respeita 3 leituras/min: uma conexão a cada ~21s
      await new Promise((r) => setTimeout(r, READ_GAP_MS));
    }

    // Aviso de transações novas. Não precisa de controle de repetição: o upsert
    // só conta o que entrou agora, então uma transação já importada nunca gera
    // um segundo e-mail.
    let notified = 0;
    let pushed = 0;
    for (const [householdId, count] of newByHousehold) {
      const plural2 = count === 1 ? '' : 's';
      // Push primeiro: é o que chega na hora. O e-mail sai logo abaixo de
      // qualquer jeito — quem não instalou o app depende só dele.
      if (await pushParaCasa(
        householdId,
        `${count} lançamento${plural2} novo${plural2}`,
        count === 1
          ? 'Chegou um gasto do seu banco. Toque para categorizar.'
          : `Chegaram ${count} gastos do seu banco. Toque para categorizar.`,
      )) pushed++;

      const target = await notifyTargetFor(householdId);
      if (!target) continue;
      const plural = count === 1 ? '' : 's';
      const hi = target.firstName ? `${target.firstName}, seus` : 'Seus';
      await sendMail(
        target.email,
        `💸 ${count} lançamento${plural} novo${plural} no Kashim`,
        emailShell(
          `${count} lançamento${plural} chegou${count === 1 ? '' : 'ram'} do seu banco`,
          `<p>${hi} gastos foram importados automaticamente — você não precisou digitar nada.</p>
           <p>Abra o app para conferir as categorias sugeridas e confirmar.</p>`,
          'Revisar lançamentos',
        ),
      );
      notified++;
    }

    return res.status(200).json({
      ok: true,
      mode: allowGenerate ? 'generate' : 'monitor',
      done, processing, errors, skipped, upserted, promoted, notified, pushed,
      // Sem isto, um contador de erro nao dizia QUAL conexao, QUAL cartao, nem
      // por que — e diagnosticar virava adivinhacao contra a producao.
      detalhes,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return res.status(500).json({ error: msg });
  }
}
