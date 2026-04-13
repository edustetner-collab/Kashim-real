
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
    <div className="p-2 md:p-6 animate-in fade-in zoom-in-95 duration-500">
      <div className="mb-6 flex justify-end">
        <button 
          onClick={addColumn}
          className="bg-yellow-600 hover:bg-yellow-500 text-black font-black px-6 py-3 rounded-xl text-xs uppercase transition-all shadow-lg flex items-center gap-2"
        >
          <i className="fas fa-plus-circle"></i> Adicionar Coluna
        </button>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-8 pt-2 px-2 scrollbar-thin scrollbar-thumb-yellow-600 scrollbar-track-zinc-900">
        {columns.map((col) => {
          const linkedItem = items.find(i => i.id === col.linkedItemId);

          const teto = linkedItem ? (linkedItem.values[0] || 0) : 0;

          const partials = linkedItem?.partialExpenses?.[monthKey] || [];
          const totalSpent = partials.reduce((acc, p) => acc + p.value, 0);
          const isOverLimit = totalSpent > teto && teto > 0;

          // Credit card billing month notice
          const card = linkedItem?.linkedCardId ? items.find(i => i.id === linkedItem.linkedCardId) : null;
          const todayDay = new Date().getDate();
          const isAfterClosing = card?.closingDay ? todayDay >= card.closingDay : false;
          const billingMonthIdx = isAfterClosing
            ? (currentMonthIdx + 1) % 12
            : currentMonthIdx;
          const billingYear = isAfterClosing && currentMonthIdx === 11 ? currentYear + 1 : currentYear;
          const billingMonthName = MONTHS_BR[billingMonthIdx];
          
          return (
            <div key={col.id} className="min-w-[260px] flex-shrink-0 flex flex-col group relative transition-all duration-300">
              
              <div className="bg-yellow-500 rounded-t-2xl p-1 border-b border-yellow-600">
                <select 
                  className="w-full bg-transparent border-none text-[10px] font-black uppercase p-3 text-center text-black outline-none cursor-pointer"
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
              </div>

              <div className="bg-zinc-900 border-x border-zinc-800">
                <input 
                  type="text" 
                  value={col.title}
                  onChange={(e) => updateColumn(col.id, 'title', e.target.value)}
                  className="w-full bg-transparent border-none text-center font-black text-[11px] uppercase p-3 text-white outline-none tracking-widest"
                  placeholder="NOME DA COLUNA"
                />
              </div>

              <div className={`border-x border-zinc-700 p-4 text-center ${isOverLimit ? 'bg-red-950/30' : 'bg-zinc-800'}`}>
                <p className="text-[8px] font-black text-zinc-400 uppercase tracking-widest mb-1 italic">Teto Planejado</p>
                <div className={`text-lg font-black font-mono ${isOverLimit ? 'text-red-500 animate-pulse' : 'text-yellow-500'}`}>
                  {formatCurrency(teto)}
                </div>
              </div>

              <div className="bg-white border-x border-zinc-200 shadow-inner">
                <div className="relative">
                   <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-300 text-[10px] font-bold">R$</div>
                   <input 
                    type="number" 
                    placeholder="Digitar valor e ENTER"
                    className="w-full p-4 pl-8 text-center text-sm outline-none bg-transparent focus:bg-yellow-50/50 font-black text-zinc-900 transition-all placeholder:text-zinc-300 placeholder:font-normal"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleValueEntry(col.linkedItemId, e.currentTarget.value);
                        e.currentTarget.value = '';
                      }
                    }}
                  />
                </div>
              </div>

              <div className="flex-grow flex flex-col bg-white border-x border-zinc-100 min-h-[350px]">
                {Array.from({ length: Math.max(12, partials.length) }).map((_, idx) => {
                  const p = partials[idx];
                  return (
                    <div key={idx} className={`border-b border-zinc-50 h-10 flex items-center justify-center relative group/row ${p ? 'hover:bg-zinc-50' : ''}`}>
                      {p ? (
                        <div className="w-full flex justify-between items-center px-4 animate-in fade-in">
                          <span className="text-[9px] text-zinc-400 font-bold uppercase">{p.date}</span>
                          <span className="text-xs font-black text-zinc-800 font-mono">{formatCurrency(p.value)}</span>
                          <button 
                            onClick={() => onRemovePartial(col.linkedItemId, p.id)}
                            className="opacity-0 group-hover/row:opacity-100 text-red-500 transition-all p-1"
                          >
                            <i className="fas fa-times-circle"></i>
                          </button>
                        </div>
                      ) : (
                        <div className="w-full h-[1px] bg-zinc-50/50 mx-4"></div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className={`p-5 border border-zinc-200 text-center shadow-lg transition-all ${isOverLimit ? 'bg-red-50' : 'bg-zinc-900'} ${card ? '' : 'rounded-b-2xl'}`}>
                <p className={`text-[9px] font-black uppercase mb-1 ${isOverLimit ? 'text-red-600' : 'text-zinc-500'}`}>Total Lançado</p>
                <p className={`text-xl font-black font-mono tracking-tighter ${isOverLimit ? 'text-red-600' : 'text-yellow-500'}`}>
                  {formatCurrency(totalSpent)}
                </p>
              </div>

              {card && (
                <div className="rounded-b-2xl border border-t-0 border-zinc-700 bg-zinc-800 px-4 py-3 text-center">
                  <p className="text-[10px] text-zinc-400 leading-relaxed">
                    <i className="fas fa-credit-card mr-1 text-yellow-500"></i>
                    Gastos no <span className="text-white font-black">{card.description}</span>
                    {isAfterClosing ? (
                      <> entram na <span className="text-yellow-400 font-black">fatura de {billingMonthName}</span></>
                    ) : (
                      <> entram na <span className="text-yellow-400 font-black">fatura de {billingMonthName}</span> (fatura aberta)</>
                    )}
                  </p>
                </div>
              )}

              <button 
                onClick={() => removeColumn(col.id)}
                className="absolute -top-3 -right-3 w-8 h-8 bg-zinc-900 text-zinc-500 hover:text-red-500 rounded-full border border-zinc-800 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-xl z-20"
              >
                <i className="fas fa-trash-alt text-xs"></i>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TetoGastos;
