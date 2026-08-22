import React, { useState, useEffect, useCallback } from 'react';
import { CategoryType, FinanceItem, PartialExpense } from '../types';
import type { BankTransaction } from '../lib/openfinance/types';
import { merchantKey } from '../lib/openfinance/categoryMap';
import ConectarBanco from './ConectarBanco';

/** Conexão bancária como a rota /api/of-connect devolve. */
interface BankConn {
  id: string;
  bankName: string;
  bankCode: string;
  displayName: string;
  consentStatus: string;
  lastSyncedAt: string | null;
  openFinanceLink: string | null;
  accountImportEnabled: boolean;
  cards: Array<{ last4: string; enabled: boolean }>;
  /** Primeiro nome do titular — no modo casal, diz de quem é a conexão. */
  ownerFirstName: string | null;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  householdId: string;
  authToken: string;
  items: FinanceItem[];
  currentYear: number;
  currentMonth: number; // 0-indexed
  /** Meses do plano — o teto de um item mora em `values[índice do mês aqui]` */
  months: Array<{ year: number; index: number }>;
  tetoAlert?: { enabled: boolean; pct: number };
  /** Ids já lançados pelo ExpenseSheet nesta sessão */
  categorizedIds?: string[];
  /** Abre direto no cartão com esses 4 dígitos (vindo do CTA de fatura no Plano). */
  initialCardLast4?: string;
  /**
   * Manda a transação para o MESMO fluxo do botão "Lançar".
   * O seletor próprio desta tela só listava itens que já existiam — não dava
   * para escrever "jardineiro". O ExpenseSheet já sabe criar item novo, então
   * reaproveitá-lo resolve sem inventar um segundo fluxo.
   */
  onLaunchExpense: (prefill: {
    knownPayMethod?: 'debit' | 'credit';
    knownCardLast4?: string | null;
    itemId: string;
    value: number;
    description: string;
    installments: number;
    isCredit: boolean;
    category?: CategoryType;
    purchaseDate: { day: number; month: number; year: number };
    ofTx: { transactionId: string; merchantKey: string };
  }) => void;
  onAddPartial: (itemId: string, expense: PartialExpense, year?: number, month?: number) => void;
  /** Cria um item no plano e devolve o id — usado pelo confirmar de um toque. */
  onCreateItem: (description: string, category: CategoryType, isOneTime?: boolean) => string;
  onClose: () => void;
}

// ─── Category display config ──────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  [CategoryType.INCOME]:           { label: 'Renda',    color: '#34c759', icon: 'fa-arrow-down'      },
  [CategoryType.FIXED_EXPENSE]:    { label: 'Fixa',     color: '#007aff', icon: 'fa-house'           },
  [CategoryType.VARIABLE_EXPENSE]: { label: 'Variável', color: '#ff9500', icon: 'fa-cart-shopping'   },
  [CategoryType.PERSONAL_LEISURE]: { label: 'Lazer',    color: '#af52de', icon: 'fa-star'            },
  [CategoryType.CREDIT_CARD]:      { label: 'Cartão',   color: '#ff3b30', icon: 'fa-credit-card'     },
};

function formatCurrencyBR(val: number) {
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateBR(iso: string) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

/**
 * Nome do arquivo de logo em /public/bancos.
 * Códigos COMPE se repetem (Bradesco e Next são ambos 237), então o nome
 * desempata quando bate; senão vale o código.
 */
const SLUG_BY_CODE: Record<string, string> = {
  '001': 'bb', '033': 'santander', '041': 'banrisul', '070': 'brb', '077': 'inter',
  '104': 'caixa', '136': 'unicred', '197': 'stone', '208': 'btg', '237': 'bradesco',
  '260': 'nubank', '290': 'pagbank', '301': 'recargapay', '318': 'bmg', '323': 'mercadopago',
  '335': 'digio', '336': 'c6', '341': 'itau', '348': 'xp', '380': 'picpay',
  '389': 'mercantil', '422': 'safra', '536': 'neon', '611': 'paulista', '623': 'pan',
  '637': 'sofisa', '655': 'bv', '724': 'portobank', '748': 'sicredi', '756': 'sicoob',
  '004': 'bnb',
};

/**
 * Pistas de nome por código do Open Finance.
 *
 * O código diz o TIPO do gasto ("ELECTRICITY"), mas o plano do cliente usa
 * nomes livres ("Luz", "CPFL", "Energia"). Isto liga um ao outro.
 * Deliberadamente incompleto: código sem pista aqui continua caindo na fila
 * para o cliente decidir, que é melhor do que adivinhar.
 */
const CODE_ITEM_HINTS: Record<string, RegExp> = {
  ELECTRICITY: /\b(luz|energia|eletric|cpfl|enel|edp|light|coelba|cemig|celpe)\b/,
  WATER: /\b(agua|saneamento|sabesp|cedae|copasa|sanepar|caesb)\b/,
  TELECOMMUNICATIONS: /\b(internet|telefone|celular|tv|banda larga|vivo|claro|tim|oi|net)\b/,
  TELECOM: /\b(internet|telefone|celular|tv|banda larga)\b/,
  INTERNET: /\b(internet|banda larga|wifi)\b/,
  GROCERIES: /\b(mercado|supermercado|feira|compras do mes|alimenta)\b/,
  EDUCATION: /\b(escola|faculdade|curso|educa|mensalidade|colegio)\b/,
  SCHOOL: /\b(escola|colegio|creche|mensalidade)\b/,
  INSURANCE: /\b(seguro|seguros)\b/,
  HEALTH: /\b(saude|plano de saude|medic|farmacia|remedio)\b/,
  MEDICALSERVICES: /\b(saude|medic|consulta|exame)\b/,
  RENT: /\b(aluguel|locacao)\b/,
  HOUSING: /\b(moradia|aluguel|condominio|casa)\b/,
  MORTGAGE: /\b(financiamento|prestacao|imovel)\b/,
  GASSTATIONS: /\b(gasolina|combustivel|posto|etanol)\b/,
  TRANSPORT: /\b(transporte|uber|onibus|metro|passagem)\b/,
  RESTAURANT: /\b(restaurante|almoco|jantar|ifood|delivery|comer)\b/,
  FOOD: /\b(alimenta|comida|refeicao)\b/,
  SUBSCRIPTION: /\b(assinatura|netflix|spotify|streaming)\b/,
  WELLNESSANDFITNESS: /\b(academia|pilates|crossfit|personal)\b/,
  BANKFEES: /\b(tarifa|banco|conta corrente)\b/,
  TAXES: /\b(imposto|iptu|ipva|tributo|taxa)\b/,
};

function normalizeName(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Item do plano para um gasto de nomenclatura óbvia.
 *
 * Só devolve quando há **exatamente um** candidato. Dois itens com "energia" no
 * nome é ambiguidade — e ambiguidade vira pergunta, não chute: o gasto fica na
 * fila em vez de entrar no lugar errado silenciosamente.
 */
function resolveItemByCode(
  ofCode: string | null,
  suggestedCategory: string | null,
  items: FinanceItem[],
): string | null {
  if (!ofCode || !suggestedCategory) return null;
  const hint = CODE_ITEM_HINTS[ofCode.toUpperCase()];
  if (!hint) return null;

  const matches = items.filter(
    (i) => i.category === suggestedCategory && hint.test(normalizeName(i.description || '')),
  );
  return matches.length === 1 ? matches[0].id : null;
}

function bankSlug(bankCode: string, bankName: string): string {
  const byName = bankName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  if (byName.includes('next')) return 'bradesco';
  return SLUG_BY_CODE[bankCode] ?? byName.replace(/[^a-z0-9]/g, '');
}

// ─── Inline category+item picker ──────────────────────────────────────────────

interface PickerProps {
  tx: BankTransaction;
  items: FinanceItem[];
  onConfirm: (itemId: string, category: CategoryType) => void;
  onIgnore: () => void;
  onClose: () => void;
}

function CategoryPicker({ tx, items, onConfirm, onIgnore, onClose }: PickerProps) {
  const [selectedCategory, setSelectedCategory] = useState<CategoryType | null>(
    tx.suggestedCategory as CategoryType | null
  );
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const availableCategories = Object.values(CategoryType).filter(
    (c) => c !== CategoryType.INCOME || tx.transactionType === 'income'
  );

  const itemsForCategory = selectedCategory
    ? items.filter((i) => i.category === selectedCategory)
    : [];

  // Auto-select first item when category changes
  useEffect(() => {
    if (itemsForCategory.length > 0) {
      setSelectedItemId(itemsForCategory[0].id);
    } else {
      setSelectedItemId(null);
    }
  }, [selectedCategory]);

  const canConfirm = selectedCategory !== null && (
    selectedCategory === CategoryType.INCOME ? true : selectedItemId !== null
  );

  function handleConfirm() {
    if (!selectedCategory) return;
    const itemId = selectedItemId ?? itemsForCategory[0]?.id ?? '';
    onConfirm(itemId, selectedCategory);
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-white rounded-t-2xl p-5 pb-8 shadow-2xl animate-slide-up">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs text-[#6e6e73] uppercase tracking-wide font-semibold">
              {tx.accountType === 'credit_card' ? 'Cartão' : 'Conta'} · {formatDateBR(tx.transactionDate)}
            </p>
            <p className="font-semibold text-[#1d1d1f] text-sm mt-0.5 leading-snug max-w-[260px]">
              {tx.merchant || tx.description}
            </p>
          </div>
          <span className={`font-black text-base ${tx.transactionType === 'income' ? 'text-[#34c759]' : 'text-[#1d1d1f]'}`}>
            {tx.transactionType === 'income' ? '+' : ''}{formatCurrencyBR(Number(tx.amount))}
          </span>
        </div>

        {/* Category chips */}
        <p className="text-xs font-semibold text-[#6e6e73] mb-2">CATEGORIA</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {availableCategories.map((cat) => {
            const cfg = CATEGORY_CONFIG[cat];
            const active = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all"
                style={{
                  borderColor: active ? cfg.color : '#e5e5ea',
                  background: active ? cfg.color + '18' : 'white',
                  color: active ? cfg.color : '#6e6e73',
                }}
              >
                <i className={`fas ${cfg.icon}`} />
                {cfg.label}
              </button>
            );
          })}
        </div>

        {/* Item selector */}
        {selectedCategory && selectedCategory !== CategoryType.INCOME && (
          <>
            <p className="text-xs font-semibold text-[#6e6e73] mb-2">ITEM DO PLANO</p>
            {itemsForCategory.length === 0 ? (
              <p className="text-xs text-[#aeaeb2] italic mb-4">
                Nenhum item nessa categoria. Crie primeiro no plano.
              </p>
            ) : (
              <div className="flex flex-col gap-1 max-h-32 overflow-y-auto mb-4">
                {itemsForCategory.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedItemId(item.id)}
                    className={`text-left px-3 py-2 rounded-xl text-sm transition-all border-2 ${
                      selectedItemId === item.id
                        ? 'border-[#7ab800] bg-[#f0fad0] text-[#1d1d1f] font-semibold'
                        : 'border-[#e5e5ea] text-[#3a3a3c]'
                    }`}
                  >
                    {item.description}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-1">
          <button
            onClick={onIgnore}
            className="flex-1 py-3 rounded-xl text-sm font-semibold text-[#aeaeb2] border-2 border-[#e5e5ea] transition-all"
          >
            Ignorar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="flex-2 flex-grow py-3 rounded-xl text-sm font-bold transition-all"
            style={{
              background: canConfirm ? '#7ab800' : '#e5e5ea',
              color: canConfirm ? 'white' : '#aeaeb2',
            }}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Transaction row ──────────────────────────────────────────────────────────

interface TxRowProps {
  tx: BankTransaction;
  onSelect: (tx: BankTransaction) => void;
  onDiscard: (tx: BankTransaction) => void;
  onConfirm: (tx: BankTransaction) => void;
}

const TxRow: React.FC<TxRowProps> = ({ tx, onSelect, onDiscard, onConfirm }) => {
  const isIncome = tx.transactionType === 'income';
  const suggested = tx.suggestedCategory ? CATEGORY_CONFIG[tx.suggestedCategory] : null;

  return (
    // <div> e não <button>: a lixeira é um botão dentro da linha, e botão
    // aninhado em botão é HTML inválido — o clique interno vazava para fora.
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(tx)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(tx); }}
      className="w-full flex items-center gap-3 px-4 py-3.5 text-left cursor-pointer hover:bg-[#f5f5f7] active:bg-[#ebebed] transition-colors border-b border-[#f0f0f0] last:border-0"
    >
      {/* Direction icon */}
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: isIncome ? '#34c75918' : '#ff950018' }}
      >
        <i
          className={`fas ${isIncome ? 'fa-arrow-down text-[#34c759]' : 'fa-arrow-up text-[#ff9500]'} text-sm`}
        />
      </div>

      {/* Description + meta */}
      <div className="flex-1 min-w-0">
        {/* O nome de quem recebeu vem primeiro: "Edp São Paulo" é reconhecível,
            "PIX QR CODE DINAMICO - DES: EDP SP" não. A descrição do banco fica
            embaixo, menor, para quem precisar conferir a origem. */}
        <p className="text-[#1d1d1f] text-sm font-semibold truncate leading-snug">
          {tx.merchant || tx.description}
        </p>
        {tx.merchant && tx.description && (
          <p className="text-[10px] text-[#c7c7cc] truncate leading-tight">{tx.description}</p>
        )}
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className="text-xs text-[#aeaeb2]">{formatDateBR(tx.transactionDate)}</span>
          {tx.installmentCurrent && tx.installmentTotal && (
            <span className="text-xs text-[#aeaeb2]">
              · {tx.installmentCurrent}/{tx.installmentTotal}x
            </span>
          )}
          {/* A categoria vira BOTAO: tocar nela abre o fluxo para trocar, sem
              precisar adivinhar que o toque na linha faz isso. O visto ao lado
              confirma; a etiqueta corrige. */}
          {suggested ? (
            <button
              onClick={(e) => { e.stopPropagation(); onSelect(tx); }}
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-1 active:opacity-70"
              style={{ background: suggested.color + '18', color: suggested.color }}
            >
              {suggested.label}
              <i className="fas fa-pen text-[7px] opacity-60" />
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onSelect(tx); }}
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#f2f2f7] text-[#8e8e93] active:opacity-70"
            >
              escolher categoria
            </button>
          )}
          {tx.accountType === 'credit_card' && tx.cardLast4 && (
            <span className="text-[10px] text-[#aeaeb2]">···{tx.cardLast4}</span>
          )}
        </div>
      </div>

      {/* Amount */}
      <span className={`font-black text-sm flex-shrink-0 ${isIncome ? 'text-[#34c759]' : 'text-[#1d1d1f]'}`}>
        {isIncome ? '+' : ''}{formatCurrencyBR(Number(tx.amount))}
      </span>

      {/* Confirmar num toque: a sugestao ja esta certa na maioria das vezes,
          e obrigar a abrir o fluxo inteiro para dizer "sim" era a friccao. */}
      {tx.suggestedCategory && (
        <button
          onClick={(e) => { e.stopPropagation(); onConfirm(tx); }}
          aria-label="Confirmar nesta categoria"
          title="Confirmar nesta categoria"
          className="flex-shrink-0 w-9 h-9 rounded-full bg-[#e8f5d0] text-[#5a8c00] flex items-center justify-center active:scale-90 transition-transform"
        >
          <i className="fas fa-check text-xs" />
        </button>
      )}

      <button
        onClick={(e) => { e.stopPropagation(); onDiscard(tx); }}
        aria-label="Descartar transação"
        className="flex-shrink-0 w-8 h-8 -mr-1 flex items-center justify-center text-[#d1d1d6] hover:text-[#ff3b30] transition-colors"
      >
        <i className="fas fa-trash-can text-xs" />
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ExtratoBancario({
  householdId,
  authToken,
  items,
  currentYear,
  currentMonth,
  months,
  tetoAlert,
  categorizedIds,
  initialCardLast4,
  onLaunchExpense,
  onAddPartial,
  onCreateItem,
  onClose,
}: Props) {
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTx, setActiveTx] = useState<BankTransaction | null>(null);
  const [filter, setFilter] = useState<'all' | 'expense' | 'income'>('all');
  /**
   * Banco escolhido. `null` = tela inicial com a lista de bancos.
   * Com um banco só isso seria uma parada boba, então pulamos direto para o
   * extrato dele; a partir de dois, a lista aparece.
   */
  /**
   * O que esta aberto: uma FORMA DE PAGAMENTO especifica, nao um banco.
   * `null` = tela inicial. Antes o filtro era so por conexao, e ao entrar o
   * cliente via conta e cartao misturados sem saber o que era o que.
   */
  const [aberto, setAberto] = useState<{ connId: string; kind: 'checking' | 'card'; last4?: string } | null>(null);
  /** Modal de conectar banco, agora aberto de dentro do Extrato */
  const [showConectar, setShowConectar] = useState(false);
  /** Conexão cujo cartão está sendo ligado/desligado */
  const [togglingCard, setTogglingCard] = useState('');
  const [cardError, setCardError] = useState('');

  /**
   * Liga ou desliga a importação da fatura daquele banco.
   *
   * Existe porque o consentimento do Open Finance cobre conta e cartão juntos —
   * o banco não pergunta. Sem este controle, quem já lançava a fatura à mão
   * veria tudo entrar duplicado sem ter pedido.
   */
  async function toggleImport(conn: BankConn, target: { card?: string } = {}) {
    const key = target.card ? `${conn.id}:${target.card}` : conn.id;
    setTogglingCard(key);
    setCardError('');

    const isCard = !!target.card;
    const current = isCard
      ? (conn.cards.find((c) => c.last4 === target.card)?.enabled ?? true)
      : conn.accountImportEnabled;

    try {
      const res = await fetch('/api/of-connect', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          householdId,
          connectionId: conn.id,
          ...(isCard ? { cardImport: !current, cardLast4: target.card } : { accountImport: !current }),
        }),
      });
      // O Vercel devolve HTML em alguns erros — ler texto antes de parsear
      // evita o "Unexpected token <" no lugar da mensagem real.
      const text = await res.text();
      let data: { cards?: Array<{ last4: string; enabled: boolean }>; error?: string } = {};
      try { data = JSON.parse(text); } catch { /* resposta não-JSON */ }
      if (!res.ok) throw new Error(data.error || 'Não foi possível alterar agora.');

      setBanks((prev) => prev.map((b) => {
        if (b.id !== conn.id) return b;
        return isCard
          ? { ...b, cards: data.cards ?? b.cards.map((c) => (c.last4 === target.card ? { ...c, enabled: !current } : c)) }
          : { ...b, accountImportEnabled: !current };
      }));
    } catch (err: unknown) {
      setCardError(err instanceof Error ? err.message : 'Não foi possível alterar agora.');
    } finally {
      setTogglingCard('');
    }
  }

  /** Chavinha reutilizada pela conta e por cada cartão. */
  function ImportToggle({ on, busy, onClick, label }: { on: boolean; busy: boolean; onClick: () => void; label: string }) {
    return (
      <button
        onClick={onClick}
        disabled={busy}
        aria-label={label}
        className={`flex-shrink-0 w-11 h-6 rounded-full transition-colors relative disabled:opacity-50 ${on ? 'bg-[#7ab800]' : 'bg-[#d1d1d6]'}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    );
  }
  const [tetoHit, setTetoHit] = useState<{ name: string; pct: number; teto: number; spent: number } | null>(null);
  /** Transação que o cliente pediu para descartar — aguardando confirmação */
  const [pendingDiscard, setPendingDiscard] = useState<BankTransaction | null>(null);
  /** Possível duplicata de um lançamento manual — aguardando decisão */
  const [duplicate, setDuplicate] = useState<{ tx: BankTransaction; itemName: string; existing: PartialExpense } | null>(null);

  // Some da lista o que já foi lançado pelo ExpenseSheet nesta sessão.
  useEffect(() => {
    if (!categorizedIds?.length) return;
    setTransactions((prev) => prev.filter((t) => !categorizedIds.includes(t.transactionId)));
  }, [categorizedIds]);

  /**
   * Procura um lançamento manual que pareça ser esta mesma despesa.
   *
   * O caso real: a conta de luz foi lançada à mão e depois chegou de novo pelo
   * extrato — o teto passou a mostrar R$ 236 onde deveria ser R$ 91. Como o
   * lançamento manual não guarda o id da transação, o casamento é por
   * semelhança: mesmo valor (1 centavo de folga) e até 4 dias de diferença,
   * porque a data que o banco informa é a de LANÇAMENTO, não a da compra.
   */
  function findManualDuplicate(tx: BankTransaction): { itemName: string; expense: PartialExpense } | null {
    const dateStr = tx.billDueDate ?? tx.transactionDate;
    const [y, m] = dateStr.split('-').map(Number);
    const monthKey = `${y}-${m - 1}`;
    const txTime = new Date(tx.transactionDate).getTime();
    const value = Number(tx.amount);

    for (const item of items) {
      for (const p of item.partialExpenses?.[monthKey] ?? []) {
        if (Math.abs(p.value - value) > 0.01) continue;
        const diffDays = Math.abs(new Date(p.date).getTime() - txTime) / 86_400_000;
        if (diffDays <= 4) return { itemName: item.description || 'um item do plano', expense: p };
      }
    }
    return null;
  }

  /**
   * Confirma a sugestao num toque, sem abrir fluxo nenhum.
   *
   * O item de destino sai de uma cascata: o que o cliente ja ensinou para
   * aquele estabelecimento, depois o casamento por nome do codigo, e por
   * ultimo um item novo com o nome do estabelecimento. A ultima opcao e o que
   * torna o toque unico possivel — sem ela, "confirmar" ainda exigiria escolher
   * um item, que era exatamente a friccao reclamada.
   */
  function confirmarRapido(tx: BankTransaction) {
    const categoria = tx.suggestedCategory as CategoryType | null;
    if (!categoria) return;

    const nome = tx.merchant || tx.description || 'Gasto';
    // Para PERSONAL_LEISURE há sempre UMA única linha — nunca criar nova.
    const leisureItemId = categoria === CategoryType.PERSONAL_LEISURE
      ? items.find(i => i.category === CategoryType.PERSONAL_LEISURE)?.id
      : undefined;

    const itemId = tx.suggestedItemId && items.some((i) => i.id === tx.suggestedItemId)
      ? tx.suggestedItemId
      : resolveItemByCode(tx.ofCode, tx.suggestedCategory, items)
        ?? leisureItemId
        ?? onCreateItem(nome, categoria, false);

    const dateStr = tx.billDueDate ?? tx.transactionDate;
    const [y, rawM] = dateStr.split('-').map(Number);
    const origem = tx.accountType === 'credit_card' ? 'credit' as const : 'debit' as const;

    // Parcelamento: a compra 3/10 ainda tem 7 parcelas por vir, e cada uma
    // consome o teto do SEU mes. Sem espalhar, o cliente veria o teto de Lazer
    // livre em novembro quando na verdade ja esta comprometido — e teria de
    // categorizar a mesma compra de novo a cada fatura.
    const total = tx.installmentTotal ?? 1;
    const atual = tx.installmentCurrent ?? 1;
    const aLancar = total > 1 ? total - atual + 1 : 1;

    const primeiro = crypto.randomUUID();
    for (let k = 0; k < aLancar; k++) {
      const abs = (y * 12) + (rawM - 1) + k;
      const partial: PartialExpense = {
        id: k === 0 ? primeiro : crypto.randomUUID(),
        date: tx.transactionDate,
        description: total > 1 ? `${nome} ${atual + k}/${total}` : nome,
        value: Number(tx.amount),
        paymentSource: origem,
        cardLast4: tx.cardLast4 ?? aberto?.last4 ?? undefined,
      };
      onAddPartial(itemId, partial, Math.floor(abs / 12), abs % 12);
    }
    const partial = { id: primeiro };
    setTransactions((prev) => prev.filter((t) => t.transactionId !== tx.transactionId));

    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` };
    fetch('/api/of-transactions', {
      method: 'PATCH', headers: auth,
      body: JSON.stringify({ householdId, transactionId: tx.transactionId, action: 'categorize', itemId, category: categoria, partialId: partial.id }),
    }).catch(() => {});

    const key = merchantKey(tx.merchant ?? tx.description ?? '');
    if (key) {
      fetch('/api/of-merchant-memory', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ householdId, merchantKey: key, category: categoria, itemId }),
      }).catch(() => {});
    }
  }

  /** Abre o fluxo de lançamento com os dados da transação já preenchidos. */
  function openLaunch(tx: BankTransaction) {
    const dup = findManualDuplicate(tx);
    if (dup) { setDuplicate({ tx, itemName: dup.itemName, existing: dup.expense }); return; }
    proceedToLaunch(tx);
  }

  function proceedToLaunch(tx: BankTransaction) {
    const dateStr = tx.billDueDate ?? tx.transactionDate;
    const [y, rawM, rawD] = dateStr.split('-').map(Number);
    onLaunchExpense({
      itemId: '',
      value: Number(tx.amount),
      description: tx.merchant || tx.description || '',
      installments: tx.installmentTotal ?? 1,
      isCredit: tx.accountType === 'credit_card',
      // O extrato sabe como foi pago — o ExpenseSheet nao pergunta de novo.
      knownPayMethod: tx.accountType === 'credit_card' ? 'credit' as const : 'debit' as const,
      knownCardLast4: tx.cardLast4 ?? aberto?.last4 ?? null,
      category: (tx.suggestedCategory as CategoryType) ?? undefined,
      purchaseDate: { day: rawD || 1, month: (rawM || 1) - 1, year: y },
      ofTx: { transactionId: tx.transactionId, merchantKey: merchantKey(tx.merchant ?? tx.description ?? '') },
    });
  }

  // ── Load pending transactions ──────────────────────────────────────────────

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ householdId, status: 'pending', limit: '200' });
      const r = await fetch(`/api/of-transactions?${params}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const json = await r.json();
      setTransactions(json.transactions ?? []);
    } catch {
      // Silently degrade — user sees empty list
    } finally {
      setLoading(false);
    }
  }, [householdId, authToken]);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  /** Quantos lançamentos entraram sozinhos nesta abertura da tela. */
  const [autoFiled, setAutoFiled] = useState(0);

  /**
   * Lançamento automático pela memória.
   *
   * Só entra sozinho o que o CLIENTE já categorizou antes (`confidence
   * 'memory'`) e cujo item ainda existe no plano. Palpite nosso continua
   * perguntando — errar sozinho em heurística seria mexer no dinheiro dele sem
   * ele ter dito nada. Onde corrigir, se errar: Gastos → toque no lançamento →
   * Editar, que agora troca de categoria.
   */
  useEffect(() => {
    // Duas origens confiáveis o bastante para entrar sozinhas:
    //   1. memória — o cliente já categorizou este estabelecimento antes
    //   2. nomenclatura óbvia — o código do banco casa com UM item do plano
    // Qualquer outra coisa continua na fila esperando decisão dele.
    const resolved = transactions
      .map((t) => {
        const fromMemory = t.suggestionConfidence === 'memory' && t.suggestedItemId
          && items.some((i) => i.id === t.suggestedItemId)
          ? t.suggestedItemId
          : null;
        const itemId = fromMemory ?? resolveItemByCode(t.ofCode, t.suggestedCategory, items);
        return itemId ? { tx: t, itemId } : null;
      })
      .filter((x): x is { tx: BankTransaction; itemId: string } => x !== null);

    if (resolved.length === 0) return;
    const ready = resolved.map((r) => r.tx);
    const itemById = new Map<string, string>(
      resolved.map((r) => [r.tx.transactionId, r.itemId] as [string, string]),
    );

    for (const tx of ready) {
      const dateStr = tx.billDueDate ?? tx.transactionDate;
      const [y, rawM] = dateStr.split('-').map(Number);
      const partial: PartialExpense = {
        id: crypto.randomUUID(),
        date: tx.transactionDate,
        description: tx.merchant || tx.description || '',
        value: Number(tx.amount),
        // O extrato sabe a origem: cartão vai para a fatura, conta já saiu.
        paymentSource: tx.accountType === 'credit_card' ? 'credit' : 'debit',
        cardLast4: tx.cardLast4 ?? undefined,
      };
      const itemId = itemById.get(tx.transactionId)!;
      onAddPartial(itemId, partial, y, rawM - 1);

      fetch('/api/of-transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          householdId, transactionId: tx.transactionId, action: 'categorize',
          itemId, category: tx.suggestedCategory, partialId: partial.id,
        }),
      }).catch(() => { /* não crítico */ });
    }

    const ids = new Set(ready.map((t) => t.transactionId));
    setTransactions((prev) => prev.filter((t) => !ids.has(t.transactionId)));
    setAutoFiled((n) => n + ready.length);
  }, [transactions, items, householdId, authToken, onAddPartial]);

  // Bancos conectados — a transação guarda só o connectionId, o nome e o
  // código COMPE (para a logo) vêm daqui.
  const [banks, setBanks] = useState<BankConn[]>([]);
  const [banksLoaded, setBanksLoaded] = useState(false);
  const loadBanks = useCallback(() => {
    fetch(`/api/of-connect?householdId=${householdId}`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.connections) setBanks(d.connections); })
      .catch(() => { /* sem lista: cai no extrato único */ })
      .finally(() => setBanksLoaded(true));
  }, [householdId, authToken]);
  useEffect(() => { loadBanks(); }, [loadBanks]);

  // Quando vem do CTA de fatura no Plano, pula direto para o cartão correto.
  useEffect(() => {
    if (!initialCardLast4 || !banksLoaded || banks.length === 0) return;
    for (const bank of banks) {
      if (bank.cards?.some(c => c.last4 === initialCardLast4)) {
        setAberto({ connId: bank.id, kind: 'card', last4: initialCardLast4 });
        return;
      }
    }
  }, [initialCardLast4, banksLoaded, banks]);

  /** Quantas transações pendentes por conexão. */
  /** Chave de uma forma de pagamento, usada para contar e para filtrar. */
  const chaveDe = (connId: string, kind: 'checking' | 'card', last4?: string) =>
    `${connId}|${kind}|${last4 ?? ''}`;

  /** Uma transacao pertence a conta corrente ou a um cartao especifico. */
  const chaveDaTx = (t: BankTransaction) =>
    t.accountType === 'credit_card'
      ? chaveDe(t.connectionId ?? '', 'card', t.cardLast4 ?? undefined)
      : chaveDe(t.connectionId ?? '', 'checking');

  const countByKey = transactions.reduce<Record<string, number>>((acc, t) => {
    const k = chaveDaTx(t);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  // A lista de bancos é a porta de entrada do Extrato — inclusive com zero ou
  // um banco, porque é onde mora o botão de conectar. Antes isso vivia em
  // Configurações → Gerenciar bancos, dois níveis longe de onde faz sentido.
  const showBankPicker = aberto === null;

  /** Texto de estado por conexão — evita dizer "nada a categorizar" para banco
   *  que sequer autorizou, que era leitura errada do que está acontecendo. */
  function bankSubtitle(b: BankConn, pending: number): string {
    if (b.consentStatus === 'pending_authorization') return 'Aguardando você autorizar no banco';
    if (b.consentStatus === 'authorized_fetching') return 'Buscando seus dados no banco';
    if (b.consentStatus === 'failed') return 'A autorização falhou no banco — tente de novo';
    if (b.consentStatus === 'expired') return 'Autorização expirada — reconecte';
    if (b.consentStatus === 'revoked') return 'Desconectado';
    if (!b.lastSyncedAt) return 'Conectado — ainda não sincronizou';
    if (pending === 0) return 'Tudo categorizado';
    return `${pending} transaç${pending === 1 ? 'ão' : 'ões'} a categorizar`;
  }

  // ── Categorize ─────────────────────────────────────────────────────────────

  async function handleConfirm(tx: BankTransaction, itemId: string, category: CategoryType) {
    // CC: land in the bill due month; account: use transaction date
    const dateStr = tx.billDueDate ?? tx.transactionDate;
    const [year, rawMonth] = dateStr.split('-').map(Number);
    const month = rawMonth - 1; // 0-indexed

    const partial: PartialExpense = {
      id: crypto.randomUUID(),
      date: tx.transactionDate,
      description: tx.description ?? '',
      value: Number(tx.amount),
      paymentSource: tx.accountType === 'credit_card' ? 'credit' : 'debit',
      cardLast4: tx.cardLast4 ?? aberto?.last4 ?? undefined,
    };

    // Alerta de teto — o lançamento manual já avisava, mas o que vem do banco
    // não avisava nada. Era o furo central do fluxo: o Open Finance lança
    // sozinho, então é justamente aqui que o cliente precisa ser avisado.
    // Mesma conta do TetoGastos: o teto do item mora em values[índice do mês].
    if (tetoAlert?.enabled) {
      const slot = months.findIndex((m) => m.year === year && m.index === month);
      const item = items.find((i) => i.id === itemId);
      const teto = slot >= 0 ? (item?.values?.[slot] || 0) : 0;
      if (item && teto > 0) {
        const before = (item.partialExpenses?.[`${year}-${month}`] ?? []).reduce((a, p) => a + p.value, 0);
        const after = before + partial.value;
        const limit = teto * (tetoAlert.pct / 100);
        // Só quando ESTE lançamento cruza a linha — não repete nos seguintes.
        if (after >= limit && before < limit) {
          setTetoHit({ name: item.description || 'este gasto', pct: Math.round((after / teto) * 100), teto, spent: after });
        }
      }
    }

    // 1. Update local state instantly
    onAddPartial(itemId, partial, year, month);
    setActiveTx(null);
    setTransactions((prev) => prev.filter((t) => t.transactionId !== tx.transactionId));

    // 2. Mark as categorized in DB (fire-and-forget)
    fetch('/api/of-transactions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        householdId,
        transactionId: tx.transactionId,
        action: 'categorize',
        itemId,
        category,
        partialId: partial.id,
      }),
    }).catch(() => {/* non-critical */});

    // 3. Update merchant memory (fire-and-forget)
    // Mesma fonte que o cron usa para LER (merchant primeiro, descrição como
    // reserva). Chaves diferentes entre gravar e ler = memória que nunca acerta.
    const key = merchantKey(tx.merchant ?? tx.description ?? '');
    if (key) {
      fetch('/api/of-merchant-memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ householdId, merchantKey: key, category, itemId }),
      }).catch(() => {/* non-critical */});
    }
  }

  async function handleIgnore(tx: BankTransaction) {
    setActiveTx(null);
    setTransactions((prev) => prev.filter((t) => t.transactionId !== tx.transactionId));
    try {
      const r = await fetch('/api/of-transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ householdId, transactionId: tx.transactionId, action: 'ignore' }),
      });
      if (!r.ok) {
        // PATCH falhou: devolve a transação para a lista para não sumir silenciosamente
        setTransactions((prev) => [...prev, tx].sort((a, b) => b.transactionDate.localeCompare(a.transactionDate)));
      }
    } catch {
      setTransactions((prev) => [...prev, tx].sort((a, b) => b.transactionDate.localeCompare(a.transactionDate)));
    }
  }

  // ── Filter + sort ──────────────────────────────────────────────────────────

  // Pendentes do banco escolhido (ou de todos, quando só há um conectado)
  // Filtra pela forma de pagamento aberta: conta corrente OU um cartao.
  const inBank = transactions.filter((t) => {
    if (!aberto) return true;
    if (t.connectionId !== aberto.connId) return false;
    if (aberto.kind === 'checking') return t.accountType !== 'credit_card';
    // Cartao: casa pelos 4 digitos; transacao sem digito fica no primeiro.
    return t.accountType === 'credit_card' && (!t.cardLast4 || t.cardLast4 === aberto.last4);
  });

  const displayed = inBank
    .filter((t) => filter === 'all' || t.transactionType === filter)
    .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));

  const expenseCount = inBank.filter((t) => t.transactionType === 'expense').length;
  const incomeCount = inBank.filter((t) => t.transactionType === 'income').length;
  const totalExpense = transactions
    .filter((t) => t.transactionType === 'expense')
    .reduce((s, t) => s + Number(t.amount), 0);

  // ── Render ─────────────────────────────────────────────────────────────────

  // z-[60] e não z-40: o header do app é sticky z-50 e ficava POR CIMA,
  // cortando os totais do topo desta tela. safe-top livra o notch.
  // ─── Tela inicial: escolher o banco ────────────────────────────────────────
  if (showBankPicker) {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col bg-[#f2f2f7]">
        <div className="bg-white border-b border-[#e5e5ea] px-4 safe-top pt-2 pb-3 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-black text-[#1d1d1f]">Extrato bancário</h2>
            <p className="text-xs text-[#6e6e73]">Escolha o banco para categorizar</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-[#e5e5ea] flex items-center justify-center">
            <i className="fas fa-xmark text-[#1d1d1f] text-sm" />
          </button>
        </div>

        {showConectar && (
          <ConectarBanco
            householdId={householdId}
            onClose={() => { setShowConectar(false); loadBanks(); }}
          />
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {!banksLoaded ? (
            <div className="text-center py-12 text-[#8e8e93]">
              <i className="fas fa-circle-notch animate-spin text-xl mb-2 block" />
              <span className="text-sm">Carregando…</span>
            </div>
          ) : banks.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center">
              <div className="text-5xl mb-3">🏦</div>
              <p className="font-bold text-[#1d1d1f] mb-1">Nenhum banco conectado</p>
              <p className="text-sm text-[#6e6e73]">
                Conecte seu banco e pare de digitar cada gasto.
              </p>
            </div>
          ) : (
            banks.map((b) => {
              const ready = b.consentStatus === 'active';
              const pendentesNoBanco = transactions.filter((t) => t.connectionId === b.id).length;

              /** Uma linha por forma de pagamento: liga/desliga + pendentes + entrar. */
              const LinhaMetodo: React.FC<{
                icone: string; rotulo: React.ReactNode; ligado: boolean; chave: string;
                onToggle: () => void | Promise<void>; kind: 'checking' | 'card'; last4?: string;
              }> = ({ icone, rotulo, ligado, chave, onToggle, kind, last4 }) => {
                const n = countByKey[chaveDe(b.id, kind, last4)] ?? 0;
                return (
                  <div className="flex items-center gap-2 px-4 py-2.5 border-t border-[#f0f0f0]">
                    <i className={`fas ${icone} text-[#8e8e93] text-xs w-4 text-center flex-shrink-0`} />
                    {/* Entrar no extrato DESTA forma de pagamento. Antes tudo caia
                        num extrato so e o cliente nao sabia se via conta ou cartao. */}
                    <button
                      onClick={() => ready && setAberto({ connId: b.id, kind, last4 })}
                      disabled={!ready}
                      className="flex-1 min-w-0 text-left disabled:opacity-60"
                    >
                      <span className="text-[13px] text-[#1d1d1f] font-semibold">{rotulo}</span>
                      <span className="block text-[11px] text-[#8e8e93]">
                        {!ligado ? 'Importação desligada'
                          : n === 0 ? 'Nada a categorizar'
                          : `${n} a categorizar`}
                      </span>
                    </button>
                    {n > 0 && (
                      <span className="flex-shrink-0 min-w-[22px] h-5 px-1.5 rounded-full bg-[#ff9500] text-white text-[11px] font-black flex items-center justify-center">
                        {n}
                      </span>
                    )}
                    {ready && <i className="fas fa-chevron-right text-[#c7c7cc] text-[10px] flex-shrink-0" />}
                    <ImportToggle on={ligado} busy={togglingCard === chave} onClick={onToggle} label={`Importar ${rotulo}`} />
                  </div>
                );
              };

              return (
                <div key={b.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  {/* Cabecalho: so o BANCO. Antes repetia "Bradesco · Conta
                      Corrente" e logo abaixo vinha "Conta corrente" de novo. */}
                  <div className="px-4 py-3 flex items-center gap-3">
                    <img
                      src={`/bancos/${bankSlug(b.bankCode, b.bankName)}.png`}
                      alt=""
                      className="w-10 h-10 rounded-xl object-contain bg-[#f2f2f7] p-1 flex-shrink-0"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-[#1d1d1f] text-[15px] truncate">
                        {b.bankName}
                        {b.ownerFirstName && banks.length > 1 && (
                          <span className="text-[#8e8e93] font-semibold text-sm"> · {b.ownerFirstName}</span>
                        )}
                      </p>
                      {!ready && (
                        <p className="text-xs text-[#8e8e93] truncate">{bankSubtitle(b, pendentesNoBanco)}</p>
                      )}
                      {(b.consentStatus === 'pending_authorization' || b.consentStatus === 'failed') && b.openFinanceLink && (
                        <a
                          href={b.openFinanceLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-[#ff9500] font-bold inline-block"
                        >
                          Retomar autorização →
                        </a>
                      )}
                    </div>
                  </div>

                  {ready && (
                    <>
                      <LinhaMetodo
                        icone="fa-building-columns"
                        rotulo="Conta corrente"
                        ligado={b.accountImportEnabled}
                        chave={b.id}
                        onToggle={() => toggleImport(b)}
                        kind="checking"
                      />
                      {b.cards.map((card) => (
                        <LinhaMetodo
                          key={card.last4}
                          icone="fa-credit-card"
                          rotulo={<>Cartão <span className="text-[#8e8e93]">••{card.last4}</span></>}
                          ligado={card.enabled}
                          chave={`${b.id}:${card.last4}`}
                          onToggle={() => toggleImport(b, { card: card.last4 })}
                          kind="card"
                          last4={card.last4}
                        />
                      ))}
                      {b.cards.length === 0 && (
                        <p className="border-t border-[#f0f0f0] px-4 py-2.5 text-[11px] text-[#aeaeb2] italic">
                          Nenhum cartão encontrado nesta conta.
                        </p>
                      )}
                    </>
                  )}
                </div>
              );
            })
          )}

          {cardError && (
            <p className="text-[11px] text-[#ff3b30] px-2">{cardError}</p>
          )}

          {/* Conectar banco mora AQUI agora, não em Configurações */}
          {banksLoaded && (
            <>
              <button
                onClick={() => setShowConectar(true)}
                className="w-full mt-1 py-3.5 rounded-2xl border-2 border-dashed border-[#c7c7cc] text-[#6e6e73] font-bold text-sm active:bg-[#ebebed] transition-colors"
              >
                <i className="fas fa-plus mr-2" />
                {banks.length === 0 ? 'Conectar meu banco' : 'Conectar outro banco'}
              </button>

              <p className="text-[11px] text-[#8e8e93] leading-relaxed text-center px-4 pt-1 pb-4">
                Seu banco leva um tempo para liberar as movimentações — não é na hora da compra.
                Assim que chegarem, a gente te avisa. Pode fechar o app tranquilo.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#f2f2f7]">
      {/* Header */}
      <div className="bg-white border-b border-[#e5e5ea] px-4 safe-top pt-2 pb-2 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => { setAberto(null); setFilter('all'); }}
              aria-label="Voltar para a lista de contas e cartões"
              className="w-8 h-8 rounded-full bg-[#e5e5ea] flex items-center justify-center flex-shrink-0"
            >
              <i className="fas fa-chevron-left text-[#1d1d1f] text-xs" />
            </button>
          <div className="min-w-0">
            {/* O titulo diz EXATAMENTE o que esta na tela: conta corrente ou
                qual cartao. Sem isso o cliente nao sabia o que estava vendo. */}
            <h2 className="text-lg font-black text-[#1d1d1f] truncate leading-tight">
              {banks.find((b) => b.id === aberto?.connId)?.bankName ?? 'Extrato'}
            </h2>
            <p className="text-[13px] font-bold text-[#6e6e73] leading-tight">
              {aberto?.kind === 'card' ? `Cartão ••${aberto.last4}` : 'Conta corrente'}
            </p>
            {inBank.length === 0 ? (
              <p className="text-xs text-[#6e6e73]">Sem pendências</p>
            ) : (
              <p className="text-sm font-black text-[#ff9500] leading-tight">
                {inBank.length} transaç{inBank.length === 1 ? 'ão' : 'ões'}
                <span className="text-[#6e6e73] font-semibold"> a categorizar</span>
              </p>
            )}
          </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#e5e5ea] flex items-center justify-center"
          >
            <i className="fas fa-xmark text-[#1d1d1f] text-sm" />
          </button>
        </div>

        {/* Summary pills */}
        {inBank.length > 0 && (
          <div className="flex gap-2 mb-3">
            <div className="flex-1 bg-[#ff950012] rounded-xl px-3 py-2 text-center">
              <p className="text-[10px] font-bold text-[#ff9500] uppercase">Despesas</p>
              <p className="text-sm font-black text-[#1d1d1f]">{formatCurrencyBR(totalExpense)}</p>
              <p className="text-[10px] text-[#aeaeb2]">{expenseCount} itens</p>
            </div>
            {incomeCount > 0 && (
              <div className="flex-1 bg-[#34c75912] rounded-xl px-3 py-2 text-center">
                <p className="text-[10px] font-bold text-[#34c759] uppercase">Receitas</p>
                <p className="text-sm font-black text-[#1d1d1f]">{incomeCount}</p>
                <p className="text-[10px] text-[#aeaeb2]">itens</p>
              </div>
            )}
          </div>
        )}

        {/* Filter tabs */}
        {inBank.length > 0 && (
          <div className="flex gap-1 bg-[#f2f2f7] rounded-xl p-1">
            {(['all', 'expense', 'income'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  filter === f ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#6e6e73]'
                }`}
              >
                {f === 'all' ? 'Todos' : f === 'expense' ? 'Despesas' : 'Receitas'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Transaction list */}
      <div className="flex-1 overflow-y-auto">
        {autoFiled > 0 && (
          <div className="mx-2 mt-2 bg-[#f0fad0] border border-[#d4e8a0] rounded-2xl px-4 py-3 flex items-start gap-2.5">
            <i className="fas fa-wand-magic-sparkles text-[#7ab800] text-sm mt-0.5" />
            <p className="text-[#3a3a3c] text-xs leading-relaxed">
              <strong className="text-[#1d1d1f]">
                {autoFiled} lançamento{autoFiled === 1 ? '' : 's'} entrou{autoFiled === 1 ? '' : 'ram'} sozinho{autoFiled === 1 ? '' : 's'}
              </strong>{' '}
              — ou você já categorizou aquele lugar antes, ou o nome era claro (luz, mercado, escola).
              {' '}
              <button
                onClick={onClose}
                className="underline font-bold text-[#5a8c00]"
              >
                Confira em Gastos
              </button>{' '}
              e, se algo foi parar no lugar errado, toque no lançamento e use <strong>Editar</strong> para
              trocar a categoria.
            </p>
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <i className="fas fa-circle-notch fa-spin text-[#7ab800] text-2xl" />
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-60 gap-3 px-8 text-center">
            <i className={`fas ${transactions.length === 0 ? 'fa-clock' : 'fa-check-circle'} text-[#7ab800] text-4xl`} />
            <p className="font-bold text-[#1d1d1f]">
              {transactions.length === 0
                ? 'Nenhuma transação a categorizar'
                : 'Nenhuma transação nesse filtro'}
            </p>
            <p className="text-sm text-[#6e6e73]">
              {transactions.length === 0
                ? 'Quando o banco liberar os dados (pode levar até 24h), as transações aparecerão aqui.'
                : 'Tente mudar o filtro acima.'}
            </p>
          </div>
        ) : (
          <div className="bg-white mt-2 mx-2 rounded-2xl overflow-hidden shadow-sm">
            {displayed.map((tx) => (
              <TxRow key={tx.transactionId} tx={tx} onSelect={openLaunch} onDiscard={setPendingDiscard} onConfirm={confirmarRapido} />
            ))}
          </div>
        )}

        {/* Bottom padding for safe area */}
        <div className="h-8" />
      </div>

      {/* Possível duplicata: já existe lançamento manual igual neste mês */}
      {duplicate && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-6" onClick={() => setDuplicate(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-4xl mb-3 text-center">🔁</div>
            <p className="font-black text-[#1d1d1f] text-lg mb-2 text-center">Parece que você já lançou</p>
            <p className="text-sm text-[#3a3a3c] leading-relaxed mb-4">
              Já existe <span className="font-bold">{formatCurrencyBR(duplicate.existing.value)}</span> em{' '}
              <span className="font-bold">{duplicate.itemName}</span> em {formatDateBR(duplicate.existing.date)}
              {duplicate.existing.description ? ` (“${duplicate.existing.description}”)` : ''}.
              É o mesmo gasto que chegou agora do banco?
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { handleIgnore(duplicate.tx); setDuplicate(null); }}
                className="w-full py-3 rounded-xl text-sm font-bold text-white bg-[#7ab800]"
              >
                É o mesmo — manter só o que já lancei
              </button>
              <button
                onClick={() => { const tx = duplicate.tx; setDuplicate(null); proceedToLaunch(tx); }}
                className="w-full py-3 rounded-xl text-sm font-semibold text-[#3a3a3c] border-2 border-[#e5e5ea]"
              >
                São gastos diferentes — lançar assim mesmo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmação antes de descartar — é irreversível: o protocolo do
          extrato não pode ser pedido de novo dentro da janela de 6h. */}
      {pendingDiscard && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-6" onClick={() => setPendingDiscard(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="font-black text-[#1d1d1f] text-lg mb-2">Descartar esta transação?</p>
            <p className="text-sm text-[#3a3a3c] leading-relaxed mb-1">
              <span className="font-semibold">{pendingDiscard.merchant || pendingDiscard.description}</span> ·{' '}
              {formatCurrencyBR(Number(pendingDiscard.amount))}
            </p>
            <p className="text-sm text-[#6e6e73] leading-relaxed mb-5">
              Ela sai do extrato e <strong>não volta</strong>. Se mudar de ideia, vai precisar lançar
              esse gasto à mão.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPendingDiscard(null)}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-[#3a3a3c] border-2 border-[#e5e5ea]"
              >
                Cancelar
              </button>
              <button
                onClick={() => { handleIgnore(pendingDiscard); setPendingDiscard(null); }}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white bg-[#ff3b30]"
              >
                Descartar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Aviso de teto atingido */}
      {tetoHit && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-6" onClick={() => setTetoHit(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-5xl mb-3">⚠️</div>
            <p className="font-black text-[#1d1d1f] text-lg mb-2">Atenção ao teto</p>
            <p className="text-sm text-[#3a3a3c] leading-relaxed mb-5">
              Você já usou <span className="font-black text-[#ff9500]">{tetoHit.pct}%</span> do seu teto de{' '}
              <span className="font-bold">{tetoHit.name}</span> este mês — {formatCurrencyBR(tetoHit.spent)} de{' '}
              {formatCurrencyBR(tetoHit.teto)}. Pise no freio para não estourar.
            </p>
            <button
              onClick={() => setTetoHit(null)}
              className="w-full py-3 rounded-xl bg-[#7ab800] text-white font-bold text-sm"
            >
              Entendi
            </button>
          </div>
        </div>
      )}

      {/* Category picker modal */}
      {activeTx && (
        <CategoryPicker
          tx={activeTx}
          items={items}
          onConfirm={(itemId, category) => handleConfirm(activeTx, itemId, category)}
          onIgnore={() => handleIgnore(activeTx)}
          onClose={() => setActiveTx(null)}
        />
      )}
    </div>
  );
}
