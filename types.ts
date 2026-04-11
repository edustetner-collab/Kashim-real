
export enum CategoryType {
  INCOME = 'Renda',
  CREDIT_CARD = 'Cartão de Crédito',
  FIXED_EXPENSE = 'Contas Fixas',
  VARIABLE_EXPENSE = 'Contas Variáveis',
  PERSONAL_LEISURE = 'Lazer e Gastos Pessoais'
}

export enum LinkType {
  RECURRING = 'Recorrente',
  INSTALLMENT = 'Parcelado'
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
