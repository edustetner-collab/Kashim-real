
import React, { useState, useEffect, useRef } from 'react';
import { CategoryType, FinanceItem, LinkType } from '../types';
import { formatCurrency } from '../constants';
import { isEducationItem } from '../lib/educationUtils';
import CurrencyInput from './CurrencyInput';

interface BlockSectionProps {
  title: string;
  subtitle?: string;
  category: CategoryType;
  items: FinanceItem[];
  allCards?: FinanceItem[];
  months: any[];
  totalIncome: number;
  mobileMonthIdx?: number;
  onAddItem: (category: CategoryType, customData?: Partial<FinanceItem>) => void;
  onRequestExpenseSheet?: () => void;
  onAddLeisureItem?: (value: number) => void;
  onUpdateValue: (id: string, monthIdx: number, value: string) => void;
  onTogglePaid: (id: string, monthIdx: number) => void;
  onRemoveItem: (id: string) => void;
  onUpdateDescription: (id: string, desc: string) => void;
  onReplicateValue: (id: string, monthIdx: number) => void;
  onLinkCard?: (itemId: string, cardId: string, linkType?: LinkType) => void;
  onUpdateCardConfig?: (id: string, field: 'closingDay' | 'dueDay', value: number) => void;
  onMoveItem?: (id: string, direction: 'up' | 'down') => void;
  trackedByCardId?: Record<string, number>;
  trackedByCardAllMonths?: Record<string, Record<number, number>>;
  /** Coach/assistente: pula os recados educativos (modal de instrução ao
      adicionar e aviso de parcelas) — eles são para o cliente. */
  isAdmin?: boolean;
}

const BlockSection: React.FC<BlockSectionProps> = ({
  title, subtitle, category, items, allCards = [], months, totalIncome, mobileMonthIdx = 0,
  onAddItem, onUpdateValue, onTogglePaid, onRemoveItem, onUpdateDescription, onReplicateValue, onLinkCard,
  onUpdateCardConfig, onMoveItem, trackedByCardId, trackedByCardAllMonths, onRequestExpenseSheet, onAddLeisureItem,
  isAdmin = false
}) => {
  const [showInstructionModal, setShowInstructionModal] = useState(false);
  const [installmentWarning, setInstallmentWarning] = useState<string | null>(null);
  const [paidToast, setPaidToast] = useState<string | null>(null);
  const [replicateToast, setReplicateToast] = useState(false);
  const [cardInstallModal, setCardInstallModal] = useState<{
    itemId: string; cardId: string; totalInput: string; currentInput: string;
  } | null>(null);
  const [openPaymentItemId, setOpenPaymentItemId] = useState<string | null>(null);
  const [leisureModal, setLeisureModal] = useState<{ suggested: number; input: string } | null>(null);
  const [trackedInfoCardId, setTrackedInfoCardId] = useState<string | null>(null);
  const timersRef = useRef<Record<string, number>>({});
  const itemsRef = useRef<FinanceItem[]>(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const hiddenStorageKey = `kashim_hidden_rows_${category}`;
  const [hiddenItemIds, setHiddenItemIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(`kashim_hidden_rows_${category}`);
      return saved ? new Set(JSON.parse(saved)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  const [showHidden, setShowHidden] = useState(false);

  function toggleHideRow(id: string) {
    setHiddenItemIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      localStorage.setItem(hiddenStorageKey, JSON.stringify([...next]));
      return next;
    });
  }

  const PAID_MESSAGES = [
    'Menos uma conta! Você está no caminho certo.',
    'Parabéns! Cada conta paga é um passo para a liberdade.',
    'Conta quitada! Disciplina que constrói riqueza.',
    'Boa! Você está no controle do seu dinheiro.',
    'Missão cumprida! Continue assim.',
    'Conta paga. Seu futuro agradece.',
    'Excelente! Quem paga em dia, chega na frente.',
  ];

  const handleTogglePaid = (itemId: string, monthIdx: number, currentlyPaid: boolean) => {
    if (!currentlyPaid) {
      const msg = PAID_MESSAGES[Math.floor(Math.random() * PAID_MESSAGES.length)];
      setPaidToast(msg);
      setTimeout(() => setPaidToast(null), 3500);
    }
    onTogglePaid(itemId, monthIdx);
  };

  const handleAddWithInstruction = () => {
    const skipModal = isAdmin || localStorage.getItem(`skip_modal_${category}`);
    if (!skipModal) {
      setShowInstructionModal(true);
    } else {
      executeAdd();
    }
  };

  const executeAdd = (installments?: number) => {
    setShowInstructionModal(false);
    if (category === CategoryType.PERSONAL_LEISURE) {
      const suggestedLeisure = Math.round(totalIncome * 0.15);
      setLeisureModal({ suggested: suggestedLeisure, input: String(suggestedLeisure) });
    } else if (category === CategoryType.VARIABLE_EXPENSE) {
      if (onRequestExpenseSheet) {
        onRequestExpenseSheet();
      } else {
        onAddItem(category, { values: new Array(12).fill(0) });
      }
    } else {
      onAddItem(category);
    }
  };

  const handleReplicateWithToast = (itemId: string, monthIdx: number) => {
    onReplicateValue(itemId, monthIdx);
    setReplicateToast(true);
    setTimeout(() => setReplicateToast(false), 2200);
  };

  const handleCardInstallConfirm = () => {
    if (!cardInstallModal || !onLinkCard) return;
    const total = parseInt(cardInstallModal.totalInput) || 0;
    const current = parseInt(cardInstallModal.currentInput) || 1;
    const remaining = total - current;
    onLinkCard(cardInstallModal.itemId, cardInstallModal.cardId, LinkType.INSTALLMENT);
    const item = items.find(i => i.id === cardInstallModal.itemId);
    if (item && remaining > 0) {
      const baseValue = item.values[mobileMonthIdx];
      for (let i = 1; i <= remaining && (mobileMonthIdx + i) < 12; i++) {
        onUpdateValue(cardInstallModal.itemId, mobileMonthIdx + i, String(baseValue));
      }
    }
    setCardInstallModal(null);
  };

  const handleDontShowAgain = () => {
    localStorage.setItem(`skip_modal_${category}`, 'true');
    executeAdd();
  };

  const checkInstallments = (itemId: string) => {
    if (isAdmin) return;
    if (category !== CategoryType.FIXED_EXPENSE) return;
    if (timersRef.current[itemId]) window.clearTimeout(timersRef.current[itemId]);

    timersRef.current[itemId] = window.setTimeout(() => {
      // Usa o estado ATUAL (via ref) para evitar falsos positivos após replicação
      const currentItem = itemsRef.current.find(i => i.id === itemId);
      if (!currentItem) return;
      const filledCount = currentItem.values.filter(v => v > 0).length;
      if (filledCount > 0 && filledCount < 10) {
        setInstallmentWarning(
          `Este lançamento "${currentItem.description || 'sem nome'}" tem apenas ${filledCount} mês${filledCount > 1 ? 'es' : ''} preenchido${filledCount > 1 ? 's' : ''}. Contas fixas são recorrentes sem fim ou parceladas em mais de 18x. Considere movê-lo para Contas Variáveis.`
        );
      }
    }, 8000);
  };

  const getTooltipContent = () => {
    switch (category) {
      case CategoryType.INCOME:
        return { title: "Entradas e Rendas", text: "Coloque aqui seu salário fixo, rendas extras ou bônus previstos." };
      case CategoryType.FIXED_EXPENSE:
        return { title: "O que são Contas Fixas?", text: "Recorrência mensal (aluguel, condomínio) ou compras parceladas em mais de 18x." };
      case CategoryType.VARIABLE_EXPENSE:
        return { title: "O que são Contas Variáveis?", text: "Contas esporádicas, boletos únicos ou parcelamentos curtos (menos de 12 meses)." };
      case CategoryType.PERSONAL_LEISURE:
        return { title: "Lazer e Gastos Pessoais", text: `Seu estilo de vida. O teto ideal é 15% da sua renda (${formatCurrency(totalIncome * 0.15)}).` };
      case CategoryType.CREDIT_CARD:
        return { title: "Faturas de Cartão", text: "Valor TOTAL da fatura. Não detalhe os itens aqui. Configure o fechamento para maior precisão." };
      default:
        return null;
    }
  };

  const tooltip = getTooltipContent();
  const showLinkOption = category === CategoryType.FIXED_EXPENSE || 
                        category === CategoryType.VARIABLE_EXPENSE || 
                        category === CategoryType.PERSONAL_LEISURE;

  // Âncoras do tour de onboarding — um id estável por bloco
  const blockTourId = {
    [CategoryType.INCOME]: 'block-entradas',
    [CategoryType.CREDIT_CARD]: 'block-faturas',
    [CategoryType.FIXED_EXPENSE]: 'block-fixas',
    [CategoryType.VARIABLE_EXPENSE]: 'block-variaveis',
    [CategoryType.PERSONAL_LEISURE]: 'block-lazer',
  }[category];

  return (
    <div id={blockTourId} className="bg-white rounded-[22px] shadow-sm border border-[#e8e8ed] overflow-hidden print:overflow-visible mb-3 mx-3">

      {/* Paid celebration toast */}
      {paidToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[400] pointer-events-none animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div className="bg-green-500 text-white font-black text-xs uppercase tracking-widest px-5 py-3 rounded-2xl shadow-2xl shadow-green-500/40 flex items-center gap-2 text-center max-w-[280px]">
            <i className="fas fa-check-circle text-sm"></i>
            {paidToast}
          </div>
        </div>
      )}

      {/* Replicate toast */}
      {replicateToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[400] pointer-events-none animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div className="bg-orange-500 text-white font-black text-xs uppercase tracking-widest px-5 py-3 rounded-2xl shadow-2xl shadow-orange-500/40 flex items-center gap-2">
            <i className="fas fa-copy text-sm"></i>
            Replicado para todos os meses!
          </div>
        </div>
      )}

      {/* Popup: explicação do rastreado do cartão */}
      {trackedInfoCardId && (() => {
        const tracked = trackedByCardId?.[trackedInfoCardId] ?? 0;
        const prevMonthName = mobileMonthIdx > 0 ? months[mobileMonthIdx - 1]?.monthName : '?';
        return (
          <div className="fixed inset-0 z-[300] flex items-end justify-center bg-black/40 backdrop-blur-sm" onClick={() => setTrackedInfoCardId(null)}>
            <div className="w-full max-w-md bg-white border border-[#e8e8ed] rounded-t-3xl p-6 pb-10 animate-in slide-in-from-bottom-4" onClick={e => e.stopPropagation()}>
              <div className="w-10 h-1 bg-[#e8e8ed] rounded-full mx-auto mb-5"></div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-[#f0fad0] rounded-2xl flex items-center justify-center shrink-0">
                  <i className="fas fa-credit-card text-[#7ab800] text-xl"></i>
                </div>
                <div>
                  <h3 className="text-[#1d1d1f] font-black uppercase tracking-tight text-base">Gastos já rastreados</h3>
                  <p className="text-[#aeaeb2] text-xs mt-0.5">{prevMonthName} → esta fatura</p>
                </div>
              </div>
              <div className="bg-[#f0fad0] border border-[rgba(122,184,0,0.2)] rounded-2xl p-4 mb-5 space-y-2">
                <p className="text-[#6e6e73] text-sm leading-relaxed">
                  Em <span className="font-black text-[#1d1d1f]">{prevMonthName}</span> você rastreou{' '}
                  <span className="font-black text-[#7ab800] k-num">{formatCurrency(tracked)}</span>{' '}
                  neste cartão. Esse valor <span className="font-black text-[#1d1d1f]">já foi contabilizado</span> no orçamento de {prevMonthName}.
                </p>
                <p className="text-[#6e6e73] text-sm leading-relaxed">
                  Lance o <span className="font-black text-[#1d1d1f]">valor total da fatura</span>. O sistema vai abater{' '}
                  <span className="font-black text-[#7ab800] k-num">{formatCurrency(tracked)}</span> automaticamente para não duplicar.
                </p>
              </div>
              <button onClick={() => setTrackedInfoCardId(null)} className="w-full k-btn-lime py-3.5">
                Entendi
              </button>
            </div>
          </div>
        );
      })()}

      {/* Credit card installment modal */}
      {cardInstallModal && (
        <div className="fixed inset-0 z-[200] flex items-end p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-2xl">
            <h3 className="text-white font-black uppercase italic tracking-tight text-lg mb-1">Sobre o parcelamento</h3>
            <p className="text-zinc-400 text-sm mb-5">Vou preencher os meses restantes automaticamente.</p>
            <div className="flex flex-col gap-4 mb-5">
              <div>
                <label className="text-zinc-500 text-[10px] font-black uppercase tracking-wider mb-1.5 block">Total de parcelas</label>
                <div className="bg-zinc-800 border border-zinc-700 rounded-xl flex items-center px-4">
                  <input
                    type="number" min="2" max="96"
                    value={cardInstallModal.totalInput}
                    onChange={e => setCardInstallModal(p => p ? { ...p, totalInput: e.target.value } : p)}
                    placeholder="Ex: 24"
                    className="flex-1 bg-transparent py-3 text-white font-mono text-base font-black outline-none placeholder:text-zinc-600 text-center"
                  />
                  <span className="text-zinc-500 text-sm font-bold">x</span>
                </div>
              </div>
              <div>
                <label className="text-zinc-500 text-[10px] font-black uppercase tracking-wider mb-1.5 block">Qual parcela você está pagando agora?</label>
                <div className="bg-zinc-800 border border-zinc-700 rounded-xl flex items-center px-4">
                  <input
                    type="number" min="1"
                    value={cardInstallModal.currentInput}
                    onChange={e => setCardInstallModal(p => p ? { ...p, currentInput: e.target.value } : p)}
                    placeholder="Ex: 5"
                    className="flex-1 bg-transparent py-3 text-white font-mono text-base font-black outline-none placeholder:text-zinc-600 text-center"
                  />
                  <span className="text-zinc-500 text-xs">ª parcela</span>
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setCardInstallModal(null)} className="w-12 h-12 bg-zinc-800 rounded-xl flex items-center justify-center shrink-0">
                <i className="fas fa-times text-zinc-400"></i>
              </button>
              <button onClick={handleCardInstallConfirm} className="flex-1 bg-green-400 active:bg-green-300 text-black font-black py-3.5 rounded-2xl text-sm uppercase">
                Confirmar e preencher
              </button>
            </div>
          </div>
        </div>
      )}

      {installmentWarning && (
        <div className="fixed bottom-6 right-6 z-[300] max-w-sm w-full bg-zinc-900 border border-green-500/40 rounded-2xl p-4 shadow-2xl animate-in slide-in-from-bottom-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-green-400/10 rounded-xl flex items-center justify-center shrink-0">
              <i className="fas fa-exclamation-triangle text-green-400 text-sm"></i>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-green-400 font-black text-xs uppercase tracking-widest mb-1">Aviso de classificação</p>
              <p className="text-zinc-300 text-xs leading-relaxed">{installmentWarning}</p>
            </div>
            <button onClick={() => setInstallmentWarning(null)} className="text-zinc-500 hover:text-white transition-colors shrink-0">
              <i className="fas fa-times text-sm"></i>
            </button>
          </div>
        </div>
      )}

      {showInstructionModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-[30px] p-8 shadow-2xl">
            <div className="w-16 h-16 bg-green-400/10 rounded-2xl flex items-center justify-center mb-6">
              <i className={`fas ${
                category === CategoryType.INCOME ? 'fa-wallet' :
                category === CategoryType.CREDIT_CARD ? 'fa-credit-card' : 
                category === CategoryType.FIXED_EXPENSE ? 'fa-anchor' :
                category === CategoryType.VARIABLE_EXPENSE ? 'fa-random' : 'fa-cocktail'
              } text-2xl text-green-400`}></i>
            </div>
            <h3 className="text-white text-xl font-black uppercase italic tracking-tighter mb-4">Instruções: {title}</h3>
            
            <div className="space-y-4 text-zinc-300 text-sm mb-8 leading-relaxed">
              {category === CategoryType.INCOME && (
                <div className="space-y-3">
                  <p>Aqui você vai inserir suas fontes de renda.</p>
                  <p className="bg-green-400/10 p-4 rounded-xl border border-green-400/20 text-green-400 font-bold">
                    DICA: Coloque sempre o MÍNIMO que você garante que ganha. Depois, você vai atualizando o que ganhar a mais mês a mês.
                  </p>
                </div>
              )}
              {category === CategoryType.CREDIT_CARD && (
                <>
                  <p>Não detalhe a fatura item por item. Insira o valor total projetado ou real.</p>
                  <p className="text-xs text-zinc-400">Dica: Informe o dia de fechamento para que o sistema saiba se um gasto cairá nesta fatura ou na próxima.</p>
                  <div className="bg-zinc-800 p-4 rounded-xl border border-zinc-700 font-mono text-[11px]">
                    <p className="text-green-400 mb-1">Exemplo Banco Inter:</p>
                    <p>Mês 1: R$ 799 | Mês 2: R$ 699 | Mês 3: R$ 399</p>
                  </div>
                </>
              )}
              {category === CategoryType.FIXED_EXPENSE && (
                <div className="space-y-3">
                  <p>1. Contas que você paga <b>todos os meses sem data para acabar</b>.</p>
                  <p>2. Gastos parcelados em <b>acima de 18 vezes</b>.</p>
                  <div className="bg-orange-500/10 p-3 rounded-lg border border-orange-500/20 text-orange-300 text-xs">
                    <p className="font-black mb-1 uppercase tracking-wide">⚠️ Esse gasto se repete todo mês?</p>
                    <p>Se for algo eventual ou com <b>menos de 18 parcelas</b>, use <b className="text-white">Contas Variáveis</b> para manter seu diagnóstico correto.</p>
                  </div>
                  <div className="bg-green-400/10 p-3 rounded-lg border border-green-400/20 text-green-100 text-xs italic">
                    Mesmo se estiver no cartão, cite aqui! O sistema abaterá do cartão automaticamente para evitar duplicidade.
                  </div>
                </div>
              )}
              {category === CategoryType.VARIABLE_EXPENSE && (
                <div className="space-y-3">
                  <p>Gastos que <b>não se repetem todo mês</b> ou parcelamentos de <b>curta duração</b> (menos de 12 meses).</p>
                  <p>Ex: Conserto de carro, multa de trânsito, eletrodoméstico quebrado, remédios repentinos <b>NÃO recorrentes</b>, imprevistos parcelados em poucas vezes.</p>
                </div>
              )}
              {category === CategoryType.PERSONAL_LEISURE && (
                <div className="space-y-3">
                  <p>Este é o seu teto de felicidade. O método sugere no máximo <b>15% da sua renda</b>.</p>
                  <p>Se você costuma passar o lazer no cartão, pode vinculá-lo abaixo para que o sistema organize sua fatura automaticamente.</p>
                  <p>Com base na sua renda atual, sugerimos um teto de: <b className="text-green-400">{formatCurrency(totalIncome * 0.15)}</b></p>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => executeAdd()}
                className="w-full bg-green-500 hover:bg-green-400 text-black font-black py-4 rounded-2xl transition-all uppercase text-xs tracking-widest"
              >OK, Continuar</button>
              <button onClick={() => setShowInstructionModal(false)} className="text-zinc-500 hover:text-white text-[10px] font-bold uppercase tracking-[0.2em] py-2 transition-colors">Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* Leisure value confirmation modal */}
      {leisureModal && (
        <div className="fixed inset-0 z-[110] flex items-end p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-2xl">
            <div className="w-12 h-12 bg-green-400/10 rounded-2xl flex items-center justify-center mb-4">
              <i className="fas fa-cocktail text-xl text-green-400"></i>
            </div>
            <h3 className="text-white font-black uppercase italic tracking-tight text-lg mb-1">Definir teto de Lazer</h3>
            <p className="text-zinc-400 text-sm mb-5">
              Sugerimos <span className="text-green-400 font-black">{formatCurrency(leisureModal.suggested)}</span> — 15% da sua renda.
              Confirme ou ajuste o valor que faz sentido para você.
            </p>
            <div className="bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-3 mb-5 focus-within:border-green-400/40 transition-colors">
              <p className="text-[9px] font-black uppercase tracking-wider text-zinc-500 mb-1">Meu limite mensal de lazer</p>
              <div className="flex items-center gap-2">
                <span className="text-zinc-500 font-mono text-sm">R$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={leisureModal.input}
                  onChange={e => setLeisureModal(p => p ? { ...p, input: e.target.value } : p)}
                  autoFocus
                  className="flex-1 bg-transparent text-white text-2xl font-black font-mono outline-none"
                  placeholder="0"
                />
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  const val = Math.round(parseFloat(leisureModal.input) || leisureModal.suggested);
                  if (onAddLeisureItem) {
                    onAddLeisureItem(val);
                  } else {
                    onAddItem(category, { description: 'Lazer e Despesas Pessoais', values: new Array(12).fill(val) });
                  }
                  setLeisureModal(null);
                }}
                className="w-full bg-green-400 active:bg-green-300 text-black font-black py-4 rounded-2xl text-sm uppercase tracking-widest"
              >
                Confirmar
              </button>
              <button onClick={() => setLeisureModal(null)} className="text-zinc-500 text-[10px] font-bold uppercase tracking-[0.2em] py-2 text-center">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cabeçalho do bloco: fundo verde-limão translúcido + barra lateral para
          destacar o início de cada card (antes todos tinham a mesma fonte em
          fundo branco e ficava difícil separar visualmente). Título segue preto. */}
      <div
        className="px-4 py-3 flex items-center gap-3 border-b border-[rgba(122,184,0,0.2)]"
        style={{ backgroundColor: '#f4fce0', borderLeft: '3px solid #a2d800' }}
      >
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[#1d1d1f] font-black text-[11px] uppercase tracking-[1.3px] leading-tight">{title}</h3>
            {tooltip && (
              <button
                onClick={() => setShowInstructionModal(true)}
                className="text-[#aeaeb2] hover:text-[#7ab800] active:text-[#7ab800] transition-colors shrink-0"
              >
                <i className="fas fa-question-circle text-sm"></i>
              </button>
            )}
          </div>
          {subtitle && <p className="text-[#aeaeb2] text-[9px] uppercase font-bold tracking-wider mt-0.5">{subtitle}</p>}
        </div>
      </div>

      {/* Progress bars: Ideal / Realizado */}
      {(category === CategoryType.FIXED_EXPENSE || category === CategoryType.PERSONAL_LEISURE) && totalIncome > 0 && (() => {
        const toBarPct = (v: number) => Math.min(100, (v / totalIncome) * 100);

        if (category === CategoryType.PERSONAL_LEISURE) {
          const idealPct = 15;
          const idealValue = Math.round(totalIncome * 0.15);
          const determinedValue = items.reduce((s, i) => s + (i.values[mobileMonthIdx] || 0), 0);
          const detOk = determinedValue <= idealValue * 1.05;
          return (
            <div className="bg-[#fafafa] px-4 py-3 border-b border-[#e8e8ed] space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-black uppercase tracking-[1px] text-[#6e6e73]">Ideal</span>
                    <span className="text-[9px] font-black text-[#7ab800] bg-[#f0fad0] border border-[rgba(122,184,0,0.25)] rounded-full px-2 py-0.5 leading-none">{idealPct}%</span>
                  </div>
                  <span className="text-[10px] font-black k-num text-[#7ab800]">{formatCurrency(idealValue)}</span>
                </div>
                <div className="h-1.5 bg-[#e8e8ed] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${idealPct}%`, background: 'linear-gradient(90deg,#a8e716,#7ab800)' }} />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-black uppercase tracking-[1px] ${detOk ? 'text-[#007aff]' : 'text-[#ff3b30]'}`}>Realizado</span>
                    <span className={`text-[9px] font-black rounded-full px-2 py-0.5 leading-none ${detOk ? 'bg-[#f0f4ff] border border-[rgba(0,122,255,0.25)] text-[#007aff]' : 'bg-[#fff0f0] border border-[rgba(255,59,48,0.2)] text-[#ff3b30]'}`}>{toBarPct(determinedValue).toFixed(0)}%</span>
                  </div>
                  <span className={`text-[10px] font-black k-num ${detOk ? 'text-[#007aff]' : 'text-[#ff3b30]'}`}>{formatCurrency(determinedValue)}</span>
                </div>
                <div className="h-1.5 bg-[#e8e8ed] rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${detOk ? 'bg-[#007aff]' : 'bg-[#ff3b30]'}`} style={{ width: `${toBarPct(determinedValue)}%` }} />
                </div>
              </div>
            </div>
          );
        }

        // FIXED_EXPENSE: split into contas fixas core + educação
        const eduItems = items.filter(i => isEducationItem(i.description));
        const coreItems = items.filter(i => !isEducationItem(i.description));
        const eduValue = eduItems.reduce((s, i) => s + (i.values[mobileMonthIdx] || 0), 0);
        const coreValue = coreItems.reduce((s, i) => s + (i.values[mobileMonthIdx] || 0), 0);
        const coreIdealValue = Math.round(totalIncome * 0.55);
        const eduIdealValue = Math.round(totalIncome * 0.10);
        const coreOk = coreValue <= coreIdealValue * 1.05;
        const eduMissing = eduValue === 0;
        const eduOk = !eduMissing && eduValue <= eduIdealValue * 1.05;

        const barRow = (
          label: string,
          idealPct: number,
          idealVal: number,
          realVal: number,
          ok: boolean,
          missing: boolean
        ) => (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1 mb-0.5">
              <span className="text-[9px] font-black uppercase tracking-[1px] text-[#6e6e73]">{label}</span>
              {/* Sem o recado "sem lançamento": em Educação zerada confundia o
                  cliente (parecia que ELE tinha que lançar algo). Fica só o
                  Ideal 10% e o realizado em 0. */}
            </div>
            {/* Ideal */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-black uppercase tracking-[1px] text-[#6e6e73]">Ideal</span>
                <span className="text-[9px] font-black text-[#7ab800] bg-[#f0fad0] border border-[rgba(122,184,0,0.25)] rounded-full px-2 py-0.5 leading-none">{idealPct}%</span>
              </div>
              <span className="text-[10px] font-black k-num text-[#7ab800]">{formatCurrency(idealVal)}</span>
            </div>
            <div className="h-1.5 bg-[#e8e8ed] rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${idealPct}%`, background: 'linear-gradient(90deg,#a8e716,#7ab800)' }} />
            </div>
            {/* Realizado */}
            <div className="flex items-center justify-between mt-1">
              <div className="flex items-center gap-2">
                <span className={`text-[9px] font-black uppercase tracking-[1px] ${missing ? 'text-[#ff9500]' : ok ? 'text-[#007aff]' : 'text-[#ff3b30]'}`}>Realizado</span>
                <span className={`text-[9px] font-black rounded-full px-2 py-0.5 leading-none ${missing ? 'bg-[#fff8f0] border border-[rgba(255,149,0,0.25)] text-[#ff9500]' : ok ? 'bg-[#f0f4ff] border border-[rgba(0,122,255,0.25)] text-[#007aff]' : 'bg-[#fff0f0] border border-[rgba(255,59,48,0.2)] text-[#ff3b30]'}`}>
                  {toBarPct(realVal).toFixed(0)}%
                </span>
              </div>
              <span className={`text-[10px] font-black k-num ${missing ? 'text-[#ff9500]' : ok ? 'text-[#007aff]' : 'text-[#ff3b30]'}`}>{formatCurrency(realVal)}</span>
            </div>
            <div className="h-1.5 bg-[#e8e8ed] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${missing ? 'bg-[#ff9500]' : ok ? 'bg-[#007aff]' : 'bg-[#ff3b30]'}`}
                style={{ width: `${Math.max(toBarPct(realVal), missing ? 0 : 0.5)}%` }}
              />
            </div>
          </div>
        );

        return (
          <div className="bg-[#fafafa] px-4 py-3 border-b border-[#e8e8ed] space-y-4">
            {barRow('Contas Fixas', 55, coreIdealValue, coreValue, coreOk, false)}
            <div className="border-t border-[#e8e8ed]" />
            {barRow('Educação', 10, eduIdealValue, eduValue, eduOk, eduMissing)}
          </div>
        );
      })()}

      {/* ── MOBILE LAYOUT ─────────────────────────────────────────── */}
      <div className="block lg:hidden print:hidden bg-white divide-y divide-[#e8e8ed]">
        {items.filter(item => {
          if (item.category === CategoryType.VARIABLE_EXPENSE) {
            if (item.values[mobileMonthIdx] > 0) return true;
            const md = months[mobileMonthIdx];
            const mk = md ? `${md.year}-${md.index}` : '';
            const pts: any[] = (item.partialExpenses as any)?.[mk] || [];
            return pts.length > 0;
          }
          return true;
        }).map((item) => {
          const monthData = months[mobileMonthIdx];
          const monthKey = `${monthData.year}-${monthData.index}`;
          const partials = item.partialExpenses?.[monthKey] || [];
          const realSpent = partials.reduce((acc: number, p: any) => acc + p.value, 0);
          const isOver = realSpent > item.values[mobileMonthIdx] && item.values[mobileMonthIdx] > 0;
          const isPaid = item.paidStatus[mobileMonthIdx];
          const isIncome = category === CategoryType.INCOME;

          const canReplicate = category === CategoryType.INCOME || category === CategoryType.FIXED_EXPENSE || category === CategoryType.PERSONAL_LEISURE || category === CategoryType.VARIABLE_EXPENSE;
          return (
            <div key={item.id} className={`relative px-3 py-3 ${canReplicate ? 'pb-9' : ''} ${isPaid ? 'bg-[#f8fdf0]' : ''}`}>
              <div className="flex items-center gap-2">
                <button onClick={() => onRemoveItem(item.id)} className="text-[#ff3b30]/30 active:text-[#ff3b30] shrink-0 p-1">
                  <i className="fas fa-trash-alt text-[11px]"></i>
                </button>
                <input
                  type="text"
                  defaultValue={item.description}
                  onBlur={(e) => onUpdateDescription(item.id, e.target.value)}
                  onChange={(e) => onUpdateDescription(item.id, e.target.value)}
                  className="flex-1 bg-transparent text-[#1d1d1f] text-sm outline-none min-w-0 placeholder:text-[#aeaeb2]"
                  placeholder="Nome do item..."
                />
                <div className="flex items-center gap-1.5 shrink-0">
                  <CurrencyInput
                    value={item.values[mobileMonthIdx]}
                    onChange={(float) => {
                      onUpdateValue(item.id, mobileMonthIdx, String(float));
                      checkInstallments(item.id);
                    }}
                    className={`w-24 text-right rounded-xl px-2.5 py-1.5 text-sm font-black k-num outline-none border ${isPaid ? 'bg-[#f0fad0] text-[#7ab800] border-[rgba(122,184,0,0.3)]' : 'bg-[#f5f5f7] text-[#1d1d1f] border-[#e8e8ed]'}`}
                  />
                  {!isIncome && (
                    <button
                      onClick={() => handleTogglePaid(item.id, mobileMonthIdx, isPaid)}
                      className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase transition-all shrink-0 border ${isPaid ? 'bg-[#f0fad0] text-[#7ab800] border-[rgba(122,184,0,0.3)]' : 'border-[#e8e8ed] text-[#aeaeb2] active:text-[#7ab800]'}`}
                    >
                      PG
                    </button>
                  )}
                </div>
              </div>
              {category === CategoryType.CREDIT_CARD && onUpdateCardConfig && (
                <div className="mt-2 ml-7 flex gap-4" data-tour="card-config">
                  <div className="flex items-center gap-2">
                    <label className="text-[9px] font-black text-[#aeaeb2] uppercase">Fecha</label>
                    <input type="number" min="1" max="31" value={item.closingDay || ''} onChange={(e) => onUpdateCardConfig(item.id, 'closingDay', parseInt(e.target.value))} className="bg-[#f5f5f7] rounded-lg px-2 py-1 text-[11px] w-12 outline-none border border-[#e8e8ed] text-center text-[#1d1d1f]" placeholder="Dia" />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-[9px] font-black text-[#aeaeb2] uppercase">Vence</label>
                    <input type="number" min="1" max="31" value={item.dueDay || ''} onChange={(e) => onUpdateCardConfig(item.id, 'dueDay', parseInt(e.target.value))} className="bg-[#f5f5f7] rounded-lg px-2 py-1 text-[11px] w-12 outline-none border border-[#e8e8ed] text-center text-[#1d1d1f]" placeholder="Dia" />
                  </div>
                </div>
              )}
              {(() => {
                const tracked = trackedByCardId?.[item.id] ?? 0;
                const fatura = item.values[mobileMonthIdx] || 0;
                const prevMonthName = mobileMonthIdx > 0 ? months[mobileMonthIdx - 1]?.monthName : null;
                if (!tracked || !prevMonthName) return null;

                if (!fatura) {
                  return (
                    <div className="mt-2 ml-7 px-2.5 py-2 bg-[#f0fad0] border border-[rgba(122,184,0,0.2)] rounded-xl text-[10px]">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[#6e6e73] leading-relaxed flex-1">
                          <span className="font-black text-[#7ab800] k-num">{formatCurrency(tracked)}</span> rastreado de {prevMonthName} já vai nesta fatura. Lance o valor total acima.
                        </p>
                        <button onClick={() => setTrackedInfoCardId(item.id)} className="text-[#7ab800] shrink-0 mt-0.5">
                          <i className="fas fa-question-circle text-sm"></i>
                        </button>
                      </div>
                    </div>
                  );
                }

                const naoIdentificado = Math.max(0, fatura - tracked);
                return (
                  <div className="mt-2 ml-7 px-2.5 py-2 bg-[#f0fad0] border border-[rgba(122,184,0,0.2)] rounded-xl space-y-1 text-[10px]">
                    <div className="flex justify-between items-center">
                      <span className="text-[#6e6e73]">Rastreado ({prevMonthName})</span>
                      <span className="text-[#7ab800] font-black k-num">− {formatCurrency(tracked)}</span>
                    </div>
                    <div className="flex justify-between items-center border-t border-[rgba(122,184,0,0.15)] pt-1">
                      <span className="text-[#aeaeb2] font-black uppercase text-[9px] tracking-wider">A categorizar</span>
                      <span className={`font-black k-num ${naoIdentificado === 0 ? 'text-[#7ab800]' : 'text-orange-500'}`}>{formatCurrency(naoIdentificado)}</span>
                    </div>
                  </div>
                );
              })()}
              {category === CategoryType.FIXED_EXPENSE && onUpdateCardConfig && (
                <div className="mt-2 ml-7 flex items-center gap-2">
                  <i className="fas fa-calendar-day text-[#aeaeb2] text-[9px]"></i>
                  <label className="text-[9px] font-black text-[#aeaeb2] uppercase">Pagar dia</label>
                  <select
                    value={item.dueDay || ''}
                    onChange={(e) => onUpdateCardConfig(item.id, 'dueDay', parseInt(e.target.value))}
                    className="bg-[#f5f5f7] rounded-lg px-2 py-1 text-[11px] outline-none border border-[#e8e8ed] text-[#1d1d1f] text-center"
                  >
                    <option value="">--</option>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              )}
              {showLinkOption && onLinkCard && (() => {
                const hasPayment = !!(item.linkType || item.linkedCardId);
                const isOpen = openPaymentItemId === item.id;
                let paymentLabel = '';
                if (item.linkType === LinkType.DEBIT) paymentLabel = 'Débito / Dinheiro';
                else if (item.linkedCardId) {
                  const card = allCards.find(c => c.id === item.linkedCardId);
                  const typeLabel = item.linkType === LinkType.INSTALLMENT ? 'Parcelado' : item.linkType === LinkType.ONCE ? 'À Vista' : 'Recorrente';
                  paymentLabel = `${card?.description || 'Cartão'} · ${typeLabel}`;
                } else if (item.linkType === LinkType.INSTALLMENT) {
                  paymentLabel = 'Crédito Parcelado';
                } else if (item.linkType === LinkType.ONCE) {
                  paymentLabel = 'Crédito à Vista';
                } else if (item.linkType === LinkType.RECURRING) {
                  paymentLabel = 'Crédito Recorrente';
                }
                return (
                  <div className="mt-2 ml-7">
                    {!isOpen ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => setOpenPaymentItemId(item.id)}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[9px] font-black uppercase transition-all active:scale-95 ${
                            hasPayment
                              ? 'bg-[#f0fad0] border border-[rgba(122,184,0,0.25)] text-[#7ab800]'
                              : 'bg-[#fff0f0] border border-[rgba(255,59,48,0.2)] text-[#ff3b30]'
                          }`}
                        >
                          <i className={`fas ${hasPayment ? 'fa-check-circle' : 'fa-exclamation-circle'} text-[10px]`}></i>
                          {hasPayment ? paymentLabel : 'Forma de pagamento pendente'}
                          <i className="fas fa-chevron-down text-[8px] opacity-50 ml-0.5"></i>
                        </button>
                        {category !== CategoryType.VARIABLE_EXPENSE && (() => {
                          const linkedCard = item.linkedCardId ? allCards.find(c => c.id === item.linkedCardId) : null;
                          const isCardLinked = !!(linkedCard && item.linkType !== LinkType.DEBIT);
                          const isCommitted = item.linkType === LinkType.INSTALLMENT;
                          const mobileVal = item.values[mobileMonthIdx];
                          const displayValue = realSpent > 0 ? realSpent : (isCardLinked && isCommitted && mobileVal > 0 ? mobileVal : 0);
                          if (!displayValue) return realSpent > 0 ? (
                            <span className={`text-[10px] font-black px-2 py-1 rounded-xl k-num ${isOver ? 'bg-[#fff0f0] text-[#ff3b30]' : 'bg-[#f0f4ff] text-[#007aff]'}`}>
                              {formatCurrency(realSpent)}
                            </span>
                          ) : null;
                          let faturaLabel = '';
                          if (isCardLinked) {
                            if (linkedCard!.closingDay) {
                              const todayDay = new Date().getDate();
                              const faturaMonthIdx = todayDay >= linkedCard!.closingDay ? mobileMonthIdx + 1 : mobileMonthIdx;
                              const faturaMonthData = months[Math.min(faturaMonthIdx, months.length - 1)];
                              faturaLabel = faturaMonthData ? `→ Fatura ${faturaMonthData.monthName}` : linkedCard!.description?.split(' ')[0] || 'Cartão';
                            } else {
                              faturaLabel = `↗ ${linkedCard!.description?.split(' ')[0] || 'Cartão'}`;
                            }
                          }
                          return (
                            <span className={`text-[10px] font-black px-2 py-1 rounded-xl k-num flex items-center gap-1 flex-wrap ${realSpent > 0 && isOver ? 'bg-[#fff0f0] text-[#ff3b30]' : 'bg-[#f0f4ff] text-[#007aff]'}`}>
                              {faturaLabel && <span className="text-[8px] font-bold opacity-60 normal-case">{faturaLabel} ·</span>}
                              {formatCurrency(displayValue)}
                            </span>
                          );
                        })()}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1.5 bg-[#f5f5f7] border border-[#e8e8ed] rounded-xl p-2.5">
                        <div className="text-[8px] font-black text-[#aeaeb2] uppercase tracking-widest">Forma de pagamento</div>
                        {/* Row 1: Débito | Cartão | ✕ */}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { onLinkCard!(item.id, '', LinkType.DEBIT); setOpenPaymentItemId(null); }}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase active:scale-95 transition-all shrink-0 ${
                              item.linkType === LinkType.DEBIT ? 'bg-[#7ab800] text-white' : 'bg-white border border-[#e8e8ed] text-[#6e6e73]'
                            }`}
                          >
                            <i className="fas fa-wallet mr-1"></i>Débito
                          </button>
                          <select
                            className="flex-1 text-[10px] bg-white border border-[#e8e8ed] text-[#1d1d1f] rounded-lg px-2 py-1.5 outline-none focus:border-[#7ab800]"
                            value={item.linkedCardId || ''}
                            onChange={(e) => {
                              if (e.target.value) onLinkCard!(item.id, e.target.value, item.linkType === LinkType.INSTALLMENT ? LinkType.INSTALLMENT : LinkType.RECURRING);
                            }}
                          >
                            <option value="">Crédito: selecionar cartão...</option>
                            {allCards.map(card => <option key={card.id} value={card.id}>{card.description || 'Cartão S/N'}</option>)}
                          </select>
                          <button onClick={() => setOpenPaymentItemId(null)} className="text-[#aeaeb2] active:text-[#1d1d1f] p-0.5 shrink-0">
                            <i className="fas fa-times text-[10px]"></i>
                          </button>
                        </div>
                        {/* Row 2: Type selector + OK — appears only when a card is selected */}
                        {item.linkedCardId && item.linkType !== LinkType.DEBIT && (
                          <div className="flex items-center gap-2 pl-[72px]">
                            <select
                              className="flex-1 text-[10px] bg-white border border-[#e8e8ed] text-[#1d1d1f] rounded-lg px-2 py-1.5 outline-none focus:border-[#7ab800]"
                              value={item.linkType || LinkType.RECURRING}
                              onChange={(e) => {
                                const newType = e.target.value as LinkType;
                                if (newType === LinkType.INSTALLMENT) {
                                  setCardInstallModal({ itemId: item.id, cardId: item.linkedCardId!, totalInput: '', currentInput: '1' });
                                  setOpenPaymentItemId(null);
                                } else {
                                  onLinkCard!(item.id, item.linkedCardId!, newType);
                                }
                              }}
                            >
                              <option value={LinkType.ONCE}>À Vista</option>
                              <option value={LinkType.RECURRING}>Recorrente</option>
                              <option value={LinkType.INSTALLMENT}>Parcelado</option>
                            </select>
                            <button
                              onClick={() => setOpenPaymentItemId(null)}
                              className="px-3 py-1.5 text-[#182200] font-black rounded-lg text-[10px] uppercase active:scale-95 transition-all shrink-0"
                              style={{background:'linear-gradient(180deg,#c5f23a,#8cc400)'}}
                            >
                              OK
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* Replicate button — only for categories that repeat every month. Fixed to the
                  card's bottom-right corner, slightly above the edge so it doesn't collide
                  with the payment-method row or future per-card spent totals. */}
              {canReplicate && (
                <button
                  data-tour="replicate-btn"
                  onClick={() => handleReplicateWithToast(item.id, mobileMonthIdx)}
                  className="absolute bottom-2 right-3 w-5 h-5 rounded-full flex items-center justify-center shrink-0 active:scale-90 shadow-sm"
                  style={{background:'linear-gradient(180deg,#c5f23a,#8cc400)',boxShadow:'0 2px 6px rgba(130,192,0,0.4)'}}
                  title="Replicar para todos os meses"
                >
                  <i className="fas fa-copy text-[7px] text-[#182200]"></i>
                </button>
              )}
            </div>
          );
        })}
        <div className="px-3 py-3 flex justify-center">
          <button
            onClick={handleAddWithInstruction}
            className="w-8 h-8 rounded-full flex items-center justify-center active:scale-90"
            style={{background:'linear-gradient(180deg,#c5f23a,#8cc400)',boxShadow:'0 3px 10px rgba(130,192,0,0.4)'}}
            title="Adicionar linha"
          >
            <i className="fas fa-plus text-[10px] text-[#182200]"></i>
          </button>
        </div>
        {items.length === 0 && (
          <div className="px-4 py-4 text-center text-[#aeaeb2] text-sm">Nenhum item adicionado</div>
        )}
        {items.length > 0 && (
          <div className={`px-4 py-3 flex justify-between items-center ${category === CategoryType.CREDIT_CARD ? 'bg-[#fff8f0] border-t border-[rgba(255,149,0,0.2)]' : 'bg-[#f5f5f7] border-t border-[#e8e8ed]'}`}>
            <span className={`text-[10px] font-black uppercase tracking-widest ${category === CategoryType.CREDIT_CARD ? 'text-orange-500' : 'text-[#6e6e73]'}`}>
              {category === CategoryType.CREDIT_CARD ? 'Total Faturas do Mês' : 'Total'}
            </span>
            <span className={`font-black k-num text-sm ${category === CategoryType.CREDIT_CARD ? 'text-orange-500' : 'text-[#7ab800]'}`}>
              {formatCurrency(items.reduce((sum, i) => sum + (i.values[mobileMonthIdx] || 0), 0))}
            </span>
          </div>
        )}
      </div>

      {/* ── DESKTOP TABLE ──────────────────────────────────────────── */}
      <div className="hidden lg:block print:block overflow-x-auto print:overflow-visible">
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-100 text-gray-700 uppercase font-semibold">
            <tr>
              <th className="p-4 border-b w-10"></th>
              <th className="p-4 border-b min-w-[220px]">Descrição</th>
              {months.map((m, idx) => (
                <th key={idx} className="p-4 border-b text-center min-w-[120px] border-l group relative">
                  <div className="flex flex-col">
                    <span>{m.monthName}</span>
                    <span className="text-[8px] opacity-40 font-black mt-1">{m.year}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.filter(item => showHidden || !hiddenItemIds.has(item.id)).map((item) => (
              <tr key={item.id} className={`border-b transition-colors ${hiddenItemIds.has(item.id) ? 'opacity-35 bg-gray-50' : 'hover:bg-gray-50'}`}>
                <td className="p-2 text-center">
                  <div className="flex flex-col items-center gap-0.5">
                    {onMoveItem && !hiddenItemIds.has(item.id) && (
                      <button onClick={() => onMoveItem(item.id, 'up')} className="text-gray-300 hover:text-green-400 transition-colors px-1" title="Mover para cima">
                        <i className="fas fa-chevron-up text-[9px]"></i>
                      </button>
                    )}
                    <button onClick={() => onRemoveItem(item.id)} className="text-red-400/50 hover:text-red-500 transition-colors p-1"><i className="fas fa-trash-alt text-xs"></i></button>
                    <button onClick={() => toggleHideRow(item.id)} className={`transition-colors p-1 ${hiddenItemIds.has(item.id) ? 'text-green-500 hover:text-green-400' : 'text-gray-300 hover:text-gray-500'}`} title={hiddenItemIds.has(item.id) ? 'Reexibir linha' : 'Ocultar linha'}>
                      <i className={`fas ${hiddenItemIds.has(item.id) ? 'fa-eye' : 'fa-eye-slash'} text-xs`}></i>
                    </button>
                    {onMoveItem && !hiddenItemIds.has(item.id) && (
                      <button onClick={() => onMoveItem(item.id, 'down')} className="text-gray-300 hover:text-green-400 transition-colors px-1" title="Mover para baixo">
                        <i className="fas fa-chevron-down text-[9px]"></i>
                      </button>
                    )}
                  </div>
                </td>
                <td className="p-2">
                  <div className="flex flex-col gap-1">
                    <input
                      type="text"
                      defaultValue={item.description}
                      key={item.id}
                      onBlur={(e) => onUpdateDescription(item.id, e.target.value)}
                      onChange={(e) => onUpdateDescription(item.id, e.target.value)}
                      className="w-full bg-transparent border-b border-transparent focus:border-green-400 outline-none p-2 text-gray-900 font-medium"
                      placeholder="Nome do item..."
                    />
                    {category === CategoryType.CREDIT_CARD && onUpdateCardConfig && (
                      <div className="flex gap-2 px-2 pb-1" data-tour="card-config">
                        <div className="flex flex-col">
                          <label className="text-[8px] font-black text-zinc-400 uppercase">Fechamento</label>
                          <input
                            type="number" min="1" max="31"
                            value={item.closingDay || ''}
                            onChange={(e) => onUpdateCardConfig(item.id, 'closingDay', parseInt(e.target.value))}
                            className="bg-zinc-100 rounded px-1 text-[10px] w-12 outline-none border border-zinc-200 focus:border-green-400"
                            placeholder="Dia"
                          />
                        </div>
                        <div className="flex flex-col">
                          <label className="text-[8px] font-black text-zinc-400 uppercase">Vencimento</label>
                          <input
                            type="number" min="1" max="31"
                            value={item.dueDay || ''}
                            onChange={(e) => onUpdateCardConfig(item.id, 'dueDay', parseInt(e.target.value))}
                            className="bg-zinc-100 rounded px-1 text-[10px] w-12 outline-none border border-zinc-200 focus:border-green-400"
                            placeholder="Dia"
                          />
                        </div>
                      </div>
                    )}
                    {category === CategoryType.FIXED_EXPENSE && onUpdateCardConfig && (
                      <div className="flex items-center gap-2 px-2 pb-1">
                        <i className="fas fa-calendar-day text-zinc-400 text-[9px]"></i>
                        <label className="text-[8px] font-black text-zinc-400 uppercase">Pagar dia</label>
                        <select
                          value={item.dueDay || ''}
                          onChange={(e) => onUpdateCardConfig(item.id, 'dueDay', parseInt(e.target.value))}
                          className="bg-zinc-100 rounded px-1 text-[10px] outline-none border border-zinc-200 focus:border-green-400 text-zinc-700"
                        >
                          <option value="">--</option>
                          {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {showLinkOption && onLinkCard && (() => {
                      const hasPayment = !!(item.linkType || item.linkedCardId);
                      const isOpen = openPaymentItemId === item.id;
                      let paymentLabel = '';
                      if (item.linkType === LinkType.DEBIT) paymentLabel = 'Débito';
                      else if (item.linkedCardId) {
                        const card = allCards.find(c => c.id === item.linkedCardId);
                        const typeLabel = item.linkType === LinkType.INSTALLMENT ? 'Parcelado' : item.linkType === LinkType.ONCE ? 'À Vista' : 'Recorrente';
                        paymentLabel = `${card?.description || 'Cartão'} · ${typeLabel}`;
                      } else if (item.linkType === LinkType.INSTALLMENT) {
                        paymentLabel = 'Crédito Parcelado';
                      } else if (item.linkType === LinkType.ONCE) {
                        paymentLabel = 'Crédito à Vista';
                      } else if (item.linkType === LinkType.RECURRING) {
                        paymentLabel = 'Crédito Recorrente';
                      }
                      return (
                      <div className="px-2 pb-1 flex flex-col gap-1">
                        <button
                          onClick={() => setOpenPaymentItemId(isOpen ? null : item.id)}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-black uppercase w-fit transition-all ${
                            hasPayment
                              ? 'bg-green-50 text-green-700 border border-green-200'
                              : 'bg-red-50 text-red-500 border border-red-200'
                          }`}
                        >
                          <i className={`fas ${hasPayment ? 'fa-check-circle' : 'fa-exclamation-circle'} text-[8px]`}></i>
                          {hasPayment ? paymentLabel : 'Pagamento pendente'}
                          <i className="fas fa-pen text-[7px] ml-0.5 opacity-50"></i>
                        </button>
                        {isOpen && (
                        <div className="flex items-center gap-1 flex-wrap mt-0.5">
                          <button
                            onClick={() => { onLinkCard(item.id, '', LinkType.DEBIT); setOpenPaymentItemId(null); }}
                            className="px-2 py-0.5 rounded text-[9px] font-black bg-zinc-100 hover:bg-zinc-200 text-zinc-700 border border-zinc-300 transition-all"
                          >
                            Débito
                          </button>
                          <select
                            className="text-[9px] bg-zinc-50 border border-zinc-300 rounded px-1 py-0.5 outline-none focus:border-green-400"
                            value={item.linkedCardId || ''}
                            onChange={(e) => {
                              if (e.target.value) { onLinkCard(item.id, e.target.value, item.linkType === LinkType.INSTALLMENT ? LinkType.INSTALLMENT : LinkType.RECURRING); }
                            }}
                          >
                            <option value="">Crédito: cartão...</option>
                            {allCards.map(card => <option key={card.id} value={card.id}>{card.description || 'S/N'}</option>)}
                          </select>
                          {item.linkedCardId && (
                            <select
                              className="text-[9px] bg-zinc-50 border border-zinc-300 rounded px-1 py-0.5 outline-none"
                              value={item.linkType || LinkType.RECURRING}
                              onChange={(e) => {
                                const t = e.target.value as LinkType;
                                if (t === LinkType.INSTALLMENT) {
                                  setCardInstallModal({ itemId: item.id, cardId: item.linkedCardId!, totalInput: '', currentInput: '1' });
                                } else {
                                  onLinkCard(item.id, item.linkedCardId!, t);
                                }
                                setOpenPaymentItemId(null);
                              }}
                            >
                              <option value={LinkType.ONCE}>À Vista</option>
                              <option value={LinkType.RECURRING}>Recorrente</option>
                              <option value={LinkType.INSTALLMENT}>Parcelado</option>
                            </select>
                          )}
                          <button onClick={() => setOpenPaymentItemId(null)} className="text-zinc-400 hover:text-zinc-700 p-0.5">
                            <i className="fas fa-times text-[9px]"></i>
                          </button>
                        </div>
                        )}
                      </div>
                    );
                    })()}
                  </div>
                </td>
                {item.values.map((val, mIdx) => {
                  const isPaid = item.paidStatus[mIdx];
                  const isIncome = category === CategoryType.INCOME;
                  const monthData = months[mIdx];
                  const monthKey = `${monthData.year}-${monthData.index}`;
                  const partials = item.partialExpenses?.[monthKey] || [];
                  const realSpent = partials.reduce((acc, p) => acc + p.value, 0);
                  const isOver = realSpent > val && val > 0;

                  return (
                    <td key={mIdx} className={`p-2 border-l text-center transition-colors focus-within:!bg-white ${isPaid ? 'bg-green-50/30' : val === 0 ? 'bg-zinc-100' : ''}`}>
                      <div className="flex flex-col gap-1.5 items-center">
                        <div className="relative w-full group">
                          <CurrencyInput
                            value={val}
                            onChange={(float) => {
                              onUpdateValue(item.id, mIdx, String(float));
                              checkInstallments(item.id);
                            }}
                            className={`w-full text-center bg-transparent border-none focus:ring-0 outline-none transition-all text-sm ${isPaid ? 'text-green-700 font-bold' : val === 0 ? 'text-zinc-400' : 'text-gray-900'}`}
                          />
                          <button
                            onClick={() => onReplicateValue(item.id, mIdx)}
                            className="absolute -right-1 -top-1 opacity-0 group-hover:opacity-100 bg-green-400 text-black w-4 h-4 rounded-full flex items-center justify-center text-[8px] shadow-sm transition-opacity hover:scale-110 z-10"
                          >
                            <i className="fas fa-copy"></i>
                          </button>
                        </div>
                        {category !== CategoryType.VARIABLE_EXPENSE && (() => {
                          const linkedCard = item.linkedCardId ? allCards.find(c => c.id === item.linkedCardId) : null;
                          const isCardLinked = !!(linkedCard && item.linkType !== LinkType.DEBIT);
                          const isCommitted = item.linkType === LinkType.INSTALLMENT;
                          const displayValue = realSpent > 0 ? realSpent : (isCardLinked && isCommitted && val > 0 ? val : 0);
                          if (!displayValue) return null;
                          let faturaLabel = '';
                          if (isCardLinked) {
                            if (linkedCard!.closingDay) {
                              const todayDay = new Date().getDate();
                              const faturaMonthIdx = todayDay >= linkedCard!.closingDay ? mIdx + 1 : mIdx;
                              const faturaMonthData = months[Math.min(faturaMonthIdx, months.length - 1)];
                              faturaLabel = faturaMonthData ? `→ Fatura ${faturaMonthData.monthName}` : linkedCard!.description?.split(' ')[0] || 'Cartão';
                            } else {
                              faturaLabel = `↗ ${linkedCard!.description?.split(' ')[0] || 'Cartão'}`;
                            }
                          }
                          return (
                            <div className={`text-[9px] font-black px-1.5 py-0.5 rounded flex items-center gap-1 flex-wrap ${realSpent > 0 && isOver ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                              {faturaLabel && <span className="text-[8px] opacity-60 normal-case font-bold">{faturaLabel} ·</span>}
                              {formatCurrency(displayValue)}
                            </div>
                          );
                        })()}
                        {category === CategoryType.CREDIT_CARD && mIdx > 0 && (() => {
                          const tracked = trackedByCardAllMonths?.[item.id]?.[mIdx] ?? 0;
                          if (!tracked) return null;
                          const prevMonthName = months[mIdx - 1]?.monthName;
                          if (!prevMonthName) return null;
                          if (!val) {
                            return (
                              <div className="mt-1 rounded-lg border border-dashed border-[rgba(122,184,0,0.5)] bg-[#f0fad0]/70 px-1.5 py-1 text-center">
                                <div className="text-[7px] text-[#aeaeb2] font-bold uppercase tracking-wide">≈ estimado</div>
                                <div className="text-[9px] text-[#7ab800] font-black k-num">{formatCurrency(tracked)}</div>
                                <div className="text-[7px] text-[#aeaeb2]">de {prevMonthName}</div>
                              </div>
                            );
                          }
                          const aCategorizar = Math.max(0, val - tracked);
                          return (
                            <div className="mt-1 border border-[#e8e8ed] rounded-lg px-1.5 py-1 space-y-0.5">
                              <div className="flex justify-between items-center gap-1">
                                <span className="text-[7px] text-[#aeaeb2] font-bold uppercase">Identif.</span>
                                <span className="text-[8px] text-[#7ab800] font-black k-num">{formatCurrency(tracked)}</span>
                              </div>
                              <div className="flex justify-between items-center gap-1 border-t border-[#f0f0f0] pt-0.5">
                                <span className="text-[7px] text-[#aeaeb2] font-bold uppercase">A categ.</span>
                                <span className={`text-[8px] font-black k-num ${aCategorizar === 0 ? 'text-[#7ab800]' : 'text-orange-500'}`}>{formatCurrency(aCategorizar)}</span>
                              </div>
                            </div>
                          );
                        })()}
                        {!isIncome && (
                          <button
                            onClick={() => onTogglePaid(item.id, mIdx)}
                            className={`w-4 h-4 rounded-full border-2 transition-all duration-300 ${isPaid ? 'bg-green-500 border-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] flex items-center justify-center' : 'bg-transparent border-gray-300 hover:border-green-400'}`}
                          >
                            {isPaid && <i className="fas fa-check text-[8px] text-white"></i>}
                          </button>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td colSpan={months.length + 2} className="p-2 border-t border-zinc-100 text-center">
                <button
                  onClick={handleAddWithInstruction}
                  className="w-6 h-6 rounded-full bg-green-400 inline-flex items-center justify-center active:scale-90 shadow-sm hover:bg-green-300 transition-colors"
                  title="Adicionar linha"
                >
                  <i className="fas fa-plus text-[9px] text-black"></i>
                </button>
              </td>
            </tr>
          </tbody>
          {(() => {
            const hiddenCount = items.filter(i => hiddenItemIds.has(i.id)).length;
            if (hiddenCount === 0) return null;
            return (
              <tfoot>
                <tr className="bg-gray-50 border-t border-dashed border-gray-300">
                  <td colSpan={months.length + 2} className="px-5 py-2">
                    <button
                      onClick={() => setShowHidden(v => !v)}
                      className="text-[11px] text-gray-400 hover:text-green-500 transition-colors flex items-center gap-2 font-medium"
                    >
                      <i className={`fas ${showHidden ? 'fa-eye-slash' : 'fa-eye'} text-[10px]`}></i>
                      {showHidden
                        ? `Ocultar ${hiddenCount} linha${hiddenCount > 1 ? 's' : ''} oculta${hiddenCount > 1 ? 's' : ''}`
                        : `${hiddenCount} linha${hiddenCount > 1 ? 's' : ''} oculta${hiddenCount > 1 ? 's' : ''} — clique para ver`}
                    </button>
                  </td>
                </tr>
              </tfoot>
            );
          })()}
          {category === CategoryType.CREDIT_CARD && items.length > 0 && (
            <tfoot>
              <tr className="bg-orange-50/60 border-t-2 border-orange-200">
                <td className="p-3"></td>
                <td className="p-3 font-black text-xs uppercase text-orange-500 tracking-widest">
                  <i className="fas fa-credit-card mr-2"></i>Total Faturas
                </td>
                {months.map((_, mIdx) => (
                  <td key={mIdx} className="p-3 text-center border-l font-black font-mono text-orange-500">
                    {formatCurrency(items.reduce((sum, i) => sum + (i.values[mIdx] || 0), 0))}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
          {category === CategoryType.FIXED_EXPENSE && items.length > 0 && (
            <tfoot>
              <tr className="bg-red-50/50 border-t-2 border-red-200">
                <td className="p-3"></td>
                <td className="p-3 font-black text-xs uppercase text-red-500 tracking-widest">
                  <i className="fas fa-file-invoice-dollar mr-2"></i>Total Contas Fixas
                </td>
                {months.map((_, mIdx) => (
                  <td key={mIdx} className="p-3 text-center border-l font-black font-mono text-red-500">
                    {formatCurrency(items.reduce((sum, i) => sum + (i.values[mIdx] || 0), 0))}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};

export default BlockSection;
