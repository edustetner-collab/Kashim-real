
import React, { useState, useEffect, useRef, useMemo } from 'react';
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


function isRecurringItem(item: FinanceItem): boolean {
  return item.category === CategoryType.PERSONAL_LEISURE || item.category === CategoryType.VARIABLE_EXPENSE;
}

const TetoGastos: React.FC<TetoGastosProps> = ({ items, currentMonthIdx, currentYear, onAddPartial, onRemovePartial, db, householdId }) => {
  const currentMonthKey = `${currentYear}-${currentMonthIdx}`;
  const [selectedMonthKey, setSelectedMonthKey] = useState(currentMonthKey);
  const [columnsLoaded, setColumnsLoaded] = useState(false);

  // Sync selected month to current when month changes externally
  useEffect(() => { setSelectedMonthKey(currentMonthKey); }, [currentMonthKey]);

  // Collect all months that have any recorded expenses
  const availableMonths = useMemo(() => {
    const keys = new Set<string>();
    keys.add(currentMonthKey);
    items.forEach(item => {
      if (!item.partialExpenses) return;
      Object.entries(item.partialExpenses).forEach(([k, entries]) => {
        if (entries && (entries as PartialExpense[]).length > 0) keys.add(k);
      });
    });
    return Array.from(keys).sort((a, b) => {
      const [ay, am] = a.split('-').map(Number);
      const [by, bm] = b.split('-').map(Number);
      return ay !== by ? by - ay : bm - am;
    });
  }, [items, currentMonthKey]);

  function labelForKey(key: string): string {
    const [year, mIdx] = key.split('-').map(Number);
    return `${MONTHS_BR[mIdx]} ${year}`;
  }

  const isHistoricalView = selectedMonthKey !== currentMonthKey;
  const monthKey = selectedMonthKey;

  const [columns, setColumns] = useState<ColumnData[]>(() => {
    const saved = localStorage.getItem('teto_columns_v3');
    return saved ? JSON.parse(saved) : [];
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
    setTimeout(() => {
      columnsScrollRef.current?.scrollTo({ left: columnsScrollRef.current.scrollWidth, behavior: 'smooth' });
    }, 50);
  };

  const removeColumn = (id: string) => {
    if (columns.length <= 1) return;
    setColumns(columns.filter(c => c.id !== id));
  };

  const updateColumn = (id: string, field: keyof ColumnData, value: string) => {
    setColumns(columns.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const columnsScrollRef = useRef<HTMLDivElement>(null);
  const [entryDescriptions, setEntryDescriptions] = useState<Record<string, string>>({});
  const [entryErrors, setEntryErrors] = useState<Record<string, boolean>>({});
  const valueInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const handleSubmitEntry = (colId: string, itemId: string, value: string) => {
    if (!itemId) return;
    const desc = entryDescriptions[colId]?.trim();
    if (!desc) {
      setEntryErrors(prev => ({ ...prev, [colId]: true }));
      return;
    }
    const parsed = parseFloat(value.replace(',', '.'));
    if (!value || isNaN(parsed) || parsed <= 0) return;
    const linkedItem = items.find(i => i.id === itemId);
    const expense: PartialExpense = {
      id: crypto.randomUUID(),
      date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      description: desc || linkedItem?.description || 'Gasto',
      value: parsed
    };
    onAddPartial(itemId, expense, currentYear, currentMonthIdx);
    if (valueInputRefs.current[colId]) valueInputRefs.current[colId]!.value = '';
    setEntryDescriptions(prev => ({ ...prev, [colId]: '' }));
    setEntryErrors(prev => ({ ...prev, [colId]: false }));
  };

  return (
    <div className="p-3 lg:p-6 animate-in fade-in zoom-in-95 duration-500">
      {/* ── Month history filter + Adicionar (mesma linha) ── */}
      <div className="mb-4 flex items-center gap-2 overflow-x-auto scrollbar-none pb-1">
        {availableMonths.map(key => (
          <button
            key={key}
            onClick={() => setSelectedMonthKey(key)}
            className={`px-4 py-2 rounded-xl text-xs font-black uppercase whitespace-nowrap transition-all shrink-0 ${
              key === selectedMonthKey
                ? 'bg-yellow-600 text-black shadow-lg'
                : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            {labelForKey(key)}
            {key === currentMonthKey && <span className="ml-1 text-[8px] opacity-60">●</span>}
          </button>
        ))}
        {!isHistoricalView && (
          <button
            onClick={addColumn}
            className="bg-yellow-600 active:bg-yellow-500 text-black font-black px-5 py-2.5 rounded-xl text-xs uppercase transition-all shadow-lg flex items-center gap-2 shrink-0"
          >
            <i className="fas fa-plus-circle"></i> Adicionar
          </button>
        )}
      </div>

      {isHistoricalView && (
        <div className="mb-3 flex items-center gap-2 bg-zinc-800/60 border border-zinc-700 rounded-xl px-4 py-2">
          <i className="fas fa-history text-yellow-500 text-xs"></i>
          <span className="text-zinc-400 text-xs font-bold uppercase tracking-widest">
            Histórico: {labelForKey(selectedMonthKey)} — somente leitura
          </span>
        </div>
      )}

      <div ref={columnsScrollRef} className="flex gap-3 overflow-x-auto pb-6 pt-1 px-1 snap-x snap-mandatory">
        {columns.map((col) => {
          const linkedItem = items.find(i => i.id === col.linkedItemId);
          const teto = linkedItem ? (linkedItem.values[currentMonthIdx] || 0) : 0;
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
                <div className="flex items-center gap-1 px-2 pt-2 pb-0.5">
                  <button
                    onClick={() => !isHistoricalView && removeColumn(col.id)}
                    className={`w-5 h-5 bg-black/10 rounded-full flex items-center justify-center shrink-0 transition-all ${isHistoricalView ? 'opacity-0 pointer-events-none' : 'active:bg-red-500/40 text-black/40 active:text-red-700'}`}
                    title="Remover coluna"
                  >
                    <i className="fas fa-times text-[8px]"></i>
                  </button>
                  <select
                    className="flex-1 bg-transparent border-none text-[10px] font-black uppercase text-center text-black outline-none cursor-pointer"
                    value={col.linkedItemId}
                    onChange={(e) => updateColumn(col.id, 'linkedItemId', e.target.value)}
                  >
                    <option value="" className="bg-yellow-500">VINCULAR ITEM</option>
                    {items.filter(i =>
                      i.category === CategoryType.VARIABLE_EXPENSE ||
                      i.category === CategoryType.PERSONAL_LEISURE
                    ).map(i => (
                      <option key={i.id} value={i.id} className="bg-yellow-100">
                        {i.description || 'Sem nome'}
                      </option>
                    ))}
                  </select>
                </div>
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

              {/* Entry input — hidden in historical view */}
              {!isHistoricalView && (
                <div className="bg-white border-t border-zinc-100">
                  <input
                    type="text"
                    placeholder={entryErrors[col.id] ? '⚠ Descrição obrigatória' : 'Descrição *'}
                    value={entryDescriptions[col.id] ?? ''}
                    onChange={e => {
                      setEntryDescriptions(prev => ({ ...prev, [col.id]: e.target.value }));
                      if (e.target.value.trim()) setEntryErrors(prev => ({ ...prev, [col.id]: false }));
                    }}
                    className={`w-full py-2 px-3 text-[11px] outline-none border-b transition-colors ${
                      entryErrors[col.id]
                        ? 'bg-red-50 border-red-300 placeholder:text-red-400 placeholder:font-bold'
                        : 'bg-zinc-50 border-zinc-100 placeholder:text-zinc-400'
                    } text-zinc-700`}
                  />
                  <div className="flex items-center">
                    <div className="pl-3 text-zinc-400 text-[10px] font-bold shrink-0">R$</div>
                    <input
                      ref={el => { valueInputRefs.current[col.id] = el; }}
                      type="number"
                      inputMode="decimal"
                      placeholder="Valor..."
                      className="flex-1 py-3 pl-2 pr-2 text-sm outline-none bg-transparent focus:bg-yellow-50/50 font-black text-zinc-900 transition-all placeholder:text-zinc-300 placeholder:font-normal placeholder:text-xs"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSubmitEntry(col.id, col.linkedItemId, e.currentTarget.value);
                      }}
                    />
                    <button
                      onClick={() => handleSubmitEntry(col.id, col.linkedItemId, valueInputRefs.current[col.id]?.value ?? '')}
                      className="mr-2 bg-yellow-500 active:bg-yellow-400 text-black font-black text-[10px] px-3 py-1.5 rounded-lg uppercase shrink-0"
                    >
                      OK
                    </button>
                  </div>
                </div>
              )}

              {/* Expense list */}
              <div className="flex flex-col bg-white border-t border-zinc-100">
                {partials.length === 0 ? (
                  <div className="py-4 text-center text-zinc-300 text-[10px] uppercase font-bold tracking-wider">
                    Nenhum lançamento
                  </div>
                ) : (
                  partials.map((p) => (
                    <div key={p.id} className="border-b border-zinc-50 flex items-center gap-2 px-3 py-2">
                      <span className="text-[9px] text-zinc-400 font-bold uppercase shrink-0">{p.date}</span>
                      <span className="flex-1 text-[10px] text-zinc-600 font-medium truncate">{p.description}</span>
                      <span className="text-xs font-black text-zinc-800 font-mono shrink-0">{formatCurrency(p.value)}</span>
                      <button
                        onClick={() => onRemovePartial(col.linkedItemId, p.id)}
                        className="text-red-400 active:text-red-600 p-1 shrink-0"
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

            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TetoGastos;
