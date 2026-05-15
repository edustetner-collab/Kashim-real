
import React, { useState, useEffect, useRef } from 'react';
import { CategoryType, FinanceItem, LinkType } from '../types';
import { formatCurrency } from '../constants';

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
  onUpdateValue: (id: string, monthIdx: number, value: string) => void;
  onTogglePaid: (id: string, monthIdx: number) => void;
  onRemoveItem: (id: string) => void;
  onUpdateDescription: (id: string, desc: string) => void;
  onReplicateValue: (id: string, monthIdx: number) => void;
  onLinkCard?: (itemId: string, cardId: string, linkType?: LinkType) => void;
  onUpdateCardConfig?: (id: string, field: 'closingDay' | 'dueDay', value: number) => void;
  onMoveItem?: (id: string, direction: 'up' | 'down') => void;
  trackedByCardId?: Record<string, number>;
}

const BlockSection: React.FC<BlockSectionProps> = ({
  title, subtitle, category, items, allCards = [], months, totalIncome, mobileMonthIdx = 0,
  onAddItem, onUpdateValue, onTogglePaid, onRemoveItem, onUpdateDescription, onReplicateValue, onLinkCard,
  onUpdateCardConfig, onMoveItem, trackedByCardId
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [showInstructionModal, setShowInstructionModal] = useState(false);
  const [installmentWarning, setInstallmentWarning] = useState<string | null>(null);
  const [paidToast, setPaidToast] = useState<string | null>(null);
  const [replicateToast, setReplicateToast] = useState(false);
  const [varInstallModal, setVarInstallModal] = useState<{ step: 'ask' | 'count' } | null>(null);
  const [varInstallCount, setVarInstallCount] = useState('');
  const [cardInstallModal, setCardInstallModal] = useState<{
    itemId: string; cardId: string; totalInput: string; currentInput: string;
  } | null>(null);
  const [openPaymentItemId, setOpenPaymentItemId] = useState<string | null>(null);
  const timersRef = useRef<Record<string, number>>({});
  const itemsRef = useRef<FinanceItem[]>(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

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
    const skipModal = localStorage.getItem(`skip_modal_${category}`);
    if (!skipModal) {
      setShowInstructionModal(true);
    } else {
      executeAdd();
    }
  };

  const executeAdd = (installments?: number) => {
    setShowInstructionModal(false);
    setVarInstallModal(null);
    if (category === CategoryType.PERSONAL_LEISURE) {
      const suggestedLeisure = totalIncome * 0.15;
      onAddItem(category, {
        description: 'Lazer e Despesas Pessoais',
        values: new Array(12).fill(suggestedLeisure)
      });
    } else if (category === CategoryType.VARIABLE_EXPENSE && installments && installments > 1) {
      onAddItem(category, { values: new Array(12).fill(0) });
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

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-2 transition-all hover:shadow-md">

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

      {/* Variable expense installment modal */}
      {varInstallModal && (
        <div className="fixed inset-0 z-[200] flex items-end p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-2xl">
            {varInstallModal.step === 'ask' ? (
              <>
                <h3 className="text-white font-black uppercase italic tracking-tight text-lg mb-2">Este gasto é parcelado?</h3>
                <p className="text-zinc-400 text-sm mb-6">Se sim, posso já preencher os meses automaticamente.</p>
                <div className="flex gap-3">
                  <button onClick={() => setVarInstallModal({ step: 'count' })} className="flex-1 bg-yellow-500 active:bg-yellow-400 text-black font-black py-3.5 rounded-2xl text-sm uppercase">Sim, é parcelado</button>
                  <button onClick={() => executeAdd()} className="flex-1 bg-zinc-800 active:bg-zinc-700 text-zinc-300 font-black py-3.5 rounded-2xl text-sm uppercase">Não, gasto único</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-white font-black uppercase italic tracking-tight text-lg mb-2">Em quantas parcelas?</h3>
                <p className="text-zinc-400 text-sm mb-4">O valor mensal será preenchido automaticamente nos próximos meses.</p>
                <div className="bg-zinc-800 border-2 border-yellow-500 rounded-2xl flex items-center px-4 mb-5">
                  <input
                    type="number"
                    min="2"
                    max="48"
                    value={varInstallCount}
                    onChange={e => setVarInstallCount(e.target.value)}
                    placeholder="Ex: 12"
                    className="flex-1 bg-transparent py-3.5 text-white font-mono text-lg font-black outline-none placeholder:text-zinc-600 text-center"
                    autoFocus
                  />
                  <span className="text-zinc-500 text-sm font-bold">x</span>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setVarInstallModal({ step: 'ask' })} className="w-12 h-12 bg-zinc-800 rounded-xl flex items-center justify-center shrink-0">
                    <i className="fas fa-arrow-left text-zinc-400"></i>
                  </button>
                  <button
                    onClick={() => { executeAdd(parseInt(varInstallCount) || 1); setVarInstallCount(''); }}
                    className="flex-1 bg-yellow-500 active:bg-yellow-400 text-black font-black py-3.5 rounded-2xl text-sm uppercase"
                  >Confirmar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

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
              <button onClick={handleCardInstallConfirm} className="flex-1 bg-yellow-500 active:bg-yellow-400 text-black font-black py-3.5 rounded-2xl text-sm uppercase">
                Confirmar e preencher
              </button>
            </div>
          </div>
        </div>
      )}

      {installmentWarning && (
        <div className="fixed bottom-6 right-6 z-[300] max-w-sm w-full bg-zinc-900 border border-yellow-600/40 rounded-2xl p-4 shadow-2xl animate-in slide-in-from-bottom-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-yellow-500/10 rounded-xl flex items-center justify-center shrink-0">
              <i className="fas fa-exclamation-triangle text-yellow-500 text-sm"></i>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-yellow-500 font-black text-xs uppercase tracking-widest mb-1">Aviso de classificação</p>
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
            <div className="w-16 h-16 bg-yellow-500/10 rounded-2xl flex items-center justify-center mb-6">
              <i className={`fas ${
                category === CategoryType.INCOME ? 'fa-wallet' :
                category === CategoryType.CREDIT_CARD ? 'fa-credit-card' : 
                category === CategoryType.FIXED_EXPENSE ? 'fa-anchor' :
                category === CategoryType.VARIABLE_EXPENSE ? 'fa-random' : 'fa-cocktail'
              } text-2xl text-yellow-500`}></i>
            </div>
            <h3 className="text-white text-xl font-black uppercase italic tracking-tighter mb-4">Instruções: {title}</h3>
            
            <div className="space-y-4 text-zinc-300 text-sm mb-8 leading-relaxed">
              {category === CategoryType.INCOME && (
                <div className="space-y-3">
                  <p>Aqui você vai inserir suas fontes de renda.</p>
                  <p className="bg-yellow-500/10 p-4 rounded-xl border border-yellow-500/20 text-yellow-500 font-bold">
                    DICA: Coloque sempre o MÍNIMO que você garante que ganha. Depois, você vai atualizando o que ganhar a mais mês a mês.
                  </p>
                </div>
              )}
              {category === CategoryType.CREDIT_CARD && (
                <>
                  <p>Não detalhe a fatura item por item. Insira o valor total projetado ou real.</p>
                  <p className="text-xs text-zinc-400">Dica: Informe o dia de fechamento para que o sistema saiba se um gasto cairá nesta fatura ou na próxima.</p>
                  <div className="bg-zinc-800 p-4 rounded-xl border border-zinc-700 font-mono text-[11px]">
                    <p className="text-yellow-500 mb-1">Exemplo Banco Inter:</p>
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
                  <div className="bg-yellow-500/10 p-3 rounded-lg border border-yellow-500/20 text-yellow-200 text-xs italic">
                    Mesmo se estiver no cartão, cite aqui! O sistema abaterá do cartão automaticamente para evitar duplicidade.
                  </div>
                </div>
              )}
              {category === CategoryType.VARIABLE_EXPENSE && (
                <div className="space-y-3">
                  <p>Insira gastos que não são recorrentes ou parcelamentos de <b>curta duração</b> (menos de 12 meses).</p>
                  <p>Ex: Conserto de carro, presente de aniversário, viagem parcelada em 6x.</p>
                </div>
              )}
              {category === CategoryType.PERSONAL_LEISURE && (
                <div className="space-y-3">
                  <p>Este é o seu teto de felicidade. O método sugere no máximo <b>15% da sua renda</b>.</p>
                  <p>Se você costuma passar o lazer no cartão, pode vinculá-lo abaixo para que o sistema organize sua fatura automaticamente.</p>
                  <p>Com base na sua renda atual, sugerimos um teto de: <b className="text-yellow-500">{formatCurrency(totalIncome * 0.15)}</b></p>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  if (category === CategoryType.VARIABLE_EXPENSE) {
                    setShowInstructionModal(false);
                    setVarInstallModal({ step: 'ask' });
                  } else {
                    executeAdd();
                  }
                }}
                className="w-full bg-yellow-600 hover:bg-yellow-500 text-black font-black py-4 rounded-2xl transition-all uppercase text-xs tracking-widest"
              >OK, Continuar</button>
              <button onClick={handleDontShowAgain} className="text-zinc-500 hover:text-white text-[10px] font-bold uppercase tracking-[0.2em] py-2 transition-colors">Não mostrar novamente</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-zinc-900 px-4 py-3 flex items-center gap-3 border-b border-yellow-600/20">
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-yellow-500 font-black text-base uppercase tracking-widest italic leading-tight">{title}</h3>
            {tooltip && (
              <div className="relative shrink-0">
                <button
                  onMouseEnter={() => setShowTooltip(true)}
                  onMouseLeave={() => setShowTooltip(false)}
                  onClick={() => setShowTooltip(v => !v)}
                  className="text-yellow-500/40 hover:text-yellow-500 active:text-yellow-500 transition-colors"
                >
                  <i className="fas fa-question-circle text-sm"></i>
                </button>
                {showTooltip && (
                  <div className="absolute z-50 left-0 top-full mt-2 w-72 bg-[#1a1a1a] text-white p-4 rounded-xl shadow-2xl border border-zinc-800 text-[11px] leading-relaxed animate-in fade-in zoom-in-95">
                    <p className="font-black text-yellow-500 uppercase mb-2 italic">{tooltip.title}</p>
                    <p>{tooltip.text}</p>
                  </div>
                )}
              </div>
            )}
          </div>
          {subtitle && <p className="text-yellow-500/50 text-[9px] uppercase font-bold tracking-wider mt-0.5">{subtitle}</p>}
        </div>
      </div>
      
      {/* ── MOBILE LAYOUT ─────────────────────────────────────────── */}
      <div className="block lg:hidden bg-[#111] divide-y divide-zinc-800/60">
        {items.filter(item => {
          if (item.category === CategoryType.VARIABLE_EXPENSE) {
            return item.values[mobileMonthIdx] > 0;
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

          return (
            <div key={item.id} className={`px-3 py-2.5 ${isPaid ? 'bg-green-900/10' : ''}`}>
              <div className="flex items-center gap-2">
                <button onClick={() => onRemoveItem(item.id)} className="text-red-400/40 active:text-red-500 shrink-0 p-1">
                  <i className="fas fa-trash-alt text-[11px]"></i>
                </button>
                <input
                  type="text"
                  defaultValue={item.description}
                  onBlur={(e) => onUpdateDescription(item.id, e.target.value)}
                  onChange={(e) => onUpdateDescription(item.id, e.target.value)}
                  className="flex-1 bg-transparent text-zinc-300 text-sm outline-none min-w-0 placeholder:text-zinc-600"
                  placeholder="Nome do item..."
                />
                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="number"
                    step="0.01"
                    value={item.values[mobileMonthIdx] === 0 ? '' : item.values[mobileMonthIdx]}
                    onChange={(e) => {
                      onUpdateValue(item.id, mobileMonthIdx, e.target.value);
                      checkInstallments(item.id);
                    }}
                    className={`w-24 text-right rounded-lg px-2.5 py-1.5 text-sm font-mono outline-none border ${isPaid ? 'bg-green-900/20 text-green-400 border-green-800/60' : 'bg-zinc-800 text-white border-zinc-700'}`}
                    placeholder="0,00"
                  />
                  {/* Replicate button — only for categories that repeat every month */}
                  {(category === CategoryType.INCOME || category === CategoryType.FIXED_EXPENSE || category === CategoryType.PERSONAL_LEISURE) && (
                    <button
                      onClick={() => handleReplicateWithToast(item.id, mobileMonthIdx)}
                      className="w-5 h-5 rounded-full bg-yellow-500 flex items-center justify-center shrink-0 active:scale-90 shadow-sm"
                      title="Replicar para todos os meses"
                    >
                      <i className="fas fa-copy text-[7px] text-black"></i>
                    </button>
                  )}
                  {!isIncome && (
                    <button
                      onClick={() => handleTogglePaid(item.id, mobileMonthIdx, isPaid)}
                      className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase transition-all shrink-0 border ${isPaid ? 'bg-green-500/20 text-green-400 border-green-500/40' : 'border-zinc-700 text-zinc-600 active:text-green-400 active:border-green-500/40'}`}
                    >
                      PG
                    </button>
                  )}
                </div>
              </div>
              {category === CategoryType.CREDIT_CARD && onUpdateCardConfig && (
                <div className="mt-2 ml-7 flex gap-4">
                  <div className="flex items-center gap-2">
                    <label className="text-[9px] font-black text-zinc-500 uppercase">Fecha</label>
                    <input type="number" min="1" max="31" value={item.closingDay || ''} onChange={(e) => onUpdateCardConfig(item.id, 'closingDay', parseInt(e.target.value))} className="bg-zinc-800 rounded-lg px-2 py-1 text-[11px] w-12 outline-none border border-zinc-700 text-center text-zinc-300" placeholder="Dia" />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-[9px] font-black text-zinc-500 uppercase">Vence</label>
                    <input type="number" min="1" max="31" value={item.dueDay || ''} onChange={(e) => onUpdateCardConfig(item.id, 'dueDay', parseInt(e.target.value))} className="bg-zinc-800 rounded-lg px-2 py-1 text-[11px] w-12 outline-none border border-zinc-700 text-center text-zinc-300" placeholder="Dia" />
                  </div>
                </div>
              )}
              {(() => {
                const tracked = trackedByCardId?.[item.id] ?? 0;
                const fatura = item.values[mobileMonthIdx] || 0;
                const prevMonthName = mobileMonthIdx > 0 ? months[mobileMonthIdx - 1]?.monthName : null;
                if (!tracked || !fatura || !prevMonthName) return null;
                const naoIdentificado = Math.max(0, fatura - tracked);
                return (
                  <div className="mt-2 ml-7 px-2.5 py-2 bg-green-500/5 border border-green-500/20 rounded-xl space-y-1 text-[10px] font-mono">
                    <div className="flex justify-between items-center">
                      <span className="text-zinc-400">Rastreado ({prevMonthName})</span>
                      <span className="text-green-400 font-black">− {formatCurrency(tracked)}</span>
                    </div>
                    <div className="flex justify-between items-center border-t border-zinc-700/50 pt-1">
                      <span className="text-zinc-500 font-black uppercase text-[9px] tracking-wider">Não identificado</span>
                      <span className={`font-black ${naoIdentificado === 0 ? 'text-green-400' : 'text-orange-300'}`}>{formatCurrency(naoIdentificado)}</span>
                    </div>
                  </div>
                );
              })()}
              {category === CategoryType.FIXED_EXPENSE && onUpdateCardConfig && (
                <div className="mt-2 ml-7 flex items-center gap-2">
                  <i className="fas fa-calendar-day text-zinc-600 text-[9px]"></i>
                  <label className="text-[9px] font-black text-zinc-500 uppercase">Pagar dia</label>
                  <select
                    value={item.dueDay || ''}
                    onChange={(e) => onUpdateCardConfig(item.id, 'dueDay', parseInt(e.target.value))}
                    className="bg-zinc-800 rounded-lg px-2 py-1 text-[11px] outline-none border border-zinc-700 text-zinc-300 text-center"
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
                  paymentLabel = `${card?.description || 'Cartão'} · ${item.linkType === LinkType.INSTALLMENT ? 'Parcelado' : 'Recorrente'}`;
                }
                return (
                  <div className="mt-2 ml-7">
                    {!isOpen ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => setOpenPaymentItemId(item.id)}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[9px] font-black uppercase transition-all active:scale-95 ${
                            hasPayment
                              ? 'bg-green-500/15 border border-green-500/30 text-green-400'
                              : 'bg-red-500/15 border border-red-500/40 text-red-400'
                          }`}
                        >
                          <i className={`fas ${hasPayment ? 'fa-check-circle' : 'fa-exclamation-circle'} text-[10px]`}></i>
                          {hasPayment ? paymentLabel : 'Forma de pagamento pendente'}
                          <i className="fas fa-chevron-down text-[8px] opacity-50 ml-0.5"></i>
                        </button>
                        {realSpent > 0 && (
                          <span className={`text-[10px] font-black px-2 py-1 rounded-xl uppercase ${isOver ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>
                            Realizado: {formatCurrency(realSpent)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1.5 bg-zinc-800/60 border border-zinc-700 rounded-xl p-2.5">
                        <div className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Forma de pagamento</div>
                        {/* Row 1: Débito | Cartão | ✕ */}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { onLinkCard!(item.id, '', LinkType.DEBIT); setOpenPaymentItemId(null); }}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase active:scale-95 transition-all shrink-0 ${
                              item.linkType === LinkType.DEBIT ? 'bg-green-500 text-black' : 'bg-zinc-700 border border-zinc-600 text-zinc-300'
                            }`}
                          >
                            <i className="fas fa-wallet mr-1"></i>Débito
                          </button>
                          <select
                            className="flex-1 text-[10px] bg-zinc-700 border border-zinc-600 text-zinc-300 rounded-lg px-2 py-1.5 outline-none focus:border-yellow-500"
                            value={item.linkedCardId || ''}
                            onChange={(e) => {
                              if (e.target.value) onLinkCard!(item.id, e.target.value, item.linkType === LinkType.INSTALLMENT ? LinkType.INSTALLMENT : LinkType.RECURRING);
                            }}
                          >
                            <option value="">Crédito: selecionar cartão...</option>
                            {allCards.map(card => <option key={card.id} value={card.id}>{card.description || 'Cartão S/N'}</option>)}
                          </select>
                          <button onClick={() => setOpenPaymentItemId(null)} className="text-zinc-500 active:text-white p-0.5 shrink-0">
                            <i className="fas fa-times text-[10px]"></i>
                          </button>
                        </div>
                        {/* Row 2: Type selector + OK — appears only when a card is selected */}
                        {item.linkedCardId && item.linkType !== LinkType.DEBIT && (
                          <div className="flex items-center gap-2 pl-[72px]">
                            <select
                              className="flex-1 text-[10px] bg-zinc-700 border border-zinc-600 text-zinc-300 rounded-lg px-2 py-1.5 outline-none focus:border-yellow-500"
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
                              <option value={LinkType.RECURRING}>Recorrente</option>
                              <option value={LinkType.INSTALLMENT}>Parcelado</option>
                            </select>
                            <button
                              onClick={() => setOpenPaymentItemId(null)}
                              className="px-3 py-1.5 bg-yellow-500 active:bg-yellow-400 text-black font-black rounded-lg text-[10px] uppercase active:scale-95 transition-all shrink-0"
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
            </div>
          );
        })}
        <div className="px-3 py-2.5 flex justify-center">
          <button
            onClick={handleAddWithInstruction}
            className="w-7 h-7 rounded-full bg-yellow-500 flex items-center justify-center active:scale-90 shadow-sm"
            title="Adicionar linha"
          >
            <i className="fas fa-plus text-[10px] text-black"></i>
          </button>
        </div>
        {items.length === 0 && (
          <div className="px-4 py-4 text-center text-zinc-600 text-sm">Nenhum item adicionado</div>
        )}
        {items.length > 0 && (
          <div className={`px-4 py-3 flex justify-between items-center ${category === CategoryType.CREDIT_CARD ? 'bg-orange-500/10 border-t border-orange-500/30' : 'bg-zinc-900/60'}`}>
            <span className={`text-[10px] font-black uppercase tracking-widest ${category === CategoryType.CREDIT_CARD ? 'text-orange-400' : 'text-zinc-500'}`}>
              {category === CategoryType.CREDIT_CARD ? 'Total Faturas do Mês' : 'Total'}
            </span>
            <span className={`font-black font-mono ${category === CategoryType.CREDIT_CARD ? 'text-orange-400 text-base' : 'text-yellow-500'}`}>
              {formatCurrency(items.reduce((sum, i) => sum + (i.values[mobileMonthIdx] || 0), 0))}
            </span>
          </div>
        )}
      </div>

      {/* ── DESKTOP TABLE ──────────────────────────────────────────── */}
      <div className="hidden lg:block overflow-x-auto">
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
            {items.map((item) => (
              <tr key={item.id} className="border-b hover:bg-gray-50 transition-colors">
                <td className="p-2 text-center">
                  <div className="flex flex-col items-center gap-0.5">
                    {onMoveItem && (
                      <button onClick={() => onMoveItem(item.id, 'up')} className="text-gray-300 hover:text-yellow-500 transition-colors px-1" title="Mover para cima">
                        <i className="fas fa-chevron-up text-[9px]"></i>
                      </button>
                    )}
                    <button onClick={() => onRemoveItem(item.id)} className="text-red-400/50 hover:text-red-500 transition-colors p-1"><i className="fas fa-trash-alt text-xs"></i></button>
                    {onMoveItem && (
                      <button onClick={() => onMoveItem(item.id, 'down')} className="text-gray-300 hover:text-yellow-500 transition-colors px-1" title="Mover para baixo">
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
                      className="w-full bg-transparent border-b border-transparent focus:border-yellow-500 outline-none p-2 text-gray-900 font-medium"
                      placeholder="Nome do item..."
                    />
                    {category === CategoryType.CREDIT_CARD && onUpdateCardConfig && (
                      <div className="flex gap-2 px-2 pb-1">
                        <div className="flex flex-col">
                          <label className="text-[8px] font-black text-zinc-400 uppercase">Fechamento</label>
                          <input
                            type="number" min="1" max="31"
                            value={item.closingDay || ''}
                            onChange={(e) => onUpdateCardConfig(item.id, 'closingDay', parseInt(e.target.value))}
                            className="bg-zinc-100 rounded px-1 text-[10px] w-12 outline-none border border-zinc-200 focus:border-yellow-500"
                            placeholder="Dia"
                          />
                        </div>
                        <div className="flex flex-col">
                          <label className="text-[8px] font-black text-zinc-400 uppercase">Vencimento</label>
                          <input
                            type="number" min="1" max="31"
                            value={item.dueDay || ''}
                            onChange={(e) => onUpdateCardConfig(item.id, 'dueDay', parseInt(e.target.value))}
                            className="bg-zinc-100 rounded px-1 text-[10px] w-12 outline-none border border-zinc-200 focus:border-yellow-500"
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
                          className="bg-zinc-100 rounded px-1 text-[10px] outline-none border border-zinc-200 focus:border-yellow-500 text-zinc-700"
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
                        paymentLabel = `${card?.description || 'Cartão'} · ${item.linkType === LinkType.INSTALLMENT ? 'Parcelado' : 'Recorrente'}`;
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
                            className="text-[9px] bg-zinc-50 border border-zinc-300 rounded px-1 py-0.5 outline-none focus:border-yellow-500"
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
                    <td key={mIdx} className={`p-2 border-l text-center transition-all ${isPaid ? 'bg-green-50/30' : ''}`}>
                      <div className="flex flex-col gap-1.5 items-center">
                        <div className="relative w-full group">
                          <input
                            type="number"
                            step="0.01"
                            value={val === 0 ? '' : val}
                            onChange={(e) => {
                              onUpdateValue(item.id, mIdx, e.target.value);
                              checkInstallments(item.id);
                            }}
                            className={`w-full text-center bg-transparent border-none focus:ring-0 outline-none transition-all text-sm ${isPaid ? 'text-green-700 font-bold' : 'text-gray-900'}`}
                            placeholder="0,00"
                          />
                          <button
                            onClick={() => onReplicateValue(item.id, mIdx)}
                            className="absolute -right-1 -top-1 opacity-0 group-hover:opacity-100 bg-yellow-500 text-black w-4 h-4 rounded-full flex items-center justify-center text-[8px] shadow-sm transition-opacity hover:scale-110 z-10"
                          >
                            <i className="fas fa-copy"></i>
                          </button>
                        </div>
                        {realSpent > 0 && <div className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase flex items-center gap-1 ${isOver ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>{formatCurrency(realSpent)}</div>}
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
                  className="w-6 h-6 rounded-full bg-yellow-500 inline-flex items-center justify-center active:scale-90 shadow-sm hover:bg-yellow-400 transition-colors"
                  title="Adicionar linha"
                >
                  <i className="fas fa-plus text-[9px] text-black"></i>
                </button>
              </td>
            </tr>
          </tbody>
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
        </table>
      </div>
    </div>
  );
};

export default BlockSection;
