import { FinanceItem, LinkType, PartialExpense } from '../types';

export interface SourceInfo {
  /** Chave de agrupamento — mesma fonte, mesma chave. */
  key: string;
  label: string;
  isCredit: boolean;
  cardLast4?: string;
}

/** Pega os 4 digitos de uma descricao tipo "Bradesco ..2387". */
export function extractLast4(description?: string): string | undefined {
  return description?.match(/(\d{4})\s*$/)?.[1] ?? description?.match(/••(\d{4})/)?.[1];
}

/**
 * Descobre em que forma de pagamento um lancamento aconteceu.
 *
 * A ordem importa:
 *   1. `paymentSource` gravado no lancamento (veio do extrato) — manda sempre.
 *   2. Lancamento sem esse campo e ANTIGO ou manual: vale o cartao da linha
 *      (`item.linkedCardId` + `linkType`), exatamente como types.ts descreve.
 *   3. Nada disso: debito.
 *
 * O passo 2 nao existia no codigo, so na documentacao do tipo: todo lugar fazia
 * `paymentSource === 'credit' ? cartao : debito`, e `undefined` caia em debito.
 * Por isso o Mercado, lancado inteiro no cartao Latam antes do Open Finance,
 * aparecia como "Debito / Pix R$ 1.641,01" — dinheiro que nunca saiu da conta.
 */
export function getSourceInfo(
  partial: PartialExpense,
  item: FinanceItem | undefined,
  allCards: FinanceItem[],
): SourceInfo {
  const cardName = (last4?: string) => {
    const card = allCards.find(c => extractLast4(c.description) === last4);
    return card?.description || (last4 ? `Cartão ••${last4}` : null);
  };

  if (partial.paymentSource === 'credit') {
    const last4 = partial.cardLast4;
    if (last4) {
      return { key: `credit_${last4}`, label: cardName(last4) || `Cartão ••${last4}`, isCredit: true, cardLast4: last4 };
    }
    // Cartao de credito sem o numero na resposta do banco. Nao e um cartao novo
    // — e um lancamento que perdeu a identificacao. Dizer "Cartao ..?" fazia
    // parecer que existia mais um cartao, e o cliente procurava a fatura dele.
    const fallback = item?.linkedCardId ? allCards.find(c => c.id === item.linkedCardId) : null;
    if (fallback) {
      const l4 = extractLast4(fallback.description);
      return { key: `credit_${l4 ?? fallback.id}`, label: fallback.description || 'Cartão', isCredit: true, cardLast4: l4 };
    }
    return { key: 'credit_sem_id', label: 'Cartão (sem identificação)', isCredit: true };
  }

  if (partial.paymentSource === 'debit') {
    return { key: 'debit', label: 'Débito / Pix', isCredit: false };
  }

  // Sem forma de pagamento gravada: vale o cartao declarado na linha.
  const declaredCard = item?.linkedCardId && item.linkType !== LinkType.DEBIT
    ? allCards.find(c => c.id === item.linkedCardId)
    : null;
  if (declaredCard) {
    const l4 = extractLast4(declaredCard.description);
    return {
      key: `credit_${l4 ?? declaredCard.id}`,
      label: declaredCard.description || 'Cartão',
      isCredit: true,
      cardLast4: l4,
    };
  }
  return { key: 'debit', label: 'Débito / Pix', isCredit: false };
}
