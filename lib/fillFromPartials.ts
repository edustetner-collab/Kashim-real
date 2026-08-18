import { CategoryType, FinanceItem } from '../types';

/**
 * Preenche o valor planejado de contas variaveis a partir dos lancamentos ja
 * categorizados no mes.
 *
 * Com Open Finance nada mais e digitado a mao: a linha nasce quando um gasto do
 * extrato e categorizado. Sem isto a linha ficava com "0,00" no valor principal
 * e o gasto so aparecia no selo azul embaixo — foi o caso do "Serasa S.A.",
 * zerado com R$ 64,99 lancado.
 *
 * So preenche onde o valor esta ZERO. Teto definido pelo cliente (ou pelo coach)
 * nunca e sobrescrito, mesmo que o gasto real passe dele.
 *
 * Roda no carregamento do banco, e nao num efeito preso a `items.length`: os
 * itens ja comecam preenchidos com o padrao (`makeDefaultItems`), entao um
 * efeito assim disparava e se marcava como concluido antes dos dados reais
 * chegarem, e a correcao nunca acontecia.
 */
export function fillVariableValuesFromPartials(
  items: FinanceItem[],
  months: { year: number; index: number }[],
): FinanceItem[] {
  if (items.length === 0 || months.length === 0) return items;

  return items.map(item => {
    if (item.category !== CategoryType.VARIABLE_EXPENSE) return item;
    if (!item.partialExpenses) return item;

    const values = [...item.values];
    let touched = false;

    months.forEach((month, monthIdx) => {
      if ((values[monthIdx] || 0) > 0) return;
      const partials = item.partialExpenses?.[`${month.year}-${month.index}`] || [];
      if (partials.length === 0) return;
      values[monthIdx] = partials.reduce((total, p) => total + p.value, 0);
      touched = true;
    });

    return touched ? { ...item, values } : item;
  });
}
