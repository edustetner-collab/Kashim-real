import { CategoryType } from '../../types';
import type { OFAccountType, OFDirection } from './types';

export type CategorySuggestion = {
  category: CategoryType | null;
  direction: OFDirection;
  confidence: 'high' | 'medium' | 'low';
};

// ─── Credit-card OF codes → Kashim bucket ────────────────────────────────────
// Based on the real Technospeed data (exemplo_cartaoCredito.json)

const CC_CODE_MAP: Record<string, CategoryType> = {
  ELECTRICITY: CategoryType.FIXED_EXPENSE,
  UTILITIES: CategoryType.FIXED_EXPENSE,
  TELECOM: CategoryType.FIXED_EXPENSE,
  INTERNET: CategoryType.FIXED_EXPENSE,
  INSURANCE: CategoryType.FIXED_EXPENSE,
  RENT: CategoryType.FIXED_EXPENSE,
  MORTGAGE: CategoryType.FIXED_EXPENSE,
  SCHOOL: CategoryType.FIXED_EXPENSE,
  HEALTH: CategoryType.FIXED_EXPENSE,
  MEDICALSERVICES: CategoryType.FIXED_EXPENSE,
  SUBSCRIPTION: CategoryType.FIXED_EXPENSE,
  WELLNESSANDFITNESS: CategoryType.FIXED_EXPENSE,
  SERVICES: CategoryType.VARIABLE_EXPENSE,
  VEHICLEMAINTENANCE: CategoryType.VARIABLE_EXPENSE,
  AUTOMOTIVE: CategoryType.VARIABLE_EXPENSE,
  GASSTATIONS: CategoryType.VARIABLE_EXPENSE,
  FOOD: CategoryType.VARIABLE_EXPENSE,
  SUPERMARKET: CategoryType.VARIABLE_EXPENSE,
  RESTAURANT: CategoryType.VARIABLE_EXPENSE,
  TRANSPORT: CategoryType.VARIABLE_EXPENSE,
  CLOTHING: CategoryType.VARIABLE_EXPENSE,
  HOMEIMPROVEMENT: CategoryType.VARIABLE_EXPENSE,
  DIGITALSERVICES: CategoryType.VARIABLE_EXPENSE,
  ENTREPRENEURIALACTIVITIES: CategoryType.VARIABLE_EXPENSE,
  LATEPAYMENTANDOVERDRAFTCOSTS: CategoryType.VARIABLE_EXPENSE,
  ENTERTAINMENT: CategoryType.PERSONAL_LEISURE,
  RECREATION: CategoryType.PERSONAL_LEISURE,
  PERSONALCARE: CategoryType.PERSONAL_LEISURE,
  TRAVEL: CategoryType.PERSONAL_LEISURE,
  BARS: CategoryType.PERSONAL_LEISURE,
};

// ─── Human-readable category labels → Kashim bucket ─────────────────────────
// Normalized to lowercase, accent-stripped. Works for both account and CC data.
// Covers mojibake-fixed labels (e.g. "Transferência" after fixMojibake).

const LABEL_DIRECTION_MAP: Record<string, OFDirection> = {
  salário: 'income',
  salario: 'income',
  rendimentos: 'income',
  renda: 'income',
  remuneração: 'income',
  remuneracao: 'income',
  vendas: 'income',
  reembolso: 'income',
  investimentos: 'savings',
  investimento: 'savings',
  aplicação: 'savings',
  aplicacao: 'savings',
  transferência: 'ignore',
  transferencia: 'ignore',
};

const LABEL_CATEGORY_MAP: Record<string, CategoryType> = {
  moradia: CategoryType.FIXED_EXPENSE,
  aluguel: CategoryType.FIXED_EXPENSE,
  condomínio: CategoryType.FIXED_EXPENSE,
  condominio: CategoryType.FIXED_EXPENSE,
  utilidades: CategoryType.FIXED_EXPENSE,
  utilidade: CategoryType.FIXED_EXPENSE,
  'água': CategoryType.FIXED_EXPENSE,
  agua: CategoryType.FIXED_EXPENSE,
  energia: CategoryType.FIXED_EXPENSE,
  luz: CategoryType.FIXED_EXPENSE,
  gás: CategoryType.FIXED_EXPENSE,
  gas: CategoryType.FIXED_EXPENSE,
  internet: CategoryType.FIXED_EXPENSE,
  telefone: CategoryType.FIXED_EXPENSE,
  saúde: CategoryType.FIXED_EXPENSE,
  saude: CategoryType.FIXED_EXPENSE,
  plano: CategoryType.FIXED_EXPENSE,
  escola: CategoryType.FIXED_EXPENSE,
  educação: CategoryType.FIXED_EXPENSE,
  educacao: CategoryType.FIXED_EXPENSE,
  academia: CategoryType.FIXED_EXPENSE,
  alimentação: CategoryType.VARIABLE_EXPENSE,
  alimentacao: CategoryType.VARIABLE_EXPENSE,
  supermercado: CategoryType.VARIABLE_EXPENSE,
  mercado: CategoryType.VARIABLE_EXPENSE,
  restaurante: CategoryType.VARIABLE_EXPENSE,
  transporte: CategoryType.VARIABLE_EXPENSE,
  combustível: CategoryType.VARIABLE_EXPENSE,
  combustivel: CategoryType.VARIABLE_EXPENSE,
  'veículo': CategoryType.VARIABLE_EXPENSE,
  veiculo: CategoryType.VARIABLE_EXPENSE,
  serviços: CategoryType.VARIABLE_EXPENSE,
  servicos: CategoryType.VARIABLE_EXPENSE,
  serviço: CategoryType.VARIABLE_EXPENSE,
  servico: CategoryType.VARIABLE_EXPENSE,
  lazer: CategoryType.PERSONAL_LEISURE,
  entretenimento: CategoryType.PERSONAL_LEISURE,
  viagem: CategoryType.PERSONAL_LEISURE,
  'pessoal': CategoryType.PERSONAL_LEISURE,
};

function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/**
 * Suggest a Kashim category and direction for an OF transaction.
 *
 * Priority:
 * 1. direction override (income/savings/ignore) from label — highest signal
 * 2. category label → specific CategoryType (high confidence)
 * 3. OF code → CategoryType (medium confidence for CC, low for account)
 * 4. null — user must decide (low confidence)
 */
export function suggestCategory(params: {
  accountType: OFAccountType;
  rawDirection: 'credit' | 'debit';
  code: string;
  ofCategory: string | null;
  paymentMethod: string | null;
}): CategorySuggestion {
  const { accountType, rawDirection, code, ofCategory } = params;

  // Always skip these
  if (code === 'CREDITCARDPAYMENT') return { category: null, direction: 'ignore', confidence: 'high' };
  if (code === 'TEV') return { category: null, direction: 'ignore', confidence: 'high' };

  const normalizedLabel = ofCategory ? normalizeLabel(ofCategory) : '';

  // ── Checking account ───────────────────────────────────────────────────────
  if (accountType === 'checking') {
    // Check label for direction override (income, savings, ignore)
    if (normalizedLabel) {
      const dirOverride = LABEL_DIRECTION_MAP[normalizedLabel];
      if (dirOverride === 'income') return { category: CategoryType.INCOME, direction: 'income', confidence: 'high' };
      if (dirOverride === 'savings') return { category: null, direction: 'savings', confidence: 'high' };
      if (dirOverride === 'ignore') return { category: null, direction: 'ignore', confidence: 'high' };
    }

    if (rawDirection === 'credit') {
      // Unlabeled credit → treat as income (user can reclassify)
      return { category: CategoryType.INCOME, direction: 'income', confidence: 'low' };
    }

    // Debit — check label for category
    if (normalizedLabel) {
      const cat = LABEL_CATEGORY_MAP[normalizedLabel];
      if (cat) return { category: cat, direction: 'expense', confidence: 'high' };
    }
    return { category: CategoryType.VARIABLE_EXPENSE, direction: 'expense', confidence: 'low' };
  }

  // ── Credit card ────────────────────────────────────────────────────────────
  if (rawDirection === 'credit') {
    // CC credits that aren't CREDITCARDPAYMENT = refund/estorno — skip for now
    return { category: null, direction: 'ignore', confidence: 'high' };
  }

  // CC debit → expense, use code map first then label
  const ccCat = CC_CODE_MAP[code.toUpperCase()];
  if (ccCat) return { category: ccCat, direction: 'expense', confidence: 'medium' };

  if (normalizedLabel) {
    const labelCat = LABEL_CATEGORY_MAP[normalizedLabel];
    if (labelCat) return { category: labelCat, direction: 'expense', confidence: 'medium' };
  }

  return { category: CategoryType.VARIABLE_EXPENSE, direction: 'expense', confidence: 'low' };
}

/** Extract merchant key from description for memory lookup/storage */
export function merchantKey(description: string): string {
  // Strip installment suffix " NN/NN" and normalize
  return description
    .replace(/\s+\d{2}\/\d{2}$/, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}
