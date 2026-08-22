import React, { useState } from 'react';
import { CategoryType, FinanceItem, PartialExpense } from '../types';
import { formatCurrency } from '../constants';

interface ExpenseInfo {
  description: string;
  value: number;
  date: string;
  paymentSource?: 'debit' | 'credit';
  cardLast4?: string;
  currentItemId: string;
}

interface Props {
  expense: ExpenseInfo;
  items: FinanceItem[];
  workingMonthKey: string;
  onConfirm: (newItemId: string) => void;
  onKeep: () => void;
  onClose: () => void;
  onCreateItem: (description: string, category: CategoryType) => string;
}

const CATS = [
  { type: CategoryType.INCOME,           label: 'Renda',      icon: 'fa-arrow-down',     color: '#34c759' },
  { type: CategoryType.FIXED_EXPENSE,    label: 'Conta Fixa', icon: 'fa-house',          color: '#007aff' },
  { type: CategoryType.VARIABLE_EXPENSE, label: 'Variável',   icon: 'fa-cart-shopping',  color: '#ff9500' },
  { type: CategoryType.PERSONAL_LEISURE, label: 'Lazer',      icon: 'fa-star',            color: '#af52de' },
];

type Step = 'confirm' | 'category' | 'item';

export default function RecategorizarSheet({
  expense, items, workingMonthKey, onConfirm, onKeep, onClose, onCreateItem,
}: Props) {
  const [step, setStep] = useState<Step>('confirm');
  const [selectedCat, setSelectedCat] = useState<CategoryType | null>(null);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [showNewInput, setShowNewInput] = useState(false);
  const [newName, setNewName] = useState('');

  const catItems = selectedCat ? items.filter(i => i.category === selectedCat) : [];
  const withPartials = catItems.filter(i => (i.partialExpenses?.[workingMonthKey]?.length ?? 0) > 0);
  const withoutPartials = catItems.filter(i => (i.partialExpenses?.[workingMonthKey]?.length ?? 0) === 0);

  // Parcelas irmãs: mesmo item, mesma desc+valor, em meses FUTUROS ao workingMonthKey
  const currentItem = items.find(i => i.id === expense.currentItemId);
  const siblingCount = Object.entries((currentItem?.partialExpenses ?? {}) as Record<string, PartialExpense[]>).reduce((n, [mk, ps]) => {
    if (mk <= workingMonthKey) return n;
    return n + ps.filter(p => p.description === expense.description && Math.abs(p.value - expense.value) < 0.01).length;
  }, 0);

  function pickCat(cat: CategoryType) {
    setSelectedCat(cat);
    setShowNewInput(false);
    setNewName('');
    // Para PERSONAL_LEISURE: único item Lazer é selecionado automaticamente.
    if (cat === CategoryType.PERSONAL_LEISURE) {
      const lazerItem = items.find(i => i.category === CategoryType.PERSONAL_LEISURE);
      if (lazerItem) {
        setSelectedItemId(lazerItem.id);
        setStep('item');
        return;
      }
    }
    setSelectedItemId('');
    setStep('item');
  }

  function handleConfirmItem() {
    if (showNewInput) {
      if (!newName.trim() || !selectedCat) return;
      const newId = onCreateItem(newName.trim(), selectedCat);
      onConfirm(newId);
    } else {
      if (!selectedItemId) return;
      onConfirm(selectedItemId);
    }
  }

  const canConfirm = showNewInput ? !!newName.trim() : !!selectedItemId;

  const sourceLabel = expense.paymentSource === 'credit'
    ? `Cartão ••${expense.cardLast4 ?? '?'}`
    : expense.paymentSource === 'debit'
      ? 'Débito / Pix'
      : null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end" onClick={onClose}>
      <div
        className="w-full bg-white rounded-t-3xl pb-10 border-t border-[#e8e8ed] animate-in slide-in-from-bottom-4 duration-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-8 h-1 bg-[#e8e8ed] rounded-full mx-auto mt-4 mb-4" />

        {/* Expense info header */}
        <div className="flex items-center justify-between px-6 pb-4 border-b border-[#f5f5f7]">
          <div className="min-w-0">
            <p className="text-[#1d1d1f] font-black text-sm truncate">{expense.description}</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-[#aeaeb2] text-xs">{expense.date}</span>
              {sourceLabel && (
                <span className={`text-xs font-bold ${expense.paymentSource === 'credit' ? 'text-[#ff9500]' : 'text-[#007aff]'}`}>
                  {expense.paymentSource === 'credit' && <i className="fas fa-credit-card text-[9px] mr-1" />}
                  {sourceLabel}
                </span>
              )}
            </div>
          </div>
          <span className="text-[#1d1d1f] font-black text-base k-num ml-3 shrink-0">
            {formatCurrency(expense.value)}
          </span>
        </div>

        {/* Step: confirm */}
        {step === 'confirm' && (
          <div className="px-6 pt-5">
            <p className="text-[#1d1d1f] font-black text-base mb-1">Recategorizar este gasto?</p>
            <p className="text-[#6e6e73] text-sm mb-6">A forma de pagamento não muda — só o destino.</p>
            <div className="flex gap-3">
              <button
                onClick={onKeep}
                className="flex-1 py-3.5 rounded-2xl bg-[#f5f5f7] text-[#1d1d1f] font-black text-sm border border-[#e8e8ed] active:opacity-70"
              >
                Não, manter
              </button>
              <button
                onClick={() => setStep('category')}
                className="flex-[2] py-3.5 rounded-2xl bg-[#1d1d1f] text-white font-black text-sm active:opacity-80"
              >
                Sim, recategorizar
              </button>
            </div>
          </div>
        )}

        {/* Step: category */}
        {step === 'category' && (
          <div className="px-6 pt-4">
            <button
              onClick={() => setStep('confirm')}
              className="flex items-center gap-1.5 text-[#007aff] text-xs font-bold mb-4"
            >
              <i className="fas fa-chevron-left text-[9px]" /> Voltar
            </button>
            <p className="text-[9px] text-[#aeaeb2] font-black uppercase tracking-widest mb-3">Qual categoria?</p>
            <div className="space-y-2">
              {CATS.map(cat => (
                <button
                  key={cat.type}
                  onClick={() => pickCat(cat.type)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 border-[#e8e8ed] active:opacity-70 transition-all"
                >
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: cat.color + '18' }}
                  >
                    <i className={`fas ${cat.icon} text-sm`} style={{ color: cat.color }} />
                  </div>
                  <span className="text-[#1d1d1f] font-black text-sm flex-1 text-left">{cat.label}</span>
                  <i className="fas fa-chevron-right text-[#aeaeb2] text-xs" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step: item */}
        {step === 'item' && selectedCat && (
          <div className="px-6 pt-4">
            <button
              onClick={() => { setStep('category'); setShowNewInput(false); }}
              className="flex items-center gap-1.5 text-[#007aff] text-xs font-bold mb-4"
            >
              <i className="fas fa-chevron-left text-[9px]" /> {CATS.find(c => c.type === selectedCat)?.label}
            </button>
            <p className="text-[9px] text-[#aeaeb2] font-black uppercase tracking-widest mb-3">Qual linha?</p>

            <div className="space-y-1.5 max-h-44 overflow-y-auto mb-3">
              {withPartials.map(item => (
                <button
                  key={item.id}
                  onClick={() => { setSelectedItemId(item.id); setShowNewInput(false); }}
                  className={`w-full flex items-center gap-2 px-3.5 py-3 rounded-2xl border-2 transition-all text-left active:opacity-70 ${
                    selectedItemId === item.id ? 'border-[#7ab800] bg-[#f0fad0]' : 'border-[#e8e8ed]'
                  }`}
                >
                  <span className="flex-1 text-sm text-[#1d1d1f] font-bold">{item.description}</span>
                  <span className="text-[8px] text-[#7ab800] font-black uppercase bg-[#e8f7c0] px-1.5 py-0.5 rounded-full shrink-0 whitespace-nowrap">
                    em uso
                  </span>
                </button>
              ))}
              {withoutPartials.map(item => (
                <button
                  key={item.id}
                  onClick={() => { setSelectedItemId(item.id); setShowNewInput(false); }}
                  className={`w-full text-left px-3.5 py-3 rounded-2xl border-2 transition-all active:opacity-70 ${
                    selectedItemId === item.id
                      ? 'border-[#7ab800] bg-[#f0fad0] text-[#1d1d1f]'
                      : 'border-[#e8e8ed] text-[#6e6e73]'
                  }`}
                >
                  <span className="text-sm font-bold">{item.description}</span>
                </button>
              ))}
            </div>

            {!showNewInput && selectedCat !== CategoryType.PERSONAL_LEISURE ? (
              <button
                onClick={() => { setShowNewInput(true); setSelectedItemId(''); }}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-[#e8e8ed] text-[#7ab800] active:opacity-70 mb-3"
              >
                <i className="fas fa-plus-circle text-sm" />
                <span className="text-sm font-black">Criar nova linha</span>
              </button>
            ) : showNewInput ? (
              <div className="border-2 border-[#7ab800] rounded-2xl p-3 mb-3 space-y-2">
                <p className="text-[9px] text-[#7ab800] font-black uppercase tracking-widest">Nome da nova linha</p>
                <input
                  autoFocus
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) handleConfirmItem(); }}
                  placeholder="Ex: Farmácia, Academia…"
                  className="w-full text-sm py-2 px-3 bg-[#f5f5f7] rounded-xl outline-none border border-[#e8e8ed] text-[#1d1d1f]"
                />
              </div>
            ) : null}

            {siblingCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-[10px] text-amber-700 font-bold mb-3">
                <i className="fas fa-layer-group text-amber-500 shrink-0" />
                <span>
                  {siblingCount} parcela{siblingCount > 1 ? 's' : ''} futura{siblingCount > 1 ? 's' : ''} {siblingCount > 1 ? 'serão movidas' : 'será movida'} junto.
                </span>
              </div>
            )}
            <button
              onClick={handleConfirmItem}
              disabled={!canConfirm}
              className={`w-full py-3.5 rounded-2xl font-black text-sm transition-all ${
                canConfirm
                  ? 'bg-[#7ab800] text-white active:opacity-80'
                  : 'bg-[#e8e8ed] text-[#aeaeb2] cursor-not-allowed'
              }`}
            >
              Confirmar{siblingCount > 0 ? ` (+ ${siblingCount} futura${siblingCount > 1 ? 's' : ''})` : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
