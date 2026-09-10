import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { CategoryType, FinanceItem, PartialExpense } from '../types';
import type { BankTransaction } from '../lib/openfinance/types';
import { merchantKey } from '../lib/openfinance/categoryMap';
import ConectarBanco from './ConectarBanco';
import Assinaturas from './Assinaturas';
import { pedirPermissaoPush } from '../lib/push';

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
  /** Renomeia o lançamento recém-criado, quando o cliente quiser batizá-lo. */
  onRenomearPartial?: (itemId: string, partialId: string, nome: string, ano: number, mes: number) => void;
  /** Banco removido — o Plano precisa soltar as linhas de fatura que vieram dele. */
  onBancoRemovido?: (bankName: string) => void;
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

  /**
   * Entrada só pode ser Renda; saída, nunca.
   *
   * A regra antiga escondia "Renda" nas despesas mas NÃO escondia as despesas
   * nas entradas: um recebimento de R$ 7.863 oferecia "conta fixa, variável,
   * lazer" — e aceitava. O dinheiro que entrou virava gasto.
   */
  const availableCategories = Object.values(CategoryType).filter((c) =>
    tx.transactionType === 'income' ? c === CategoryType.INCOME : c !== CategoryType.INCOME
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
    selectedCategory === CategoryType.INCOME
    || selectedCategory === CategoryType.PERSONAL_LEISURE
      ? true
      : selectedItemId !== null
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
        {/* Lazer NÃO tem subcategoria.
            Regra do método, dita pelo Eduardo em 2026-09-09: tudo que é lazer
            entra numa linha só, e o que distingue um gasto do outro é a
            descrição — não um item de plano. Perguntar "qual item?" ali só
            produzia lixo: o plano ganhava linhas chamadas
            "AMAZONMKTPLC*MEGABYTEM". Contas variáveis, ao contrário, têm itens
            de verdade (conserto, farmácia), e lá a pergunta continua. */}
        {selectedCategory && selectedCategory !== CategoryType.INCOME
          && selectedCategory !== CategoryType.PERSONAL_LEISURE && (
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
        {/* Segunda linha: o que ajudar a RECONHECER o gasto.
            A descrição do banco quando ela diz algo a mais que o nome; senão, a
            categoria que o próprio banco atribuiu. Existe porque nomes de
            maquininha não significam nada sozinhos: "CVS" não diz se foi
            farmácia, mercado ou restaurante, e o cliente fica sem como decidir
            (Eduardo, 2026-09-09). O rótulo do banco costuma resolver. */}
        {(() => {
          const desc = tx.description && tx.description !== tx.merchant ? tx.description : null;
          const extra = desc ?? (tx.ofCategory || null);
          if (!extra) return null;
          return <p className="text-[10px] text-[#c7c7cc] truncate leading-tight">{extra}</p>;
        })()}
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
  onRenomearPartial,
  onBancoRemovido,
  onClose,
}: Props) {
  /**
   * Cabeçalho de autenticação com token NOVO a cada chamada.
   *
   * O token vinha por prop, buscado uma única vez ao abrir o Extrato, e servia
   * às 16 chamadas seguintes. Só que token do Clerk vale 60 SEGUNDOS: quem
   * ficava categorizando por mais de um minuto — ou seja, todo mundo — passava
   * a receber 401 em tudo. As primeiras confirmações funcionavam, as demais
   * eram recusadas, e o cliente via os gastos voltarem sozinhos sem entender
   * (Eduardo, 2026-09-09).
   *
   * `getToken` do Clerk devolve o token em cache enquanto ele vale e renova
   * quando expira, então chamar por requisição não custa rede à toa.
   */
  const { getToken } = useAuth();
  const cabecalho = useCallback(async (comCorpo = true): Promise<HeadersInit> => {
    const t = (await getToken({ template: 'supabase' })) ?? authToken;
    return comCorpo
      ? { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }
      : { Authorization: `Bearer ${t}` };
  }, [getToken, authToken]);

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
  /**
   * Banco marcado para remoção.
   *
   * A exclusão vive AQUI, e não só em "Bancos conectados": para achar o botão
   * antigo era preciso tocar em "conectar outro banco" — ninguém descobre um
   * excluir escondido atrás de um adicionar.
   */
  const [removendo, setRemovendo] = useState<BankConn | null>(null);
  const [removendoAgora, setRemovendoAgora] = useState(false);
  /** Falha ao gravar a categorização — precisa ser visível, não engolida. */
  const [erroSalvar, setErroSalvar] = useState('');
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
        headers: await cabecalho(),
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
  const [viewAssinaturas, setViewAssinaturas] = useState(false);
  /**
   * Renomear logo depois do toque único.
   *
   * O nome que a maquininha manda não lembra nada: "Shopee ENS Suoficial" para
   * uma camiseta, "AMAZONMKTPLC*MEGABYTEM" para um cabo. Daqui a três semanas o
   * cliente olha o próprio plano e não sabe o que comprou (Eduardo,
   * 2026-09-09). Aparece DEPOIS de o gasto já estar salvo: quem ignorar não
   * perde nada, e quem quiser batiza em dois toques.
   */
  const [renomear, setRenomear] = useState<{ itemId: string; partialId: string; ano: number; mes: number; original: string } | null>(null);
  const [nomeNovo, setNomeNovo] = useState('');
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
  /**
   * Marca a transação como resolvida no servidor.
   *
   * Antes era `fetch(...).catch(() => {})`: um 403, um 500 ou uma linha que não
   * casou passavam despercebidos. O cliente via o gasto sumir da tela, voltava
   * depois e encontrava tudo de novo — sem nunca saber que a gravação falhou.
   * Agora a falha devolve a transação para a fila e avisa.
   */
  async function marcarNoServidor(tx: BankTransaction, corpo: Record<string, unknown>): Promise<boolean> {
    let motivo = 'Não consegui salvar essa categorização. Tente de novo.';
    try {
      const r = await fetch('/api/of-transactions', {
        method: 'PATCH',
        headers: await cabecalho(),
        body: JSON.stringify(corpo),
      });
      if (r.ok) return true;
      // Diz o motivo REAL. A primeira versão chutava "confira a internet" e
      // mandava o cliente procurar defeito onde não havia: a falha era 401 por
      // token vencido, com a rede perfeita.
      motivo = r.status === 401 || r.status === 403
        ? 'Sua sessão expirou. Feche e abra o Extrato para continuar.'
        : `O servidor recusou (erro ${r.status}). Tente de novo em instantes.`;
    } catch {
      motivo = 'Sem conexão com o servidor. Confira a internet e tente de novo.';
    }
    setTransactions((prev) => (prev.some((t) => t.transactionId === tx.transactionId) ? prev : [tx, ...prev]));
    setErroSalvar(motivo);
    return false;
  }

  async function confirmarRapido(tx: BankTransaction) {
    const categoria = tx.suggestedCategory as CategoryType | null;
    if (!categoria) return;

    const nome = tx.merchant || tx.description || 'Gasto';

    /**
     * Item de destino, sem inventar linha nova a cada estabelecimento.
     *
     * Antes, o toque único caía em `onCreateItem(nome)` sempre que não
     * reconhecia o item — e o nome era o do estabelecimento cru. Em poucos dias
     * o plano tinha linhas chamadas "AMAZONMKTPLC*MEGABYTEM" e "Mshop
     * Atacado", e o seletor de itens virou uma lista de recibos.
     *
     * Agora cada categoria tem uma linha guarda-chuva: o gasto entra nela e o
     * nome do estabelecimento vai na descrição do lançamento, que é onde ele
     * pertence. Criar linha nova volta a ser decisão do cliente, no fluxo
     * completo.
     */
    /**
     * RENDA também tem guarda-chuva, e é a linha de renda que já existe.
     *
     * Sem ela, cada PIX recebido virava uma LINHA nova de renda com o nome cru
     * do banco ("PIX RECEBIDO - REM EMSHOPCOMERCIAL LTDA 03/09 - DOCTO:
     * 857452"), planejado zero. Na tela isso aparecia como renda R$ 0,00 e o
     * cliente concluía, com razão, que o recebimento não tinha entrado
     * (Eduardo, 2026-09-10).
     *
     * O recebimento é um LANÇAMENTO dentro da renda planejada, do mesmo jeito
     * que uma compra de mercado é um lançamento dentro do teto de Mercado: o
     * planejado continua sendo a base dos pilares e o recebido vai somando
     * embaixo até compor o mês.
     */
    const GUARDA_CHUVA: Partial<Record<CategoryType, string>> = {
      [CategoryType.INCOME]: 'Renda',
      [CategoryType.PERSONAL_LEISURE]: 'Lazer e Despesas Pessoais',
      [CategoryType.VARIABLE_EXPENSE]: 'Gastos Variáveis',
      [CategoryType.FIXED_EXPENSE]: 'Outras Contas Fixas',
    };
    // Lazer e Renda caem na primeira linha da categoria quando não existe uma
    // com o nome exato: as duas são linha única por natureza, e criar outra só
    // fragmentaria o que o cliente lê como um número só.
    const CAI_NA_PRIMEIRA = categoria === CategoryType.PERSONAL_LEISURE
      || categoria === CategoryType.INCOME;
    const daCategoria = items.filter((i) => i.category === categoria);
    const nomeGuardaChuva = GUARDA_CHUVA[categoria];
    const guardaChuva = nomeGuardaChuva
      ? (daCategoria.find((i) => i.description === nomeGuardaChuva)?.id
         ?? (CAI_NA_PRIMEIRA ? daCategoria[0]?.id : undefined))
      : undefined;

    const itemId = tx.suggestedItemId && items.some((i) => i.id === tx.suggestedItemId)
      ? tx.suggestedItemId
      : resolveItemByCode(tx.ofCode, tx.suggestedCategory, items)
        ?? guardaChuva
        ?? onCreateItem(nomeGuardaChuva ?? nome, categoria, false);

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
        cardLast4: cartaoVisivel(tx),
      };
      onAddPartial(itemId, partial, Math.floor(abs / 12), abs % 12);
    }
    const partial = { id: primeiro };
    setTransactions((prev) => prev.filter((t) => t.transactionId !== tx.transactionId));

    marcarNoServidor(tx, { householdId, transactionId: tx.transactionId, action: 'categorize', itemId, category: categoria, partialId: partial.id });

    // Convite para batizar o gasto — o lançamento JÁ está salvo neste ponto.
    const primeiroAbs = (y * 12) + (rawM - 1);
    setRenomear({ itemId, partialId: primeiro, ano: Math.floor(primeiroAbs / 12), mes: primeiroAbs % 12, original: nome });
    setNomeNovo('');

    const key = merchantKey(tx.merchant ?? tx.description ?? '');
    if (key && !ehMarketplace(tx.merchant ?? tx.description)) {
      fetch('/api/of-merchant-memory', {
        method: 'POST', headers: await cabecalho(),
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
    /**
     * Parcelas que FALTAM, não o total da compra.
     *
     * Uma compra 9/10 tem duas parcelas pela frente (a de agora e mais uma) —
     * as oito anteriores já foram pagas e não pertencem a este plano. Mandando
     * o total, o lançamento criava dez parcelas a partir de hoje e inventava
     * quase um ano de dívida que não existe. Foi o que gerou "Monitor trabalho"
     * e "Luz e filtro" com R$ 202,90 em todos os meses (Eduardo, 2026-09-10).
     *
     * Mesma conta do `confirmarRapido` logo acima — as duas portas para o mesmo
     * gasto precisam produzir o mesmo lançamento.
     */
    const totalParcelas = tx.installmentTotal ?? 1;
    const parcelaAtual = tx.installmentCurrent ?? 1;
    const faltam = totalParcelas > 1 ? totalParcelas - parcelaAtual + 1 : 1;
    onLaunchExpense({
      itemId: '',
      value: Number(tx.amount),
      description: tx.merchant || tx.description || '',
      installments: faltam,
      isCredit: tx.accountType === 'credit_card',
      // O extrato sabe como foi pago — o ExpenseSheet nao pergunta de novo.
      knownPayMethod: tx.accountType === 'credit_card' ? 'credit' as const : 'debit' as const,
      knownCardLast4: cartaoVisivel(tx) ?? null,
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
        headers: await cabecalho(false),
      });
      const json = await r.json();
      setTransactions(json.transactions ?? []);
    } catch {
      // Silently degrade — user sees empty list
    } finally {
      setLoading(false);
    }
  }, [householdId, cabecalho]);

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
        cardLast4: cartaoVisivel(tx),
      };
      const itemId = itemById.get(tx.transactionId)!;
      onAddPartial(itemId, partial, y, rawM - 1);

      cabecalho().then((h) => fetch('/api/of-transactions', {
        method: 'PATCH',
        headers: h,
        body: JSON.stringify({
          householdId, transactionId: tx.transactionId, action: 'categorize',
          itemId, category: tx.suggestedCategory, partialId: partial.id,
        }),
      })).catch(() => { /* não crítico */ });
    }

    const ids = new Set(ready.map((t) => t.transactionId));
    setTransactions((prev) => prev.filter((t) => !ids.has(t.transactionId)));
    setAutoFiled((n) => n + ready.length);
  }, [transactions, items, householdId, cabecalho, onAddPartial]);

  // Bancos conectados — a transação guarda só o connectionId, o nome e o
  // código COMPE (para a logo) vêm daqui.
  const [banks, setBanks] = useState<BankConn[]>([]);
  const [banksLoaded, setBanksLoaded] = useState(false);
  /** Desconecta (e opcionalmente apaga o extrato) do banco escolhido. */
  const removerBanco = async (conn: BankConn, apagarHistorico: boolean) => {
    setRemovendoAgora(true);
    try {
      await fetch('/api/of-connect', {
        method: 'DELETE',
        headers: await cabecalho(),
        body: JSON.stringify({ householdId, connectionId: conn.id, apagarHistorico }),
      });
      if (apagarHistorico) {
        setTransactions((prev) => prev.filter((t) => t.connectionId !== conn.id));
        onBancoRemovido?.(conn.bankName);
      }
      setAberto(null);
      setRemovendo(null);
      loadBanks();
    } finally {
      setRemovendoAgora(false);
    }
  };

  const loadBanks = useCallback(() => {
    cabecalho(false).then((h) => fetch(`/api/of-connect?householdId=${householdId}`, { headers: h }))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.connections) setBanks(d.connections); })
      .catch(() => { /* sem lista: cai no extrato único */ })
      .finally(() => setBanksLoaded(true));
  }, [householdId, cabecalho]);
  /**
   * Respiro do topo para camada `fixed` dentro do app nativo.
   *
   * O QUE ACONTECE: com `contentInset: 'automatic'` o WKWebView empurra o
   * conteúdo em FLUXO para baixo do notch e, por já cuidar disso, reporta
   * `env(safe-area-inset-top)` como zero. Camada `position: fixed` não recebe
   * o empurrão e também não tem o valor do CSS — encosta na borda de cima.
   *
   * POR QUE NÃO É MEDIDO: o empurrão vive no scroll view nativo, fora do
   * sistema de coordenadas do documento. `getBoundingClientRect` devolve zero
   * para ele, e foi assim que a tentativa anterior falhou. Não existe leitura
   * possível a partir do JavaScript aqui.
   *
   * ENTÃO É TABELADO, e assumidamente: 59px onde há Dynamic Island, 47px onde
   * há entalhe, zero no resto. Fora do app nativo o valor é zero e o `safe-top`
   * do CSS assume, que é o caminho correto na web e no Android.
   *
   * ISTO É PROVISÓRIO. A correção de verdade é `contentInset: 'never'` no
   * capacitor.config.ts — já commitado, esperando build na App Store. Com ela o
   * WebView para de empurrar, `env()` passa a valer, e este bloco inteiro pode
   * sair. Ao mexer aqui, confira se aquela build já saiu.
   */
  const topoDaCamadaFixa = (() => {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor;
    if (!cap?.isNativePlatform?.() || cap.getPlatform?.() !== 'ios') return 0;
    const alturaLogica = Math.max(window.screen.width, window.screen.height);
    if (alturaLogica >= 900) return 59; // Dynamic Island (14 Pro em diante)
    if (alturaLogica >= 812) return 47; // entalhe (X ao 13)
    return 0;                            // botão de início: sem área reservada
  })();

  useEffect(() => {
    const anterior = document.body.style.overflow;
    window.scrollTo(0, 0);
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = anterior; };
  }, []);

  useEffect(() => { loadBanks(); }, [loadBanks]);

  /**
   * Confere sozinho o status de quem está "aguardando autorização".
   *
   * A Technospeed não avisa por conta própria enquanto o webhook daquele
   * pagador não estiver cadastrado, e mesmo com ele o aviso pode demorar. Sem
   * esta checagem, o cliente autoriza no banco, volta ao app e continua vendo
   * "aguardando você autorizar" — foi o que aconteceu com o Michael em
   * 2026-09-09, com DOIS bancos já autorizados.
   *
   * Só as pendentes, uma vez por abertura da tela: leitura na Technospeed é
   * limitada a 3 por minuto, e varrer tudo a cada render queimaria a cota.
   */
  const statusConferidoRef = useRef(false);
  useEffect(() => {
    if (!banksLoaded || statusConferidoRef.current) return;
    const pendentes = banks.filter((b) => b.consentStatus === 'pending_authorization');
    if (pendentes.length === 0) return;
    statusConferidoRef.current = true;

    (async () => {
      let mudou = false;
      for (const b of pendentes.slice(0, 3)) {
        try {
          const r = await fetch('/api/of-status', {
            method: 'POST',
            headers: await cabecalho(),
            body: JSON.stringify({ householdId, connectionId: b.id }),
          });
          if (r.ok) mudou = true;
        } catch { /* checagem é acessória */ }
      }
      if (mudou) loadBanks();
    })();
  }, [banksLoaded, banks, householdId, cabecalho, loadBanks]);

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

  /**
   * Cartão onde cai a transação que veio SEM os 4 dígitos.
   *
   * O banco nem sempre manda o número. Sem este destino, a chave saía vazia
   * (`conn|card|`) e não batia com linha nenhuma da tela: a transação era
   * contada no total e não aparecia em badge algum — 71 no pop-up contra 49
   * somando os badges (Eduardo, 2026-09-09).
   *
   * Precisa ser o MESMO destino que a lista usa. Lá, `inBank` aceita transação
   * sem dígito em qualquer cartão aberto; aqui ela vai para o primeiro. Badge e
   * lista contando de formas diferentes é o que produziu a divergência.
   */
  const cartoesDaConexao = new Map<string, string[]>(
    banks.map((b) => [b.id, b.cards.map((c) => c.last4)] as [string, string[]]),
  );

  /**
   * Uma transacao pertence a conta corrente ou a um cartao ESPECIFICO DA TELA.
   *
   * Duas formas de a transação ficar órfã, e as duas aconteceram:
   *   1. o banco não manda os 4 dígitos;
   *   2. manda dígitos de um cartão que não está na lista — adicional, virtual,
   *      cartão trocado. Foi este o caso das 22 que faziam o pop-up dizer 71
   *      enquanto os badges somavam 49 (Eduardo, 2026-09-09).
   *
   * Nos dois casos a transação vai para o primeiro cartão da conexão. Ficar
   * apontando para uma linha que não existe é o que a tornava invisível — e
   * contada. Melhor no cartão errado e visível do que certa e fantasma: o
   * cliente consegue recategorizar, mas não consegue achar o que não aparece.
   */
  /**
 * Marketplaces: mesmo nome, compra sempre diferente.
 *
 * A memória por estabelecimento existe porque "Diego Lanches" é sempre lanche —
 * decidiu uma vez, vale para sempre. Marketplace quebra essa premissa: toda
 * compra na Amazon chega como "Amazon Servicos de Varejo do Brasil LTDA",
 * seja uma calça, um cabo ou um livro. Herdar a decisão anterior faria a calça
 * jeans virar nome de tudo que vier depois (Eduardo, 2026-09-09).
 *
 * Aqui a categoria continua sendo sugerida — o que NÃO acontece é gravar e
 * reaplicar a escolha do cliente. Cada compra é perguntada de novo, que é o
 * único jeito honesto quando o nome não diz o que foi comprado.
 */
  const ehMarketplace = (nome: string | null | undefined) =>
    !!nome && /\b(amazon|amzn|mercado\s*(livre|pago)|mercadoliv|mercadopago|shopee|shein|aliexpress|ali\s*express|magalu|magazine\s*luiza|americanas|submarino|casas\s*bahia|kabum|netshoes|temu|ebay|olx|enjoei|mp\s\*)/i.test(nome);

  /**
   * Os 4 dígitos do cartão que o cliente RECONHECE.
   *
   * Compra em cartão virtual chega com um número temporário — o Itaú gera um
   * por compra. Gravar esse número no plano fazia aparecer "Cartão ··6174" e
   * "··0879" no filtro de meios de pagamento, e o Eduardo não sabia de onde
   * vinham: não são cartões dele, são descartáveis de uma compra só
   * (2026-09-09).
   *
   * Cai no cartão real da conexão sempre que o número não estiver entre os
   * cadastrados. O extrato do banco continua guardando o número original; o
   * plano passa a mostrar o cartão que existe na vida do cliente.
   */
  const cartaoVisivel = (t: BankTransaction): string | undefined => {
    const daConexao = cartoesDaConexao.get(t.connectionId ?? '') ?? [];
    if (t.cardLast4 && daConexao.includes(t.cardLast4)) return t.cardLast4;
    return daConexao[0] ?? aberto?.last4 ?? undefined;
  };

  const chaveDaTx = (t: BankTransaction) => {
    const conn = t.connectionId ?? '';
    if (t.accountType !== 'credit_card') return chaveDe(conn, 'checking');
    const daConexao = cartoesDaConexao.get(conn) ?? [];
    const casa = t.cardLast4 && daConexao.includes(t.cardLast4) ? t.cardLast4 : daConexao[0];
    // Conexão sem cartão nenhum: cai na conta corrente para continuar visível.
    return casa ? chaveDe(conn, 'card', casa) : chaveDe(conn, 'checking');
  };

  const countByKey = transactions.reduce<Record<string, number>>((acc, t) => {
    const k = chaveDaTx(t);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  // A lista de bancos é a porta de entrada do Extrato — inclusive com zero ou
  // um banco, porque é onde mora o botão de conectar. Antes isso vivia em
  // Configurações → Gerenciar bancos, dois níveis longe de onde faz sentido.
  const showBankPicker = aberto === null;

  if (viewAssinaturas && aberto === null) {
    return (
      <Assinaturas
        householdId={householdId}
        authToken={authToken}
        topOffset={topoDaCamadaFixa}
        onClose={() => setViewAssinaturas(false)}
      />
    );
  }
  /**
   * Nenhum banco entregou movimentação ainda — é quando o aviso de espera importa.
   *
   * Precisa esperar o carregamento: no primeiro instante a lista está vazia
   * porque ainda não chegou, e o banner piscava na tela antes de sumir sozinho.
   */
  const semNadaAindaParaCategorizar = !loading && transactions.length === 0;

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
      cardLast4: cartaoVisivel(tx),
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
    //
    // Vale para entrada também: numa linha de Renda o mesmo registro é lido
    // como RECEBIDO, não como gasto (ver o selo em BlockSection). O que o
    // recebimento NÃO faz é mexer em `totalIncome`, que continua somando o
    // planejado — decisão do Eduardo em 2026-09-08: mostrar planejado × recebido
    // lado a lado. Alterar a renda mexeria no denominador de todos os pilares e
    // mudaria o diagnóstico inteiro.
    onAddPartial(itemId, partial, year, month);
    setActiveTx(null);
    setTransactions((prev) => prev.filter((t) => t.transactionId !== tx.transactionId));

    // 2. Marca no servidor — e devolve para a fila se falhar.
    marcarNoServidor(tx, {
      householdId,
      transactionId: tx.transactionId,
      action: 'categorize',
      itemId,
      category,
      partialId: partial.id,
    });

    // 3. Update merchant memory (fire-and-forget)
    // Mesma fonte que o cron usa para LER (merchant primeiro, descrição como
    // reserva). Chaves diferentes entre gravar e ler = memória que nunca acerta.
    const key = merchantKey(tx.merchant ?? tx.description ?? '');
    if (key && !ehMarketplace(tx.merchant ?? tx.description)) {
      fetch('/api/of-merchant-memory', {
        method: 'POST',
        headers: await cabecalho(),
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
        headers: await cabecalho(),
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
    // MESMA regra do badge (chaveDaTx). Se as duas divergirem, volta a existir
    // gasto contado num lugar e exibido em outro — foi assim que nasceu a
    // diferenca entre 71 e 49.
    return chaveDaTx(t) === chaveDe(aberto.connId, aberto.kind, aberto.last4);
  });

  const displayed = inBank
    .filter((t) => filter === 'all' || t.transactionType === filter)
    .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));

  // Os quatro números vêm de `inBank`, nunca de `transactions`. O total de
  // despesas somava a lista inteira enquanto a contagem olhava só o banco
  // aberto: a tela do Bradesco anunciava "8 itens · R$ 32.770,92" com o valor
  // do Itaú e do Nubank dentro.
  const expenseCount = inBank.filter((t) => t.transactionType === 'expense').length;
  const incomeCount = inBank.filter((t) => t.transactionType === 'income').length;
  const somaDe = (tipo: 'expense' | 'income') =>
    inBank.filter((t) => t.transactionType === tipo).reduce((s, t) => s + Number(t.amount), 0);
  const totalExpense = somaDe('expense');
  const totalIncome = somaDe('income');

  // ── Render ─────────────────────────────────────────────────────────────────

  // z-[60] e não z-40: o header do app é sticky z-50 e ficava POR CIMA,
  // cortando os totais do topo desta tela. safe-top livra o notch.
  // ─── Tela inicial: escolher o banco ────────────────────────────────────────
  if (showBankPicker) {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col bg-[#f2f2f7]" style={{ paddingTop: topoDaCamadaFixa }}>
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
            onClose={() => {
              setShowConectar(false);
              loadBanks();
              /**
               * A hora de pedir push é ESTA, e não a primeira abertura do app.
               *
               * O cliente acabou de conectar o banco: "a gente te avisa quando
               * seus gastos chegarem" deixou de ser promessa abstrata e virou a
               * próxima coisa que ele espera. No iOS o "não" é definitivo e só
               * volta pelas Configurações do aparelho — pedir antes de o aviso
               * significar algo é o jeito mais rápido de perder o canal.
               *
               * Sem await: a permissão é do sistema e não deve segurar a tela.
               */
              pedirPermissaoPush().catch(() => {});
            }}
          />
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {/* Aviso de espera EM CIMA, com peso de banner.
              Ele existia no rodapé, em cinza pequeno, e o primeiro cliente a
              usar o app não leu: conectou, viu tudo vazio e perguntou "e agora,
              o que eu faço?" (Michael, 2026-09-09). Aviso que responde a pergunta
              mais frequente da tela não pode ficar onde ninguém rola. Some
              sozinho quando já há o que categorizar — a essa altura ele virou
              ruído. */}
          {banksLoaded && banks.length > 0 && semNadaAindaParaCategorizar && (
            <div className="rounded-2xl border border-[#c9e88a] bg-[#f0fad0] p-4">
              <div className="flex items-start gap-3">
                <i className="fas fa-hourglass-half mt-0.5 text-[#5a8c00]" />
                <div className="min-w-0">
                  <p className="text-[14px] font-black leading-snug text-[#2f4a00]">
                    Estamos esperando seu banco
                  </p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-[#4a5c2a]">
                    Seus gastos não chegam na hora da compra: o banco leva de <strong>6 a 24 horas</strong>
                    {' '}para liberar. É regra do Open Finance, não do Kashim.
                  </p>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#4a5c2a]">
                    <strong>Você não precisa fazer nada agora.</strong> Pode fechar o app — a gente te
                    avisa assim que chegarem.
                  </p>
                </div>
              </div>
            </div>
          )}

          {banksLoaded && banks.length > 0 && (
            <button
              onClick={() => setViewAssinaturas(true)}
              className="w-full bg-white rounded-2xl shadow-sm px-4 py-3.5 flex items-center gap-3 active:bg-[#f7f7f8] transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-xl bg-[#007aff15] flex items-center justify-center flex-shrink-0">
                <i className="fas fa-rotate text-[#007aff] text-[17px]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-bold text-[#1d1d1f]">Assinaturas</p>
                <p className="text-[12px] text-[#8e8e93]">Veja o que você paga todo mês</p>
              </div>
              <i className="fas fa-chevron-right text-[#c7c7cc] text-[11px] flex-shrink-0" />
            </button>
          )}

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
                    {/* Exclusão mora AQUI: antes só existia atrás de "conectar
                        outro banco", e ninguém procura um excluir dentro de um
                        adicionar. */}
                    <button
                      onClick={() => setRemovendo(b)}
                      aria-label={`Remover ${b.bankName}`}
                      className="w-9 h-9 shrink-0 rounded-full text-[#c7c7cc] hover:bg-[#fff0f0] hover:text-[#ff3b30] flex items-center justify-center transition-colors"
                    >
                      <i className="fas fa-trash-can text-[13px]" />
                    </button>
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

              {!semNadaAindaParaCategorizar && (
                <p className="text-[11px] text-[#8e8e93] leading-relaxed text-center px-4 pt-1 pb-4">
                  Movimentação nova pode levar algumas horas para aparecer. A gente te avisa.
                </p>
              )}
            </>
          )}
        </div>

        {/* Remover banco — duas saídas, porque as duas são legítimas.
            "Apagar tudo" limpa o EXTRATO, não o plano: o que o cliente já
            categorizou virou gasto em finance_items, registro separado, e
            continua de pé. O texto diz isso, senão ninguém escolhe com
            confiança. */}
        {removendo && (
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-5">
            <div className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl p-5">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fff0f0]">
                <i className="fas fa-trash-can text-[#ff3b30]" />
              </div>

              <h3 className="mb-1 text-center text-[19px] font-black text-[#1d1d1f]">
                Remover {removendo.bankName}?
              </h3>
              <p className="mb-5 text-center text-[13px] leading-snug text-[#6e6e73]">
                Escolha o que fazer com o que já veio deste banco.
              </p>

              <button
                disabled={removendoAgora}
                onClick={() => removerBanco(removendo, false)}
                className="mb-2 w-full rounded-2xl border border-[#e5e5ea] bg-white p-3.5 text-left active:bg-[#f7f7f8] disabled:opacity-50"
              >
                <span className="block text-[14px] font-bold text-[#1d1d1f]">
                  Desconectar e manter o histórico
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-[#8e8e93]">
                  Para de puxar novidades. O que já entrou continua no seu extrato e no seu plano.
                </span>
              </button>

              <button
                disabled={removendoAgora}
                onClick={() => removerBanco(removendo, true)}
                className="mb-3 w-full rounded-2xl border border-[#ffd4d4] bg-[#fff7f7] p-3.5 text-left active:bg-[#ffefef] disabled:opacity-50"
              >
                <span className="block text-[14px] font-bold text-[#ff3b30]">
                  Apagar tudo deste banco
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-[#8e8e93]">
                  Some o banco, os cartões e os lançamentos do extrato. Os gastos que você já
                  categorizou continuam no seu plano. Não dá para desfazer.
                </span>
              </button>

              <button
                disabled={removendoAgora}
                onClick={() => setRemovendo(null)}
                className="w-full py-3 text-[12px] font-bold uppercase tracking-widest text-[#8e8e93] disabled:opacity-50"
              >
                {removendoAgora ? 'Removendo...' : 'Cancelar'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#f2f2f7]" style={{ paddingTop: topoDaCamadaFixa }}>
      {erroSalvar && (
        <div className="fixed inset-x-3 top-3 z-[75] rounded-2xl border border-[#ffd4d4] bg-[#fff5f5] p-3 shadow-lg">
          <p className="text-[12.5px] font-bold leading-snug text-[#c0392b]">{erroSalvar}</p>
          <button onClick={() => setErroSalvar('')} className="mt-1 text-[11px] font-bold uppercase tracking-wider text-[#8e8e93]">
            Fechar
          </button>
        </div>
      )}

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
                <p className="text-sm font-black text-[#1d1d1f]">{formatCurrencyBR(totalIncome)}</p>
                <p className="text-[10px] text-[#aeaeb2]">{incomeCount} itens</p>
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
                {autoFiled} lançamento{autoFiled === 1 ? '' : 's'} o Kashim já categorizou sozinho
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
            {/* Vazio POR BANCO, não pela lista toda. Quem conecta um segundo
                banco tem `transactions` cheio do primeiro, e via "tente mudar o
                filtro" — inútil — em vez do aviso de que o banco ainda não
                liberou. É o exato momento em que o cliente acha que quebrou. */}
            <i className={`fas ${inBank.length === 0 ? 'fa-clock' : 'fa-check-circle'} text-[#7ab800] text-4xl`} />
            <p className="font-bold text-[#1d1d1f]">
              {inBank.length === 0
                ? 'Nenhuma transação a categorizar'
                : 'Nenhuma transação nesse filtro'}
            </p>
            <p className="text-sm text-[#6e6e73]">
              {inBank.length === 0
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
      {renomear && (
        /* Clicar fora fecha. Sem isso o cliente ficava preso: os dois botões
           decidiam o nome, e quem só queria sair da tela não tinha por onde
           (Eduardo, 2026-09-10). */
        <div
          className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setRenomear(null); }}
        >
          {/* Centralizada, não colada embaixo: com o teclado aberto o iOS
              encolhe a área visível e uma folha ancorada no rodapé fica atrás
              dele — foi o que cortou o botão "Salvar nome". */}
          <div className="relative max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-5">
            <button
              onClick={() => setRenomear(null)}
              aria-label="Fechar"
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-[#f2f2f7] text-[#8e8e93] active:bg-[#e5e5ea]"
            >
              <i className="fas fa-xmark text-sm" />
            </button>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#5a8c00]">Gasto já salvo</p>
            <h3 className="mb-1 mt-1 pr-10 text-[19px] font-black leading-tight text-[#1d1d1f]">
              Quer dar um nome que você reconheça?
            </h3>
            <p className="mb-3 text-[13px] leading-snug text-[#6e6e73]">
              O banco chamou de <strong className="text-[#1d1d1f]">{renomear.original}</strong>. Daqui a um
              mês esse nome pode não dizer nada.
            </p>
            {/* Sem este recado o cliente achava que estava perdendo a única
                chance de nomear, e fechar a tela dava aflição. */}
            <p className="mb-4 rounded-xl bg-[#f5f5f7] px-3 py-2 text-[12px] leading-snug text-[#6e6e73]">
              O lançamento <strong className="text-[#1d1d1f]">já entrou no seu plano</strong> — isto aqui é só
              o apelido. Dá para mudar quando quiser em <strong className="text-[#1d1d1f]">Gastos</strong> →
              toque no lançamento → <strong className="text-[#1d1d1f]">Editar</strong>.
            </p>
            <input
              autoFocus
              value={nomeNovo}
              onChange={(e) => setNomeNovo(e.target.value)}
              placeholder="Ex.: camiseta do Tio, cabo do notebook"
              maxLength={60}
              className="w-full rounded-2xl border border-[#e5e5ea] bg-[#f7f7f8] px-4 py-3 text-[15px] text-[#1d1d1f] outline-none focus:border-[#a8e716] focus:bg-white"
            />
            <button
              disabled={!nomeNovo.trim()}
              onClick={() => {
                onRenomearPartial?.(renomear.itemId, renomear.partialId, nomeNovo.trim(), renomear.ano, renomear.mes);
                setRenomear(null);
              }}
              className="mt-3 w-full rounded-2xl py-3.5 text-xs font-black uppercase tracking-widest text-black transition-all active:scale-95 disabled:opacity-40"
              style={{ background: 'linear-gradient(90deg, #c5f23a, #8cc400)' }}
            >
              Salvar nome
            </button>
            <button
              onClick={() => setRenomear(null)}
              className="w-full py-3 text-[12px] font-bold uppercase tracking-widest text-[#8e8e93]"
            >
              Agora não
            </button>
          </div>
        </div>
      )}

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
