
export enum CategoryType {
  INCOME = 'Renda',
  CREDIT_CARD = 'Cartão de Crédito',
  FIXED_EXPENSE = 'Contas Fixas',
  VARIABLE_EXPENSE = 'Contas Variáveis',
  PERSONAL_LEISURE = 'Lazer e Gastos Pessoais'
}

export enum LinkType {
  RECURRING = 'Recorrente',
  INSTALLMENT = 'Parcelado',
  DEBIT = 'Débito',
  ONCE = 'À Vista'
}

export interface MonthData {
  monthName: string;
  year: number;
}

export interface PartialExpense {
  id: string;
  date: string;
  description: string;
  value: number;
  originalDate?: string; // Para controle de fechamento
  /**
   * Como o gasto foi pago.
   *   'debit'  → débito, Pix ou dinheiro: o dinheiro já saiu da conta
   *   'credit' → cartão: ainda vai sair, na fatura
   *   undefined → lançamento antigo, anterior a este campo
   *
   * O teto do item continua sendo UM só (o cliente decide quanto quer gastar
   * com mercado, não com "mercado no crédito"). Isto existe para mostrar
   * quanto daquele total já saiu do bolso e quanto ainda vem.
   */
  paymentSource?: 'debit' | 'credit';
  /**
   * Ultimos 4 digitos do cartao DESTE lancamento.
   *
   * O cartao estava so em `FinanceItem.linkedCardId`, ou seja, na LINHA: se
   * "Assinaturas" apontava para o Latam, um gasto vindo do extrato do Bradesco
   * aparecia como Latam. Com o Open Finance a mesma linha recebe gasto de
   * cartoes diferentes, entao o cartao passa a pertencer ao lancamento — do
   * mesmo jeito que `paymentSource` ja pertence.
   *
   * `undefined` = lancamento antigo ou manual: vale o cartao da linha.
   */
  cardLast4?: string;
}

export interface FinanceItem {
  id: string;
  description: string;
  category: CategoryType;
  values: number[]; // 12 months
  paidStatus: boolean[]; // 12 months
  linkedCardId?: string; 
  linkType?: LinkType;
  partialExpenses?: Record<string, PartialExpense[]>; // Key: "year-month"
  closingDay?: number; // Novo: Dia de fechamento da fatura
  dueDay?: number;     // Novo: Dia de vencimento da fatura
}

/**
 * Retrato do mes em REGIME DE CAIXA: o que entra e o que SAI DA CONTA no mes.
 *
 * Atencao a semantica, porque ela ja causou numero duplicado antes:
 * - `totalCreditCard` e a fatura que vence no mes, INTEIRA (o banco debita o
 *   valor cheio, categorizado ou nao).
 * - `totalFixed`, `totalVariable` e `totalLeisure` sao so a parte paga FORA do
 *   cartao. O que foi no cartao ja esta dentro de `totalCreditCard`; somar nos
 *   dois lugares conta o mesmo gasto duas vezes.
 * - `totalCost` = a soma dos quatro acima. `balance` = `totalIncome - totalCost`.
 *
 * Para "quanto gastei com esta categoria neste mes" (data da COMPRA, nao do
 * pagamento) NAO use estes campos: use `getPlanTotals` em lib/planTotals.ts,
 * que e o mesmo calculo da aba Plano. E o que alimenta teto e Desempenho.
 */
export interface SummaryData {
  totalIncome: number;
  totalCreditCard: number;
  totalFixed: number;
  totalVariable: number;
  totalLeisure: number;
  totalCost: number;
  balance: number;
  accumulated: number;
}

export interface Goal {
  id: string;
  title: string;
  emoji: string;
  targetAmount: number;
  currentAmount: number;
  deadline?: string;
  createdAt: string;
}

export interface NotificationPrefs {
  weeklyEmail: boolean;
  pushEnabled: boolean;
  alertThresholdPct: number;
  recurringReminderDay: number;
}
