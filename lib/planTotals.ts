import { CategoryType, FinanceItem } from '../types';
import { isEducationItem } from './educationUtils';

/**
 * Totais por categoria do jeito que a aba **Plano** calcula.
 *
 * Existe porque Plano e Desempenho calculavam a mesma coisa por caminhos
 * diferentes e divergiam na cara do cliente: em 2026-08-17 o Eduardo via
 * Contas Fixas 36% no Plano e 15% no Desempenho, com Educação e Lazer zerados.
 *
 * A causa era a fonte do número. O Plano soma `item.values[monthIdx]` **bruto**.
 * O Desempenho lia `SummaryData.totalFixed` / `totalLeisure`, que são valores
 * **líquidos**: no mês corrente todo item ligado a cartão de crédito é
 * descontado dali (vai para a fatura do mês seguinte, e somar os dois
 * duplicaria o gasto). Isso é correto para apurar saldo, mas zera a leitura de
 * distribuição — quem paga o lazer todo no cartão aparecia com 0% de lazer.
 *
 * Regra: Desempenho é reflexo do Plano. Quem mede distribuição por categoria
 * chama esta função. `SummaryData` continua sendo a fonte para saldo e sobra.
 */

export interface PlanTotals {
  /** Contas fixas sem os itens de educação (o Plano separa os dois). */
  fixedCore: number;
  education: number;
  variable: number;
  leisure: number;
}

export function getPlanTotals(items: FinanceItem[], monthIdx: number): PlanTotals {
  const sum = (list: FinanceItem[]) =>
    list.reduce((total, item) => total + (item.values[monthIdx] || 0), 0);

  const fixed = items.filter(i => i.category === CategoryType.FIXED_EXPENSE);

  return {
    fixedCore: sum(fixed.filter(i => !isEducationItem(i.description))),
    education: sum(fixed.filter(i => isEducationItem(i.description))),
    variable: sum(items.filter(i => i.category === CategoryType.VARIABLE_EXPENSE)),
    leisure: sum(items.filter(i => i.category === CategoryType.PERSONAL_LEISURE)),
  };
}

/** Percentual sobre a renda, na mesma escala das barras do Plano. */
export function toIncomePct(value: number, totalIncome: number): number {
  if (!totalIncome || totalIncome <= 0) return 0;
  return (value / totalIncome) * 100;
}
