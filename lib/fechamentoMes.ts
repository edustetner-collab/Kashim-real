import { CategoryType, FinanceItem, PartialExpense } from '../types';

/**
 * Fechamento do mês — a lógica, sem tela.
 *
 * Na virada, o app pergunta o que ficou sem pagar e por quanto, em vez de
 * adivinhar. Desenho validado com o Eduardo em 2026-08-27; o mockup das telas
 * está em https://claude.ai/code/artifact/51e4f852-32b0-4dc4-8abf-5aae299036ee
 *
 * Duas regras que sustentam tudo:
 *   1. TUDO JÁ VEM MARCADO COMO PAGO. A maioria paga e não marca; tratar
 *      "não marcado" como "não pago" criaria dívidas que não existem.
 *   2. SÓ CONTA FIXA E LAZER entram. Variável é imprevisto — não faz sentido
 *      perguntar "você pagou o mercado?". Renda e cartão não têm o que pagar.
 */

/** Chave usada em `partialExpenses`. */
export const monthKeyOf = (year: number, monthIndex: number) => `${year}-${monthIndex}`;

export interface ContaDoFechamento {
  itemId: string;
  descricao: string;
  /** O que estava planejado para o mês. */
  previsto: number;
  /** Soma do que foi lançado no mês. */
  lancado: number;
  temLancamento: boolean;
}

export interface ResumoFechamento {
  /** Contas sem lançamento nenhum — o app não sabe se foram pagas. */
  semLancamento: ContaDoFechamento[];
  /** Lançaram valor diferente do previsto — parcial ou conta mudou de valor? */
  divergentes: ContaDoFechamento[];
  /** Nada a perguntar: mês já resolvido. */
  vazio: boolean;
}

const CATEGORIAS_QUE_ENTRAM = [CategoryType.FIXED_EXPENSE, CategoryType.PERSONAL_LEISURE];

/**
 * O que perguntar sobre o mês que acabou.
 *
 * Fica de fora, de propósito:
 *   - variáveis, renda e cartão (ver regra 2 acima);
 *   - linha sem valor previsto — não havia compromisso;
 *   - linha já marcada como paga — o cliente já respondeu.
 */
export function montarFechamento(
  items: FinanceItem[],
  monthIdx: number,
  monthKey: string,
): ResumoFechamento {
  const semLancamento: ContaDoFechamento[] = [];
  const divergentes: ContaDoFechamento[] = [];

  for (const item of items) {
    if (!CATEGORIAS_QUE_ENTRAM.includes(item.category)) continue;
    if (item.paidStatus?.[monthIdx]) continue;

    const previsto = item.values[monthIdx] || 0;
    if (previsto <= 0) continue;

    const partials = (item.partialExpenses?.[monthKey] || []) as PartialExpense[];
    const lancado = partials.reduce((s, p) => s + (p.value || 0), 0);

    const conta: ContaDoFechamento = {
      itemId: item.id,
      descricao: item.description || 'Sem nome',
      previsto,
      lancado,
      temLancamento: partials.length > 0,
    };

    if (!conta.temLancamento) semLancamento.push(conta);
    else if (Math.abs(lancado - previsto) >= 0.01) divergentes.push(conta);
    // lançou exatamente o previsto: pagou certinho, nada a perguntar.
  }

  return { semLancamento, divergentes, vazio: semLancamento.length === 0 && divergentes.length === 0 };
}

/** Quantos meses seguidos esta conta vem sendo empurrada para frente. */
export function contarAcumulo(item: FinanceItem, monthIdx: number, meses: { year: number; index: number }[]): number {
  let n = 0;
  for (let m = monthIdx; m >= 0; m--) {
    const mk = meses[m] ? monthKeyOf(meses[m].year, meses[m].index) : '';
    const partials = (item.partialExpenses?.[mk] || []) as PartialExpense[];
    const pago = item.paidStatus?.[m] === true;
    const teveGasto = partials.length > 0;
    // Empurrado = tinha valor previsto, não foi pago e não teve lançamento.
    if ((item.values[m] || 0) > 0 && !pago && !teveGasto) n++;
    else break;
  }
  return n;
}

/**
 * Aplica o resultado do fechamento aos itens. Devolve uma lista NOVA — nada é
 * mutado, para o React enxergar a mudança e o histórico não se perder no meio.
 */
export interface DecisaoFechamento {
  itemId: string;
  /** true = paguei · false = ficou em aberto */
  pago: boolean;
  /** Valor confirmado pelo cliente (pode ter sido editado na tela). */
  valor: number;
  /** Só quando pago e o valor veio diferente: o novo valor vale daqui pra frente? */
  propagar?: boolean;
  /** Só quando pago e o valor veio diferente: foi pagamento parcial? */
  parcial?: boolean;
}

export function aplicarFechamento(
  items: FinanceItem[],
  decisoes: DecisaoFechamento[],
  monthIdx: number,
): FinanceItem[] {
  const porItem = new Map(decisoes.map(d => [d.itemId, d]));

  return items.map(item => {
    const d = porItem.get(item.id);
    if (!d) return item;

    const values = [...item.values];
    const paidStatus = [...(item.paidStatus || [])];
    const proximo = monthIdx + 1;
    const previsto = item.values[monthIdx] || 0;

    if (d.pago) {
      paidStatus[monthIdx] = true;
      values[monthIdx] = d.valor;

      if (d.parcial) {
        // O que faltou vira dívida no mês seguinte, somado à conta de lá.
        const falta = Math.max(0, previsto - d.valor);
        if (falta > 0 && proximo < values.length) values[proximo] = (values[proximo] || 0) + falta;
      } else if (d.propagar) {
        // Conta mudou de valor: vale deste mês em diante. Evita o cliente ter
        // que editar mês a mês — que é o trabalho que ele não faz, e por isso
        // o plano vai ficando velho.
        for (let m = proximo; m < values.length; m++) values[m] = d.valor;
      }
    } else {
      // Não paga: sai deste mês (não saiu dinheiro) e soma no seguinte.
      values[monthIdx] = 0;
      paidStatus[monthIdx] = false;
      if (proximo < values.length) values[proximo] = (values[proximo] || 0) + previsto;
    }

    return { ...item, values, paidStatus };
  });
}
