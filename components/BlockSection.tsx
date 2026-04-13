
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
  onAddItem: (category: CategoryType, customData?: Partial<FinanceItem>) => void;
  onUpdateValue: (id: string, monthIdx: number, value: string) => void;
  onTogglePaid: (id: string, monthIdx: number) => void;
  onRemoveItem: (id: string) => void;
  onUpdateDescription: (id: string, desc: string) => void;
  onReplicateValue: (id: string, monthIdx: number) => void;
  onLinkCard?: (itemId: string, cardId: string, linkType?: LinkType) => void;
  onUpdateCardConfig?: (id: string, field: 'closingDay' | 'dueDay', value: number) => void;
  onMoveItem?: (id: string, direction: 'up' | 'down') => void;
}

const BlockSection: React.FC<BlockSectionProps> = ({
  title, subtitle, category, items, allCards = [], months, totalIncome,
  onAddItem, onUpdateValue, onTogglePaid, onRemoveItem, onUpdateDescription, onReplicateValue, onLinkCard,
  onUpdateCardConfig, onMoveItem
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [showInstructionModal, setShowInstructionModal] = useState(false);
  const [installmentWarning, setInstallmentWarning] = useState<string | null>(null);
  const timersRef = useRef<Record<string, number>>({});
  const itemsRef = useRef<FinanceItem[]>(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const handleAddWithInstruction = () => {
    const skipModal = localStorage.getItem(`skip_modal_${category}`);
    if (!skipModal) {
      setShowInstructionModal(true);
    } else {
      executeAdd();
    }
  };

  const executeAdd = () => {
    setShowInstructionModal(false);
    if (category === CategoryType.PERSONAL_LEISURE) {
      const suggestedLeisure = totalIncome * 0.15;
      onAddItem(category, { 
        description: 'Lazer e Despesas Pessoais',
        values: new Array(12).fill(suggestedLeisure)
      });
    } else {
      onAddItem(category);
    }
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
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-8 transition-all hover:shadow-md">
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
                  <p>1. Contas que você paga todos os meses sem data para acabar.</p>
                  <p>2. Gastos parcelados em <b>acima de 18 vezes</b>.</p>
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
              <button onClick={executeAdd} className="w-full bg-yellow-600 hover:bg-yellow-500 text-black font-black py-4 rounded-2xl transition-all uppercase text-xs tracking-widest">OK, Continuar</button>
              <button onClick={handleDontShowAgain} className="text-zinc-500 hover:text-white text-[10px] font-bold uppercase tracking-[0.2em] py-2 transition-colors">Não mostrar novamente</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-zinc-900 p-4 flex justify-between items-center border-b border-yellow-600/20">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h3 className="text-yellow-500 font-black text-lg uppercase tracking-widest italic">{title}</h3>
            {tooltip && (
              <div className="relative">
                <button onMouseEnter={() => setShowTooltip(true)} onMouseLeave={() => setShowTooltip(false)} className="text-yellow-500/50 hover:text-yellow-500 transition-colors">
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
          {subtitle && <p className="text-yellow-500/60 text-[10px] uppercase font-bold tracking-wider">{subtitle}</p>}
        </div>
        <button onClick={handleAddWithInstruction} className="bg-yellow-600 hover:bg-yellow-400 text-black font-bold px-4 py-1.5 rounded-md transition-all shadow-lg flex items-center gap-2 text-sm">
          <i className="fas fa-plus"></i> ADICIONAR
        </button>
      </div>
      
      <div className="overflow-x-auto">
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
                    <button onClick={() => onRemoveItem(item.id)} className="text-gray-300 hover:text-red-500 transition-colors p-1"><i className="fas fa-trash-alt text-xs"></i></button>
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
                    {showLinkOption && onLinkCard && (
                      <div className="px-2 pb-1 flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <i className="fas fa-credit-card text-[10px] text-gray-400"></i>
                          <select 
                            className="text-[10px] bg-transparent border-none text-gray-500 focus:ring-0 cursor-pointer hover:text-yellow-600 transition-colors p-0"
                            value={item.linkedCardId || ''}
                            onChange={(e) => onLinkCard(item.id, e.target.value, item.linkType || LinkType.RECURRING)}
                          >
                            <option value="">Dinheiro/Débito</option>
                            {allCards.map(card => (
                              <option key={card.id} value={card.id}>Cartão: {card.description || 'S/N'}</option>
                            ))}
                          </select>
                          {item.linkedCardId && (
                             <select 
                               className="text-[9px] font-bold bg-zinc-100 rounded px-1 text-zinc-600 border-none focus:ring-0"
                               value={item.linkType || LinkType.RECURRING}
                               onChange={(e) => onLinkCard(item.id, item.linkedCardId!, e.target.value as LinkType)}
                             >
                               <option value={LinkType.RECURRING}>Recorrente</option>
                               <option value={LinkType.INSTALLMENT}>Parcelado</option>
                             </select>
                          )}
                        </div>
                      </div>
                    )}
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
                            <i className="fas fa-sync-alt"></i>
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
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default BlockSection;
