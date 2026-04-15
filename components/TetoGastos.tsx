
import React, { useState, useEffect, useRef } from 'react';
import { FinanceItem, PartialExpense, CategoryType } from '../types';
import { formatCurrency, MONTHS_BR } from '../constants';
import { SupabaseClient } from '@supabase/supabase-js';
import { loadTetoColumns, saveTetoColumns } from '../lib/db';

interface TetoGastosProps {
  items: FinanceItem[];
  currentMonthIdx: number;
  currentYear: number;
  onAddPartial: (itemId: string, expense: PartialExpense, year?: number, month?: number) => void;
  onRemovePartial: (itemId: string, expenseId: string) => void;
  db?: SupabaseClient | null;
  householdId?: string | null;
}

interface ColumnData {
  id: string;
  title: string;
  linkedItemId: string;
}

const DEFAULT_COLUMNS: ColumnData[] = [
  { id: crypto.randomUUID(), title: 'SUPERMERCADO', linkedItemId: '' },
  { id: crypto.randomUUID(), title: 'GASOLINA', linkedItemId: '' },
  { id: crypto.randomUUID(), title: 'LAZER', linkedItemId: '' },
  { id: crypto.randomUUID(), title: 'EXTRAS', linkedItemId: '' },
];

// Keywords that suggest a fixed expense will have multiple purchases in a month
const RECURRING_KEYWORDS = [
  'mercado', 'supermercado', 'gasolina', 'combustiv', 'uber', 'ifood',
  'lazer', 'alimentaç', 'alimentac', 'restaurante', 'lanche', 'comida',
  'farmácia', 'farmacia', 'remédio', 'remedio', 'pet', 'diarista',
  'estética', 'estetica', 'cabelo', 'sobrancelha', 'unha', 'transporte',
  'delivery', 'padaria', 'açougue', 'acougue',
];

function isRecurringItem(item: FinanceItem): boolean {
  if (item.category === CategoryType.PERSONAL_LEISURE) return true;
  if (item.category === CategoryType.VARIABLE_EXPENSE) return true;
  if (item.category === CategoryType.FIXED_EXPENSE) {
    const desc = item.description.toLowerCase();
    return RECURRING_KEYWORDS.some(kw => desc.includes(kw));
  }
  return false;
}

const TetoGastos: React.FC<TetoGastosProps> = ({ items, currentMonthIdx, currentYear, onAddPartial, onRemovePartial, db, householdId }) => {
  const monthKey = `${currentYear}-${currentMonthIdx}`;
  const [columnsLoaded, setColumnsLoaded] = useState(false);

  const [columns, setColumns] = useState<ColumnData[]>(() => {
    const saved = localStorage.getItem('teto_columns_v3');
    return saved ? JSON.parse(saved) : DEFAULT_COLUMNS;
  });

  // Load columns from Supabase on mount
  useEffect(() => {
    if (!db || !householdId) { setColumnsLoaded(true); return; }
    loadTetoColumns(db, householdId).then((rows) => {
      if (rows.length > 0) {
        setColumns(rows.map((r: any) => ({
          id: r.id,
          title: r.title,
          linkedItemId: r.linked_item_id ?? '',
        })));
      }
      setColumnsLoaded(true);
    }).catch(() => setColumnsLoaded(true));
  }, [db, householdId]);

  // Save columns whenever they change (after initial load)
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (!columnsLoaded) return;
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    localStorage.setItem('teto_columns_v3', JSON.stringify(columns));
    if (db && householdId) {
      saveTetoColumns(db, householdId, columns).catch(console.error);
    }
  }, [columns, columnsLoaded]);

  // Auto-link recurring items that aren't linked to any column yet (runs once after initial load)
  const autoLinkedRef = useRef(false);
  useEffect(() => {
    if (!columnsLoaded || autoLinkedRef.current || items.length === 0) return;
    autoLinkedRef.current = true;

    setColumns(prev => {
      const alreadyLinked = new Set(prev.map(c => c.linkedItemId).filter(Boolean));

      // Find recurring items that have a value set and aren't linked yet
      const toAdd = items.filter(item =>
        isRecurringItem(item) &&
        item.values.some(v => v > 0) &&
        !alreadyLinked.has(item.id)
      );

      if (toAdd.length === 0) return prev;

      // Also try to auto-link existing unlinked columns by matching title keywords
      const updatedPrev = prev.map(col => {
        if (col.linkedItemId) return col;
        const colTitle = col.title.toLowerCase();
        const match = toAdd.find(item => {
          const desc = item.description.toLowerCase();
          return desc.includes(colTitle) || colTitle.split(' ').some(word => word.length > 3 && desc.includes(word));
        });
        return match ? { ...col, linkedItemId: match.id } : col;
      });

      // After auto-linking existing columns, find what's still unlinked
      const nowLinked = new Set(updatedPrev.map(c => c.linkedItemId).filter(Boolean));
      const stillUnlinked = toAdd.filter(item => !nowLinked.has(item.id));

      const newCols: ColumnData[] = stillUnlinked.map(item => ({
        id: crypto.randomUUID(),
        title: item.description.toUpperCase().slice(0, 24).trim(),
        linkedItemId: item.id,
      }));

      return [...updatedPrev, ...newCols];
    });
  }, [columnsLoaded, items]);

  const addColumn = () => {
    setColumns(prev => [...prev, { id: crypto.randomUUID(), title: 'NOVA DESPESA', linkedItemId: '' }]);
  };

  const removeColumn = (id: string) => {
    if (columns.length <= 1) return;
    setColumns(columns.filter(c => c.id !== id));
  };

  const updateColumn = (id: string, field: keyof ColumnData, value: string) => {
    setColumns(columns.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const handleValueEntry = (itemId: string, value: string) => {
    if (!itemId || value === '' || isNaN(parseFloat(value))) return;
    const expense: PartialExpense = {
      id: crypto.randomUUID(),
      date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      description: 'Gasto mensal',
      value: parseFloat(value)
    };

    // Pass explicit year/month so handleAddPartial skips credit card shift logic
    onAddPartial(itemId, expense, currentYear, currentMonthIdx);
  };

  return (
    <div className="p-3 lg:p-6 animate-in fade-in zoom-in-95 duration-500">
      <div className="mb-4 flex justify-end">
        <button
          onClick={addColumn}
          className="bg-yellow-600 active:bg-yellow-500 text-black font-black px-5 py-2.5 rounded-xl text-xs uppercase transition-all shadow-lg flex items-center gap-2"
        >
          <i className="fas fa-plus-circle"></i> Adicionar
        </button>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-6 pt-1 px-1 snap-x snap-mandatory">
        {columns.map((col) => {
          const linkedItem = items.find(i => i.id === col.linkedItemId);
          const teto = linkedItem ? (linkedItem.values[0] || 0) : 0;
          const partials = linkedItem?.partialExpenses?.[monthKey] || [];
          const totalSpent = partials.reduce((acc, p) => acc + p.value, 0);
          const isOverLimit = totalSpent > teto && teto > 0;
          const progressPct = teto > 0 ? Math.min(100, (totalSpent / teto) * 100) : 0;

          const card = linkedItem?.linkedCardId ? items.find(i => i.id === linkedItem.linkedCardId) : null;
          const todayDay = new Date().getDate();
          const isAfterClosing = card?.closingDay ? todayDay >= card.closingDay : false;
          const billingMonthIdx = isAfterClosing ? (currentMonthIdx + 1) % 12 : currentMonthIdx;
          const billingMonthName = MONTHS_BR[billingMonthIdx];

          return (
            <div key={col.id} className="w-[calc(100vw-48px)] lg:w-64 flex-shrink-0 snap-start flex flex-col rounded-2xl border border-zinc-800 overflow-hidden relative group">

              {/* Header: link + name */}
              <div className="bg-yellow-500">
                <select
                  className="w-full bg-transparent border-none text-[10px] font-black uppercase px-3 pt-3 pb-1 text-center text-black outline-none cursor-pointer"
                  value={col.linkedItemId}
                  onChange={(e) => updateColumn(col.id, 'linkedItemId', e.target.value)}
                >
                  <option value="" className="bg-yellow-500">VINCULAR ITEM</option>
                  {items.filter(i =>
                    i.category === CategoryType.FIXED_EXPENSE ||
                    i.category === CategoryType.VARIABLE_EXPENSE ||
                    i.category === CategoryType.PERSONAL_LEISURE
                  ).map(i => (
                    <option key={i.id} value={i.id} className="bg-yellow-100">
                      {i.description || 'Sem nome'}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={col.title}
                  onChange={(e) => updateColumn(col.id, 'title', e.target.value)}
                  className="w-full bg-transparent border-none text-center font-black text-xs uppercase px-3 pb-3 pt-0.5 text-black outline-none tracking-widest"
                  placeholder="NOME DA COLUNA"
                />
              </div>

              {/* Budget bar */}
              <div className={`px-4 py-3 ${isOverLimit ? 'bg-red-950/40' : 'bg-zinc-900'}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Teto</span>
                  <span className={`text-xs font-black font-mono ${isOverLimit ? 'text-red-400' : 'text-zinc-400'}`}>{formatCurrency(teto)}</span>
                </div>
                {teto > 0 && (
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${isOverLimit ? 'bg-red-500' : progressPct > 80 ? 'bg-yellow-500' : 'bg-green-500'}`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                )}
              </div>

              {/* Entry input */}
              <div className="bg-white border-t border-zinc-100">
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-[10px] font-bold">R$</div>
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="Lançar valor..."
                    className="w-full py-3 pl-8 pr-4 text-sm outline-none bg-transparent focus:bg-yellow-50/50 font-black text-zinc-900 transition-all placeholder:text-zinc-300 placeholder:font-normal placeholder:text-xs"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleValueEntry(col.linkedItemId, e.currentTarget.value);
                        e.currentTarget.value = '';
                      }
                    }}
                  />
                </div>
              </div>

              {/* Expense list */}
              <div className="flex flex-col bg-white border-t border-zinc-100">
                {partials.length === 0 ? (
                  <div className="py-4 text-center text-zinc-300 text-[10px] uppercase font-bold tracking-wider">
                    Nenhum lançamento
                  </div>
                ) : (
                  partials.map((p) => (
                    <div key={p.id} className="border-b border-zinc-50 flex items-center justify-between px-3 py-2">
                      <span className="text-[9px] text-zinc-400 font-bold uppercase">{p.date}</span>
                      <span className="text-xs font-black text-zinc-800 font-mono">{formatCurrency(p.value)}</span>
                      <button
                        onClick={() => onRemovePartial(col.linkedItemId, p.id)}
                        className="text-red-400 active:text-red-600 p-1 ml-1"
                      >
                        <i className="fas fa-times-circle text-xs"></i>
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Total footer */}
              <div className={`px-4 py-3 text-center mt-auto ${isOverLimit ? 'bg-red-50' : 'bg-zinc-900'} ${card ? '' : 'rounded-b-2xl'}`}>
                <p className={`text-[9px] font-black uppercase mb-0.5 ${isOverLimit ? 'text-red-500' : 'text-zinc-500'}`}>Total Lançado</p>
                <p className={`text-lg font-black font-mono tracking-tighter ${isOverLimit ? 'text-red-500' : 'text-yellow-500'}`}>
                  {formatCurrency(totalSpent)}
                </p>
                {isOverLimit && teto > 0 && (
                  <p className="text-red-400 text-[9px] font-bold mt-0.5">+{formatCurrency(totalSpent - teto)} acima do teto</p>
                )}
              </div>

              {card && (
                <div className="rounded-b-2xl border-t border-zinc-700 bg-zinc-800 px-3 py-2 text-center">
                  <p className="text-[9px] text-zinc-400 leading-relaxed">
                    <i className="fas fa-credit-card mr-1 text-yellow-500"></i>
                    Fatura <span className="text-yellow-400 font-black">{billingMonthName}</span>
                    {!isAfterClosing && <span className="text-zinc-600"> (aberta)</span>}
                  </p>
                </div>
              )}

              {/* Delete col button */}
              <button
                onClick={() => removeColumn(col.id)}
                className="absolute top-2 right-2 w-6 h-6 bg-black/20 active:bg-red-500/40 text-black/40 active:text-red-600 rounded-full flex items-center justify-center transition-all lg:opacity-0 lg:group-hover:opacity-100 z-20"
              >
                <i className="fas fa-times text-[9px]"></i>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TetoGastos;
