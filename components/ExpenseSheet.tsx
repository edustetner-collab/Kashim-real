
import React, { useState, useEffect, useRef } from 'react';
import { FinanceItem, CategoryType } from '../types';
import { formatCurrency } from '../constants';

export interface DetectedExpense {
  itemId: string;
  value: number;
  description: string;
  installments: number;
  isCredit: boolean;
  category?: CategoryType;
  linkedCardId?: string;
  purchaseDate?: { day: number; month: number; year: number }; // month: 0-indexed (0=Jan)
}

interface ExpenseSheetProps {
  open: boolean;
  source: 'ai' | 'manual';
  items: FinanceItem[];
  initialItemId?: string;
  initialValue?: number;
  initialDescription?: string;
  initialInstallments?: number;
  defaultPurchaseDate?: { day: number; month: number; year: number };
  onConfirm: (data: DetectedExpense) => void;
  onClose: () => void;
  onCreateItem?: (description: string, category: CategoryType) => string;
}

type Step = 'category' | 'variable-entry' | 'item-picker' | 'value-payment';
type PayMethod = '' | 'debit' | 'credit';
type CreditType = '' | 'avista' | 'parcelado';

const CATEGORIES = [
  {
    type: CategoryType.VARIABLE_EXPENSE,
    label: 'Gasto Variável',
    sub: 'Um imprevisto, algo que aconteceu de repente',
    icon: 'fa-bolt',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10 border-blue-500/30',
  },
  {
    type: CategoryType.PERSONAL_LEISURE,
    label: 'Lazer & Pessoal',
    sub: 'Restaurante, viagem, cinema, presentes...',
    icon: 'fa-cocktail',
    color: 'text-pink-400',
    bg: 'bg-pink-500/10 border-pink-500/30',
  },
  {
    type: CategoryType.FIXED_EXPENSE,
    label: 'Conta Fixa',
    sub: 'Algo que você já paga todo mês (mercado, gasolina, aluguel...)',
    icon: 'fa-anchor',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10 border-purple-500/30',
  },
];

function catStyle(cat: CategoryType) {
  if (cat === CategoryType.VARIABLE_EXPENSE) return { icon: 'fa-bolt', color: 'text-blue-400' };
  if (cat === CategoryType.PERSONAL_LEISURE) return { icon: 'fa-cocktail', color: 'text-pink-400' };
  return { icon: 'fa-anchor', color: 'text-purple-400' };
}

const MONTHS_BR_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

const ExpenseSheet: React.FC<ExpenseSheetProps> = ({
  open, source, items,
  initialItemId, initialValue, initialDescription, initialInstallments,
  defaultPurchaseDate,
  onConfirm, onClose, onCreateItem,
}) => {
  const [step, setStep] = useState<Step>('category');
  const [category, setCategory] = useState<CategoryType | null>(null);
  const [itemId, setItemId] = useState('');
  const [variableDesc, setVariableDesc] = useState('');
  const [search, setSearch] = useState('');
  const [value, setValue] = useState('');
  const [payMethod, setPayMethod] = useState<PayMethod>('');
  const [creditType, setCreditType] = useState<CreditType>('');
  const [installCount, setInstallCount] = useState('');
  const [leisureDesc, setLeisureDesc] = useState('');
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState('');
  const [purchaseDay, setPurchaseDay] = useState(() => defaultPurchaseDate?.day ?? new Date().getDate());
  const [purchaseMonth, setPurchaseMonth] = useState(() => defaultPurchaseDate?.month ?? new Date().getMonth());
  const [purchaseYear, setPurchaseYear] = useState(() => defaultPurchaseDate?.year ?? new Date().getFullYear());

  const valueRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const ref = defaultPurchaseDate ?? { day: new Date().getDate(), month: new Date().getMonth(), year: new Date().getFullYear() };
    setPurchaseDay(ref.day);
    setPurchaseMonth(ref.month);
    setPurchaseYear(ref.year);
    setSearch('');
    setShowItemPicker(false);
    if (source === 'ai') {
      setStep('value-payment');
      setCategory(null);
      setItemId(initialItemId ?? '');
      setVariableDesc(initialDescription ?? '');
      setValue(initialValue ? String(initialValue) : '');
      const init = Math.max(1, initialInstallments ?? 1);
      if (init > 1) { setPayMethod('credit'); setCreditType('parcelado'); setInstallCount(String(init)); }
      else { setPayMethod(''); setCreditType(''); setInstallCount(''); }
      // Pre-select card if item already has one linked
      const matchedItem = items.find(i => i.id === (initialItemId ?? ''));
      setSelectedCardId(matchedItem?.linkedCardId ?? '');
    } else {
      setStep('category');
      setCategory(null);
      setItemId('');
      setVariableDesc(initialDescription ?? '');
      setValue(initialValue ? String(initialValue) : '');
      setPayMethod('');
      setCreditType('');
      setSelectedCardId('');
      setLeisureDesc('');
      const initManual = Math.max(1, initialInstallments ?? 1);
      setInstallCount(initManual > 1 ? String(initManual) : '');
    }
  }, [open, source, initialItemId, initialValue, initialDescription, initialInstallments, defaultPurchaseDate]);

  useEffect(() => {
    if (step === 'value-payment' && open && !showItemPicker) {
      setTimeout(() => valueRef.current?.focus(), 200);
    }
  }, [step, open, showItemPicker]);

  const selectedItem = items.find(i => i.id === itemId);
  const numericValue = parseFloat(value.replace(',', '.')) || 0;
  const installments = Math.max(2, parseInt(installCount) || 2);
  const isCredit = payMethod === 'credit';
  const isParcelado = isCredit && creditType === 'parcelado';

  const hasItem = !!itemId || (category === CategoryType.VARIABLE_EXPENSE && variableDesc.trim().length > 0);
  const needsCard = isCredit && items.filter(i => i.category === CategoryType.CREDIT_CARD).length > 0;
  const canConfirm = hasItem && numericValue > 0 && payMethod !== '' && (!needsCard || !!selectedCardId);

  const pickerItems = items.filter(i => {
    if (i.category === CategoryType.INCOME || i.category === CategoryType.CREDIT_CARD) return false;
    if (source === 'manual' && category && i.category !== category) return false;
    if (!search) return true;
    return i.description.toLowerCase().includes(search.toLowerCase());
  });

  const variableSuggestions = variableDesc.length > 1
    ? items.filter(i =>
        i.category === CategoryType.VARIABLE_EXPENSE &&
        i.description.toLowerCase().includes(variableDesc.toLowerCase())
      )
    : [];

  const handleConfirmClick = () => {
    if (!canConfirm) return;

    let finalItemId = itemId;
    let finalDesc = (category === CategoryType.PERSONAL_LEISURE && leisureDesc.trim())
      ? leisureDesc.trim()
      : (selectedItem?.description ?? variableDesc.trim());

    if (!itemId && category === CategoryType.VARIABLE_EXPENSE && variableDesc.trim() && onCreateItem) {
      finalItemId = onCreateItem(variableDesc.trim(), CategoryType.VARIABLE_EXPENSE);
      finalDesc = variableDesc.trim();
    }
    if (!finalItemId) return;

    onConfirm({
      itemId: finalItemId,
      value: numericValue,
      description: finalDesc,
      installments: isParcelado ? installments : 1,
      isCredit,
      category: category ?? selectedItem?.category,
      linkedCardId: isCredit && selectedCardId ? selectedCardId : undefined,
      purchaseDate: { day: purchaseDay, month: purchaseMonth, year: purchaseYear },
    });
  };

  if (!open) return null;

  const isPickerVisible = showItemPicker || (source === 'manual' && step === 'item-picker');

  const creditCards = items.filter(i => i.category === CategoryType.CREDIT_CARD);

  const renderValuePayment = () => (
    <div className="space-y-4">
      {/* Item badge / selector */}
      <button
        onClick={() => { setSearch(''); source === 'ai' ? setShowItemPicker(true) : (category === CategoryType.VARIABLE_EXPENSE ? setStep('variable-entry') : setStep('item-picker')); }}
        className="flex items-center gap-2.5 px-3 py-2 bg-zinc-800 rounded-xl border border-zinc-700 active:scale-95 max-w-full"
      >
        {selectedItem && (() => { const { icon, color } = catStyle(selectedItem.category); return <i className={`fas ${icon} ${color} text-xs shrink-0`} />; })()}
        <span className="text-zinc-200 text-xs font-bold truncate flex-1">
          {selectedItem?.description || variableDesc || 'Selecionar item...'}
        </span>
        <i className="fas fa-pen text-zinc-600 text-[9px] shrink-0" />
      </button>

      {/* Optional description for Lazer & Pessoal */}
      {category === CategoryType.PERSONAL_LEISURE && (
        <div className="px-4 py-3 bg-zinc-800 rounded-2xl border border-zinc-700 focus-within:border-green-400/40 transition-colors">
          <p className="text-[9px] text-zinc-500 uppercase font-black tracking-wider mb-1">
            O que foi? <span className="text-zinc-600 normal-case font-medium">(opcional)</span>
          </p>
          <input
            type="text"
            value={leisureDesc}
            onChange={e => setLeisureDesc(e.target.value)}
            placeholder="Ex: restaurante, futebol, presente..."
            className="w-full bg-transparent text-white text-sm font-medium outline-none placeholder:text-zinc-600"
          />
        </div>
      )}

      {/* Value */}
      <div className="px-4 py-3 bg-zinc-800 rounded-2xl border border-zinc-700 focus-within:border-green-400/40 transition-colors">
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
        {isParcelado && numericValue > 0 && installments > 1 && (
          <p className="text-zinc-500 text-[10px] mt-1 font-mono">
            {installments}x de {formatCurrency(numericValue / installments)}
          </p>
        )}
      </div>

      {/* Purchase date */}
      <div className="px-4 py-3 bg-zinc-800 rounded-2xl border border-zinc-700">
        <p className="text-[9px] text-zinc-500 uppercase font-black tracking-wider mb-2">Data da compra</p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            value={purchaseDay}
            onChange={e => setPurchaseDay(Math.max(1, Math.min(31, parseInt(e.target.value) || 1)))}
            className="w-12 bg-zinc-900 rounded-xl px-2 py-1.5 text-white text-sm font-black text-center outline-none border border-zinc-700 focus:border-green-400/50"
            placeholder="DD"
          />
          <span className="text-zinc-600 text-sm font-bold">/</span>
          <select
            value={purchaseMonth}
            onChange={e => setPurchaseMonth(parseInt(e.target.value))}
            className="bg-zinc-900 rounded-xl px-2 py-1.5 text-white text-sm font-black outline-none border border-zinc-700 focus:border-green-400/50"
          >
            {MONTHS_BR_SHORT.map((m, i) => (
              <option key={i} value={i}>{m}</option>
            ))}
          </select>
          <span className="text-zinc-600 text-sm font-bold">/</span>
          <input
            type="number"
            inputMode="numeric"
            min={2020}
            max={2099}
            value={purchaseYear}
            onChange={e => setPurchaseYear(parseInt(e.target.value) || new Date().getFullYear())}
            className="w-20 bg-zinc-900 rounded-xl px-2 py-1.5 text-white text-sm font-black text-center outline-none border border-zinc-700 focus:border-green-400/50"
            placeholder="AAAA"
          />
        </div>
        {(purchaseMonth !== new Date().getMonth() || purchaseYear !== new Date().getFullYear()) && (
          <p className="text-amber-400 text-[10px] mt-2 font-bold">
            <i className="fas fa-history mr-1" />
            Lançamento retroativo — registrando em {MONTHS_BR_SHORT[purchaseMonth]}/{purchaseYear}
          </p>
        )}
      </div>

      {/* Payment method */}
      <div data-tour="sheet-payment">
        <p className="text-[9px] text-zinc-500 uppercase font-black tracking-wider mb-2">Como foi pago?</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => { setPayMethod('debit'); setCreditType(''); setInstallCount(''); }}
            className={`py-3 rounded-2xl text-sm font-black transition-all active:scale-95 border ${payMethod === 'debit' ? 'bg-zinc-100 text-black border-zinc-100' : 'bg-zinc-800 text-zinc-400 border-zinc-700'}`}
          >
            <i className="fas fa-money-bill-wave mr-2 text-xs" />
            Débito
          </button>
          <button
            onClick={() => { setPayMethod('credit'); if (!creditType) setCreditType('avista'); }}
            className={`py-3 rounded-2xl text-sm font-black transition-all active:scale-95 border ${payMethod === 'credit' ? 'bg-green-400 text-black border-green-400' : 'bg-zinc-800 text-zinc-400 border-zinc-700'}`}
          >
            <i className="fas fa-credit-card mr-2 text-xs" />
            Crédito
          </button>
        </div>
      </div>

      {/* Card picker — required when credit is selected */}
      {isCredit && creditCards.length > 0 && (
        <div data-tour="sheet-card">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[9px] text-zinc-500 uppercase font-black tracking-wider">Em qual cartão?</p>
            {!selectedCardId && (
              <span className="text-[9px] text-amber-400 font-black uppercase tracking-wide">
                <i className="fas fa-exclamation-circle mr-0.5" />obrigatório
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {creditCards.map(card => (
              <button
                key={card.id}
                onClick={() => setSelectedCardId(prev => prev === card.id ? '' : card.id)}
                className={`px-3 py-2 rounded-xl text-xs font-black transition-all active:scale-95 border ${
                  selectedCardId === card.id
                    ? 'bg-green-400/20 text-green-300 border-green-400/40'
                    : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                }`}
              >
                {card.description}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Credit sub-options */}
      {isCredit && (
        <div data-tour="sheet-credit-type">
          <p className="text-[9px] text-zinc-500 uppercase font-black tracking-wider mb-2">Tipo de crédito</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => { setCreditType('avista'); setInstallCount(''); }}
              className={`py-2.5 rounded-2xl text-sm font-black transition-all active:scale-95 border ${creditType === 'avista' ? 'bg-green-400/20 text-green-300 border-green-400/40' : 'bg-zinc-800 text-zinc-500 border-zinc-700'}`}
            >
              À vista
            </button>
            <button
              onClick={() => setCreditType('parcelado')}
              className={`py-2.5 rounded-2xl text-sm font-black transition-all active:scale-95 border ${creditType === 'parcelado' ? 'bg-green-400/20 text-green-300 border-green-400/40' : 'bg-zinc-800 text-zinc-500 border-zinc-700'}`}
            >
              Parcelado
            </button>
          </div>
        </div>
      )}

      {/* Installment count — chip picker */}
      {isParcelado && (
        <div>
          <p className="text-[9px] text-zinc-500 uppercase font-black tracking-wider mb-2">Em quantas vezes?</p>
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {[2,3,4,5,6,7,8,9,10,11,12,15,18,21,24].map(n => (
              <button
                key={n}
                onClick={() => setInstallCount(String(n))}
                className={`shrink-0 w-11 h-11 rounded-xl font-black text-sm transition-all active:scale-95 border ${
                  parseInt(installCount) === n
                    ? 'bg-green-400 text-black border-green-400'
                    : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                }`}
              >
                {n}x
              </button>
            ))}
          </div>
          {numericValue > 0 && parseInt(installCount) >= 2 && (
            <p className="text-zinc-500 text-[10px] mt-1.5 font-mono">
              {parseInt(installCount)}x de {formatCurrency(numericValue / parseInt(installCount))}
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        <button onClick={onClose} className="flex-1 py-3.5 rounded-2xl bg-zinc-800 text-zinc-400 font-black text-sm active:scale-95">
          CANCELAR
        </button>
        <button
          data-tour="sheet-confirm"
          onClick={handleConfirmClick}
          disabled={!canConfirm}
          className={`flex-[2] py-3.5 rounded-2xl font-black text-sm transition-all ${canConfirm ? 'bg-green-400 text-black active:scale-95' : 'bg-zinc-800 text-zinc-600'}`}
        >
          {source === 'ai' ? 'CONFIRMAR' : 'LANÇAR'}
        </button>
      </div>
    </div>
  );

  const renderPicker = () => (
    <div className="space-y-3">
      <p className="text-white font-black text-sm uppercase tracking-wider">
        {source === 'ai' ? 'Trocar item' : 'Qual item?'}
      </p>
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Buscar..."
        autoFocus
        className="w-full px-4 py-2.5 bg-zinc-800 rounded-2xl border border-zinc-700 text-white text-sm outline-none focus:border-green-400/50 placeholder:text-zinc-600"
      />
      <div className="space-y-1 max-h-52 overflow-y-auto">
        {pickerItems.map(item => {
          const { icon, color } = catStyle(item.category);
          return (
            <button
              key={item.id}
              onClick={() => { setItemId(item.id); setSearch(''); source === 'ai' ? setShowItemPicker(false) : setStep('value-payment'); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left active:scale-[0.98] ${itemId === item.id ? 'bg-green-400/15 border border-green-400/30' : 'bg-zinc-800/50 border border-transparent'}`}
            >
              <i className={`fas ${icon} ${color} text-xs w-4 text-center shrink-0`} />
              <span className="text-white text-sm">{item.description}</span>
              {itemId === item.id && <i className="fas fa-check text-green-400 text-xs ml-auto" />}
            </button>
          );
        })}
        {pickerItems.length === 0 && <p className="text-zinc-600 text-sm text-center py-8">Nenhum item encontrado</p>}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-[#111] rounded-t-3xl border-t border-zinc-800 shadow-2xl animate-in slide-in-from-bottom duration-300">
        <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mt-3 mb-1" />
        <div className="px-5 pb-10 pt-2">

          {/* Back button */}
          {(isPickerVisible || (source === 'manual' && step !== 'category')) && (
            <button
              onClick={() => {
                setSearch('');
                if (showItemPicker) { setShowItemPicker(false); return; }
                if (step === 'variable-entry') setStep('category');
                else if (step === 'item-picker') setStep('category');
                else if (step === 'value-payment') {
                  if (category === CategoryType.VARIABLE_EXPENSE) setStep('variable-entry');
                  else setStep('item-picker');
                }
              }}
              className="flex items-center gap-2 text-zinc-500 active:text-zinc-300 py-2 mb-2"
            >
              <i className="fas fa-chevron-left text-xs" />
              <span className="text-xs font-black uppercase tracking-wider">Voltar</span>
            </button>
          )}

          {/* CATEGORY */}
          {step === 'category' && source === 'manual' && (
            <div className="space-y-3" data-tour="sheet-categories">
              <p className="text-white font-black text-base uppercase tracking-wider py-2">Qual tipo de despesa?</p>
              {CATEGORIES.map(cat => (
                <button
                  key={cat.type}
                  onClick={() => {
                    setCategory(cat.type);
                    setItemId('');
                    setStep(cat.type === CategoryType.VARIABLE_EXPENSE ? 'variable-entry' : 'item-picker');
                  }}
                  className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl border ${cat.bg} active:scale-[0.98] transition-all`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${cat.bg}`}>
                    <i className={`fas ${cat.icon} ${cat.color} text-base`} />
                  </div>
                  <div className="text-left flex-1">
                    <p className={`font-black text-sm uppercase tracking-wider ${cat.color}`}>{cat.label}</p>
                    <p className="text-zinc-500 text-[10px] mt-0.5">{cat.sub}</p>
                  </div>
                  <i className="fas fa-chevron-right text-zinc-600 text-xs" />
                </button>
              ))}
            </div>
          )}

          {/* VARIABLE ENTRY */}
          {step === 'variable-entry' && (
            <div className="space-y-4">
              <p className="text-white font-black text-sm uppercase tracking-wider">O que aconteceu?</p>
              <input
                type="text"
                value={variableDesc}
                onChange={e => { setVariableDesc(e.target.value); setItemId(''); }}
                placeholder="Ex: bateria do carro, conserto, médico..."
                autoFocus
                className="w-full px-4 py-3 bg-zinc-800 rounded-2xl border border-zinc-700 text-white text-sm outline-none focus:border-green-400/50 placeholder:text-zinc-600"
              />
              {variableSuggestions.length > 0 && (
                <div className="space-y-1">
                  <p className="text-zinc-600 text-[10px] uppercase font-black tracking-wider">Já lançado antes</p>
                  {variableSuggestions.map(i => (
                    <button
                      key={i.id}
                      onClick={() => { setItemId(i.id); setVariableDesc(i.description); setStep('value-payment'); }}
                      className="w-full text-left px-4 py-2.5 bg-zinc-800/60 rounded-xl text-white text-sm active:scale-[0.98] border border-zinc-700"
                    >
                      {i.description}
                    </button>
                  ))}
                </div>
              )}
              {variableDesc.trim().length > 1 && (
                <button
                  onClick={() => setStep('value-payment')}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-blue-500/10 border border-blue-500/30 active:scale-[0.98]"
                >
                  <i className="fas fa-plus-circle text-blue-400 text-sm" />
                  <span className="text-blue-400 font-black text-sm">
                    {variableSuggestions.some(i => i.description.toLowerCase() === variableDesc.toLowerCase().trim()) ? `Usar: "${variableDesc.trim()}"` : `Criar: "${variableDesc.trim()}"`}
                  </span>
                </button>
              )}
              <p className="text-zinc-600 text-xs text-center pb-1">
                Não precisa existir na lista — pode ser qualquer imprevisto
              </p>
            </div>
          )}

          {/* ITEM PICKER (fixed/leisure) or AI item change */}
          {isPickerVisible && renderPicker()}

          {/* VALUE + PAYMENT */}
          {step === 'value-payment' && !isPickerVisible && renderValuePayment()}

        </div>
      </div>
    </div>
  );
};

export default ExpenseSheet;
