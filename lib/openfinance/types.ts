import { CategoryType } from '../../types';

// ─── Raw Technospeed shapes ───────────────────────────────────────────────────

export interface OFRawStatement {
  uniqueId?: string;
  dateStart?: string;
  dateEnd?: string;
  bankCode: string;
  totalTransactions?: string;
  origin?: string;
  accountHash: string;
  status?: string;
  reason?: string;
  /** Present only for credit card statements */
  type?: 'credit_card';
  creditCardCurrentAvaliableCreditLimit?: string;
  creditCardCurrentCreditLimit?: string;
}

export interface OFRawCreditCardBill {
  dueDate: string | null;
  totalAmount: number | null;
  financeCharges?: Array<null>;
  allowsInstallments: boolean | null;
  minimumPaymentAmount: number | null;
  totalAmountCurrencyCode: string | null;
}

export interface OFRawCreditCardMerchant {
  cnae: string | null;
  cpfCnpj: string | null;
  category: string | null;
  name: string | null;
}

/** A single transaction row from credit_card or checking statement */
export interface OFRawTransaction {
  transactionId: string;
  transactionType: 'credit' | 'debit';
  code: string;
  amount: string;
  date: string;
  sequence: number;
  description: string;
  fitid: string | null;
  name: string | null;
  category: string | null;
  // Credit card specific
  creditCardAmountInAccountCurrency?: string | null;
  creditCardNumber?: string | null;
  creditCardBill?: OFRawCreditCardBill;
  creditCardMerchant?: OFRawCreditCardMerchant;
  // Checking account specific
  paymentName?: string | null;
  paymentMethod?: string | null;
  paymentBarcode?: string | null;
  paymentBaseAmount?: string | null;
  paymentDigitableLine?: string | null;
  paymentDiscountAmount?: string | null;
  paymentInterestAmount?: string | null;
  paymentPenaltyAmount?: string | null;
  /**
   * Contraparte real da transação — não aparece no exemplo da documentação,
   * mas vem preenchido em ~75% do extrato real. É daqui que sai o nome do
   * estabelecimento ("EDP SAO PAULO DISTRIBUICAO DE ENERGIA S.A."); o campo
   * `name` é sempre o titular da conta e não serve para isso.
   */
  participantPayer?: OFRawParticipant | null;
  participantReceiver?: OFRawParticipant | null;
}

export interface OFRawParticipant {
  name?: string | null;
  routingNumber?: string | null;
  routingNumberISPB?: string | null;
  documentNumber?: { type?: string | null; value?: string | null } | null;
}

export interface OFRawBalance {
  date: string;
  balance: string;
}

export interface OFRawEnvelope {
  statement: OFRawStatement;
  transaction: {
    credit: OFRawTransaction[];
    debit: OFRawTransaction[];
  };
  transactionDuplicated?: {
    credit: unknown[];
    debit: unknown[];
  };
  balance?: {
    inicial: OFRawBalance;
    final: OFRawBalance;
  };
}

// ─── Normalized transaction ───────────────────────────────────────────────────

export type OFAccountType = 'credit_card' | 'checking';

/**
 * Pre-computed semantic direction:
 * - expense  → goes into the "A categorizar" queue
 * - income   → user confirms as Renda (income item)
 * - savings  → user confirms as Poupar/Investir
 * - ignore   → CREDITCARDPAYMENT, TEV — never shown to user
 */
export type OFDirection = 'expense' | 'income' | 'savings' | 'ignore';

export interface OFInstallmentInfo {
  current: number;
  total: number;
}

export interface OFTransaction {
  transactionId: string;
  fitid: string | null;
  accountType: OFAccountType;
  accountHash: string;
  bankCode: string;
  direction: OFDirection;
  amount: number;
  /** Purchase/transaction date (YYYY-MM-DD) */
  date: string;
  /** Normalized, UTF-8-clean description */
  description: string;
  /**
   * Nome de quem recebeu (ou pagou, se for entrada). É o que o cliente
   * reconhece — "PIX QR CODE DINAMICO - DES: EDP SP" não diz nada, "EDP São
   * Paulo" diz. `null` quando o extrato não identifica a contraparte.
   */
  merchant: string | null;
  ofCode: string;
  /** Human-readable category from provider, UTF-8 clean */
  ofCategory: string | null;
  /** PIX / TED / BOLETO / TEV / DOC — checking accounts only */
  paymentMethod: string | null;
  // Credit card
  cardLast4: string | null;
  /** Month the bill is due — determines which Kashim month this expense hits */
  billDueDate: string | null;
  billTotal: number | null;
  // Suggestion
  suggestedCategory: CategoryType | null;
  /** 'high' when category label matches exactly; 'medium' when code matches; 'low' = fallback */
  suggestionConfidence: 'high' | 'medium' | 'low';
  installmentInfo: OFInstallmentInfo | null;
}

// ─── Stored bank_transaction row (from/to Supabase) ──────────────────────────

export type OFTxStatus = 'pending' | 'categorized' | 'ignored';

export interface BankTransaction {
  id: string;
  householdId: string;
  connectionId: string | null;
  transactionId: string;
  fitid: string | null;
  accountType: OFAccountType;
  transactionType: OFDirection;
  ofCode: string | null;
  ofCategory: string | null;
  amount: number;
  transactionDate: string;
  description: string | null;
  /** Nome de quem recebeu/pagou — é o que a tela mostra em destaque */
  merchant: string | null;
  paymentMethod: string | null;
  cardLast4: string | null;
  billDueDate: string | null;
  billTotal: number | null;
  status: OFTxStatus;
  kashimItemId: string | null;
  kashimCategory: string | null;
  kashimPartialId: string | null;
  categorizedAt: string | null;
  createdAt: string;
  suggestedCategory: string | null;
  /** 'memory' = o cliente já categorizou este estabelecimento antes */
  suggestionConfidence: string | null;
  /** Item do plano lembrado da última vez — só vem junto com 'memory' */
  suggestedItemId: string | null;
  installmentCurrent: number | null;
  installmentTotal: number | null;
}
