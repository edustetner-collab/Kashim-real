import type {
  OFRawEnvelope,
  OFRawTransaction,
  OFTransaction,
  OFAccountType,
  OFDirection,
} from './types';
import { suggestCategory } from './categoryMap';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fix mojibake: bytes were stored as Latin-1 but the string was decoded as
 * if each char code were a raw byte, then re-encoded as UTF-8.
 * Example: "SalÃ¡rio" → "Salário"
 */
function fixMojibake(s: string): string {
  if (!s) return s;
  try {
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
    const decoded = new TextDecoder('utf-8').decode(bytes);
    // Only return the decoded version if it produced valid non-replacement chars
    return decoded.includes('�') ? s : decoded;
  } catch {
    return s;
  }
}

function parseAmount(raw: string | undefined | null): number {
  if (!raw) return 0;
  return parseFloat(raw) || 0;
}

/** Deixa "EDP SAO PAULO DISTRIBUICAO DE ENERGIA S.A." legível numa linha. */
function tidyMerchant(s: string): string {
  const clean = s.trim().replace(/\s+/g, ' ');
  // Só reformata quando vem TUDO EM CAIXA ALTA, que é o padrão dos bancos.
  if (clean !== clean.toUpperCase()) return clean;
  const minor = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return clean
    .toLowerCase()
    .split(' ')
    .map((w, i) => {
      if (i > 0 && minor.has(w)) return w;
      if (/^(s\.?a\.?|ltda\.?|me|epp|eireli)$/i.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

/**
 * Nome que o cliente reconhece.
 *
 * Ordem: contraparte estruturada → trecho depois de "DES:" na descrição →
 * nada. O campo `name` NÃO entra: no extrato real ele é o titular da conta em
 * 110 de 110 transações, então usá-lo mostraria o nome do próprio cliente em
 * cada linha.
 */
function extractMerchant(raw: OFRawTransaction): string | null {
  // Numa saída interessa quem recebeu; numa entrada, quem pagou.
  const party = raw.transactionType === 'debit' ? raw.participantReceiver : raw.participantPayer;
  const partyName = party?.name?.trim();
  if (partyName) return tidyMerchant(fixMojibake(partyName));

  // "PIX ENVIADO - DES  JAIME DE SIQUEIRA SIL 0" → "Jaime de Siqueira Sil"
  const m = (raw.description ?? '').match(/-\s*DES:?\s+(.+?)\s*\d*$/i);
  if (m?.[1] && m[1].trim().length > 2) return tidyMerchant(fixMojibake(m[1]));

  return null;
}

/** Detect "NN/NN" installment suffix in description */
function detectInstallment(desc: string) {
  const match = desc.match(/\s(\d{2})\/(\d{2})$/);
  if (!match) return null;
  const current = parseInt(match[1], 10);
  const total = parseInt(match[2], 10);
  if (isNaN(current) || isNaN(total) || total === 0) return null;
  return { current, total };
}

// ─── Core parser ─────────────────────────────────────────────────────────────

function normalizeTx(
  raw: OFRawTransaction,
  accountType: OFAccountType,
  accountHash: string,
  bankCode: string,
  direction: OFDirection,
): OFTransaction {
  const desc = fixMojibake(raw.description ?? '').trim();
  const ofCategory = raw.category ? fixMojibake(raw.category) : null;

  const suggestion = suggestCategory({
    accountType,
    rawDirection: raw.transactionType,
    code: raw.code,
    ofCategory,
    paymentMethod: raw.paymentMethod ?? null,
  });

  // Use pre-computed direction from suggestion if it overrides (e.g. credit
  // becoming 'ignore'). For already-decided directions, keep the passed value.
  const finalDirection = suggestion.direction !== direction &&
    (suggestion.direction === 'ignore' || suggestion.direction === 'savings' || suggestion.direction === 'income')
    ? suggestion.direction
    : direction;

  const billDueDateRaw = raw.creditCardBill?.dueDate ?? null;

  return {
    transactionId: raw.transactionId,
    fitid: raw.fitid ?? null,
    accountType,
    accountHash,
    bankCode,
    direction: finalDirection,
    amount: Math.abs(parseAmount(raw.amount)),
    date: raw.date,
    description: desc,
    merchant: extractMerchant(raw),
    ofCode: raw.code,
    ofCategory,
    paymentMethod: raw.paymentMethod ?? null,
    cardLast4: raw.creditCardNumber ?? null,
    billDueDate: billDueDateRaw,
    billTotal: raw.creditCardBill?.totalAmount ?? null,
    suggestedCategory: suggestion.direction === 'ignore' ? null : suggestion.category,
    suggestionConfidence: suggestion.confidence,
    installmentInfo: detectInstallment(desc),
  };
}

/**
 * Parse a raw Technospeed envelope into a flat array of normalized transactions.
 *
 * Filtering applied:
 * - CREDITCARDPAYMENT → ignored (direction: 'ignore')
 * - TEV (same-owner transfer) → ignored
 * - CC credit[] that are not CREDITCARDPAYMENT → ignored (refunds; complex edge)
 * - All ignored transactions are excluded from the output array entirely.
 *
 * The result contains only transactions the user needs to act on
 * (expense, income, savings). Caller decides which directions to display.
 */
export function parseStatement(envelope: OFRawEnvelope): OFTransaction[] {
  const stmt = envelope.statement;
  const accountType: OFAccountType = stmt.type === 'credit_card' ? 'credit_card' : 'checking';
  const accountHash = stmt.accountHash;
  const bankCode = stmt.bankCode;

  const credits = envelope.transaction?.credit ?? [];
  const debits = envelope.transaction?.debit ?? [];
  const results: OFTransaction[] = [];

  // ── Process debit[] ────────────────────────────────────────────────────────
  for (const tx of debits) {
    // Checking: some debits are savings (e.g. TED to broker)
    const suggestion = suggestCategory({
      accountType,
      rawDirection: 'debit',
      code: tx.code,
      ofCategory: tx.category,
      paymentMethod: tx.paymentMethod ?? null,
    });
    if (suggestion.direction === 'ignore') continue;

    results.push(normalizeTx(tx, accountType, accountHash, bankCode, suggestion.direction));
  }

  // ── Process credit[] ───────────────────────────────────────────────────────
  for (const tx of credits) {
    if (tx.code === 'CREDITCARDPAYMENT') continue;
    if (tx.code === 'TEV') continue;

    if (accountType === 'credit_card') {
      // CC credits = refunds/estornos — skip for MVP
      continue;
    }

    const suggestion = suggestCategory({
      accountType,
      rawDirection: 'credit',
      code: tx.code,
      ofCategory: tx.category,
      paymentMethod: tx.paymentMethod ?? null,
    });
    if (suggestion.direction === 'ignore') continue;

    results.push(normalizeTx(tx, accountType, accountHash, bankCode, suggestion.direction));
  }

  return results;
}

/**
 * Given a credit-card transaction, determine which Kashim year+month it should
 * land in based on the bill due date. Falls back to the transaction date.
 */
export function resolveKashimMonth(tx: OFTransaction): { year: number; month: number } {
  const dateStr = tx.billDueDate ?? tx.date;
  const [y, m] = dateStr.split('-').map(Number);
  return { year: y, month: m - 1 }; // month is 0-indexed like JS Date
}

/**
 * Convert a cut-off date string (YYYY-MM-DD) to a filter function.
 * Transactions strictly before cutoff are excluded.
 *
 * Use to implement the "import from start of current plan month only" rule.
 */
export function makeCutoffFilter(cutoffDate: string) {
  return (tx: OFTransaction) => tx.date >= cutoffDate;
}
