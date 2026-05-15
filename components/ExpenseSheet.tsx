
import React, { useState, useEffect, useRef } from 'react';
import { FinanceItem, CategoryType } from '../types';
import { formatCurrency } from '../constants';

export interface DetectedExpense {
  itemId: string;
  value: number;
  description: string;
  installments: number;
}

interface ExpenseSheetProps {
  open: boolean;
  source: 'ai' | 'manual';
  items: FinanceItem[];
  initialItemId?: string;
  initialValue?: number;
  initialDescription?: string;
  initialInstallments?: number;
  onConfirm: (data: DetectedExpense) => void;
  onClose: () => void;
}

type Step = 'category' | 'item' | 'details';

const CATEGORIES = [
  { type: CategoryType.VARIABLE_EXPENSE, label: 'Gasto Variável', sub: 'Mercado, gasolina, farmácia...', icon: 'fa-bolt', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30' },
  { type: CategoryType.PERSONAL_LEISURE, label: 'Lazer & Pessoal', sub: 'Restaurante, viagem, presentes...', icon: 'fa-cocktail', color: 'text-pink-400', bg: 'bg-pink-500/10 border-pink-500/30' },
  { type: CategoryType.FIXED_EXPENSE, label: 'Conta Fixa', sub: 'Aluguel, internet, assinaturas...', icon: 'fa-anchor', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/30' },
];

function categoryIcon(cat: CategoryType) {
  if (cat === CategoryType.VARIABLE_EXPENSE) return { icon: 'fa-bolt', color: 'text-blue-400' };
  if (cat === CategoryType.PERSONAL_LEISURE) return { icon: 'fa-cocktail', color: 'text-pink-400' };
  return { icon: 'fa-anchor', color: 'text-purple-400' };
}

const QUICK_INSTALLMENTS = [1, 2, 3, 6, 12];

const ExpenseSheet: React.FC<ExpenseSheetProps> = ({
  open, source, items,
  initialItemId, initialValue, initialDescription, initialInstallments,
  onConfirm, onClose,
}) => {
  const [step, setStep] = useState<Step>('category');
  const [category, setCategory] = useState<CategoryType | null>(null);
  const [itemId, setItemId] = useState('');
  const [value, setValue] = useState('');
  const [installments, setInstallments] = useState(1);
  const [customInstall, setCustomInstall] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [search, setSearch] = useState('');
  const [showItemPicker, setShowItemPicker] = useState(false);

  const valueRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (source === 'ai') {
      setStep('details');
      setCategory(null);
      setItemId(initialItemId ?? '');
      setValue(initialValue ? String(initialValue) : '');
      setInstallments(initialInstallments ?? 1);
      setShowCustom(false);
      setCustomInstall('');
      setSearch('');
      setShowItemPicker(false);
    } else {
      setStep('category');
      setCategory(null);
      setItemId('');
      setValue('');
      setInstallments(1);
      setShowCustom(false);
      setCustomInstall('');
      setSearch('');
      setShowItemPicker(false);
    }
  }, [open, source, initialItemId, initialValue, initialInstallments]);

  // auto-focus value input when reaching details step
  useEffect(() => {
    if ((step === 'details' || (source === 'ai' && !showItemPicker)) && open) {
      setTimeout(() => valueRef.current?.focus(), 150);
    }
  }, [step, showItemPicker, open, source]);

  const trackableItems = items.filter(i =>
    i.category === CategoryType.VARIABLE_EXPENSE ||
    i.category === CategoryType.PERSONAL_LEISURE ||
    i.category === CategoryType.FIXED_EXPENSE
  );

  const pickerItems = trackableItems.filter(i => {
    if (category && i.category !== category) return false;
    if (!search) return true;
    return i.description.toLowerCase().includes(search.toLowerCase());
  });

  const selectedItem = items.find(i => i.id === itemId);
  const effectiveInstallments = showCustom ? (parseInt(customInstall) || 1) : installments;
  const numericValue = parseFloat(value.replace(',', '.')) || 0;
  const canConfirm = itemId && numericValue > 0;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm({
      itemId,
      value: numericValue,
      description: selectedItem?.description ?? initialDescription ?? '',
      installments: Math.max(1, effectiveInstallments),
    });
  };

  const selectItem = (id: string) => {
    setItemId(id);
    if (source === 'ai') {
      setShowItemPicker(false);
    } else {
      setStep('details');
    }
    setSearch('');
  };

  if (!open) return null;

  const isItemPicking = showItemPicker || (source === 'manual' && step === 'item');

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-[#111] rounded-t-3xl border-t border-zinc-800 shadow-2xl animate-in slide-in-from-bottom duration-300">
        <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mt-3 mb-1" />

        <div className="px-5 pb-10 pt-2">

          {/* ─── CATEGORY STEP ─── */}
          {source === 'manual' && step === 'category' && (
            <div className="space-y-4">
              <p className="text-white font-black text-base uppercase tracking-wider pt-3">Qual tipo de despesa?</p>
              <div className="space-y-2.5">
                {CATEGORIES.map(cat => (
                  <button
                    key={cat.type}
                    onClick={() => { setCategory(cat.type); setStep('item'); }}
                    className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl border ${cat.bg} active:scale-[0.98] transition-all`}
                  >
                    <div className={`w-8 h-8 rounded-xl ${cat.bg} flex items-center justify-center shrink-0`}>
                      <i className={`fas ${cat.icon} ${cat.color} text-sm`} />
                    </div>
                    <div className="text-left flex-1">
                      <p className={`font-black text-sm uppercase tracking-wider ${cat.color}`}>{cat.label}</p>
                      <p className="text-zinc-500 text-[10px] mt-0.5">{cat.sub}</p>
                    </div>
                    <i className="fas fa-chevron-right text-zinc-600 text-xs" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ─── ITEM PICKER ─── */}
          {isItemPicking && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => {
                    setSearch('');
                    if (source === 'ai') setShowItemPicker(false);
                    else setStep('category');
                  }}
                  className="w-8 h-8 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-400 active:text-white shrink-0"
                >
                  <i className="fas fa-chevron-left text-xs" />
                </button>
                <p className="text-white font-black text-sm uppercase tracking-wider">Qual item?</p>
              </div>

              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar..."
                autoFocus
                className="w-full px-4 py-2.5 bg-zinc-800 rounded-2xl border border-zinc-700 text-white text-sm outline-none focus:border-yellow-500/60 placeholder:text-zinc-600"
              />

              <div className="space-y-1 max-h-52 overflow-y-auto">
                {pickerItems.map(item => {
                  const { icon, color } = categoryIcon(item.category);
                  return (
                    <button
                      key={item.id}
                      onClick={() => selectItem(item.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left active:scale-[0.98] transition-all ${itemId === item.id ? 'bg-yellow-500/15 border border-yellow-500/30' : 'bg-zinc-800/50 border border-transparent'}`}
                    >
                      <i className={`fas ${icon} ${color} text-xs w-4 text-center shrink-0`} />
                      <span className="text-white text-sm font-medium">{item.description}</span>
                      {itemId === item.id && <i className="fas fa-check text-yellow-500 text-xs ml-auto" />}
                    </button>
                  );
                })}
                {pickerItems.length === 0 && (
                  <p className="text-zinc-600 text-sm text-center py-8">Nenhum item encontrado</p>
                )}
              </div>
            </div>
          )}

          {/* ─── DETAILS STEP (AI + manual) ─── */}
          {!isItemPicking && (source === 'ai' || step === 'details') && (
            <div className="space-y-4">

              {/* Header */}
              <div className="flex items-center justify-between pt-2">
                {source === 'ai' ? (
                  <p className="text-zinc-400 text-[10px] font-black uppercase tracking-widest">Stets identificou</p>
                ) : (
                  <button
                    onClick={() => setStep('item')}
                    className="flex items-center gap-2 text-zinc-500 active:text-zinc-300 text-xs"
                  >
                    <i className="fas fa-chevron-left text-[10px]" />
                    <span className="uppercase font-black tracking-wider">Voltar</span>
                  </button>
                )}
              </div>

              {/* Item selector */}
              <button
                onClick={() => {
                  setSearch('');
                  if (source === 'ai') setShowItemPicker(true);
                  else setStep('item');
                }}
                className="w-full flex items-center gap-3 px-4 py-3 bg-zinc-800 rounded-2xl border border-zinc-700 active:border-zinc-600 transition-all"
              >
                {selectedItem ? (
                  <>
                    {(() => { const { icon, color } = categoryIcon(selectedItem.category); return <i className={`fas ${icon} ${color} text-sm w-4 shrink-0`} />; })()}
                    <div className="text-left flex-1 min-w-0">
                      <p className="text-[9px] text-zinc-500 uppercase font-black tracking-wider">Item</p>
                      <p className="text-white font-bold text-sm truncate">{selectedItem.description}</p>
                    </div>
                  </>
                ) : (
                  <div className="flex-1 text-left">
                    <p className="text-[9px] text-zinc-500 uppercase font-black tracking-wider">Item</p>
                    <p className="text-zinc-500 text-sm">Selecionar item...</p>
                  </div>
                )}
                <i className="fas fa-chevron-right text-zinc-600 text-xs shrink-0" />
              </button>

              {/* Value */}
              <div className="px-4 py-3 bg-zinc-800 rounded-2xl border border-zinc-700 focus-within:border-yellow-500/40 transition-colors">
                <p className="text-[9px] text-zinc-500 uppercase font-black tracking-wider mb-1">Valor</p>
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500 font-mono text-sm">R$</span>
                  <input
                    ref={valueRef}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={value}
                    onChange={e => setValue(e.target.value)}
                    className="flex-1 bg-transparent text-white text-2xl font-black font-mono outline-none"
                    placeholder="0,00"
                  />
                </div>
                {effectiveInstallments > 1 && numericValue > 0 && (
                  <p className="text-zinc-500 text-[10px] mt-1 font-mono">
                    {effectiveInstallments}x de {formatCurrency(numericValue / effectiveInstallments)}
                  </p>
                )}
              </div>

              {/* Installments */}
              <div className="px-4 py-3 bg-zinc-800 rounded-2xl border border-zinc-700">
                <p className="text-[9px] text-zinc-500 uppercase font-black tracking-wider mb-2">Parcelas</p>
                <div className="flex gap-2 flex-wrap">
                  {QUICK_INSTALLMENTS.map(n => (
                    <button
                      key={n}
                      onClick={() => { setInstallments(n); setShowCustom(false); setCustomInstall(''); }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all active:scale-95 ${!showCustom && installments === n ? 'bg-yellow-500 text-black' : 'bg-zinc-700 text-zinc-400'}`}
                    >
                      {n}x
                    </button>
                  ))}
                  <button
                    onClick={() => setShowCustom(v => !v)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all active:scale-95 ${showCustom ? 'bg-yellow-500 text-black' : 'bg-zinc-700 text-zinc-400'}`}
                  >
                    Outro
                  </button>
                </div>
                {showCustom && (
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="60"
                    value={customInstall}
                    onChange={e => setCustomInstall(e.target.value)}
                    placeholder="Nº de parcelas"
                    autoFocus
                    className="mt-2 w-full px-3 py-2 bg-zinc-700 rounded-xl border border-zinc-600 text-white text-sm outline-none focus:border-yellow-500/60 placeholder:text-zinc-600"
                  />
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={onClose}
                  className="flex-1 py-3.5 rounded-2xl bg-zinc-800 text-zinc-400 font-black text-sm active:scale-95 transition-transform"
                >
                  CANCELAR
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={!canConfirm}
                  className={`flex-[2] py-3.5 rounded-2xl font-black text-sm transition-all ${canConfirm ? 'bg-yellow-500 text-black active:scale-95' : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'}`}
                >
                  {source === 'ai' ? 'CONFIRMAR' : 'LANÇAR'}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default ExpenseSheet;
