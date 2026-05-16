
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

  useEffect(() => { setSelectedMonthKey(currentMonthKey); }, [currentMonthKey]);

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

  const [columns, setColumns] = useState<ColumnData[]>([]);

  // Isolamento de perfil: limpa estado e refs ao trocar de householdId
  // Sem isso, colunas de um cliente vazam para outro via localStorage ou estado residual
  const isFirstRender = useRef(true);
  const autoLinkedRef = useRef(false);
  const cleanedFixedRef = useRef(false);
  useEffect(() => {
    setColumns([]);
    setColumnsLoaded(false);
    isFirstRender.current = true;
    autoLinkedRef.current = false;
    cleanedFixedRef.current = false;
  }, [householdId]);

  useEffect(() => {
    if (!db || !householdId) { setColumnsLoaded(true); return; }
    loadTetoColumns(db, householdId).then((rows) => {
      if (rows.length > 0) {
        setColumns(rows.map((r: any) => ({
          id: r.id,
          title: r.title,
          linkedItemId: r.linked_item_id ?? '',
        })));
      } else {
        // Migração: importa colunas do localStorage se Supabase estiver vazio
        try {
          const saved = localStorage.getItem('teto_columns_v3');
          if (saved) {
            const local = JSON.parse(saved) as { id?: string; title?: string; linkedItemId?: string }[];
            if (Array.isArray(local) && local.length > 0) {
              setColumns(local.map(c => ({
                id: c.id || crypto.randomUUID(),
                title: c.title || '',
                linkedItemId: c.linkedItemId || '',
              })));
            }
          }
        } catch {}
      }
      setColumnsLoaded(true);
    }).catch(() => setColumnsLoaded(true));
  }, [db, householdId]);

  useEffect(() => {
    if (!columnsLoaded) return;
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (db && householdId) {
      saveTetoColumns(db, householdId, columns).catch(() => {});
    }
  }, [columns, columnsLoaded]);
  useEffect(() => {
    if (!columnsLoaded || autoLinkedRef.current || items.length === 0) return;
    autoLinkedRef.current = true;

    setColumns(prev => {
      const alreadyLinked = new Set(prev.map(c => c.linkedItemId).filter(Boolean));
      const isExpenseCategory = (item: FinanceItem) =>
        item.category === CategoryType.FIXED_EXPENSE ||
        item.category === CategoryType.VARIABLE_EXPENSE ||
        item.category === CategoryType.PERSONAL_LEISURE;
      const hasActivity = (item: FinanceItem) =>
        item.values.some(v => v > 0) ||
        Object.values(item.partialExpenses ?? {}).some(arr => (arr as PartialExpense[]).length > 0);
      const toAdd = items.filter(item =>
        isExpenseCategory(item) &&
        hasActivity(item) &&
        !alreadyLinked.has(item.id)
      );
      if (toAdd.length === 0) return prev;
      const updatedPrev = prev.map(col => {
        if (col.linkedItemId) return col;
        const colTitle = col.title.toLowerCase();
        const match = toAdd.find(item => {
          const desc = item.description.toLowerCase();
          return desc.includes(colTitle) || colTitle.split(' ').some(word => word.length > 3 && desc.includes(word));
        });
        return match ? { ...col, linkedItemId: match.id } : col;
      });
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

  // Remove columns linked to FIXED_EXPENSE items that have no recorded expenses.
  // Fixed items (internet, celular) don't need transaction tracking — only variable/leisure do.
  useEffect(() => {
    if (!columnsLoaded || cleanedFixedRef.current || items.length === 0) return;
    cleanedFixedRef.current = true;
    setColumns(prev => {
      const cleaned = prev.filter(col => {
        if (!col.linkedItemId) return true;
        const linked = items.find(i => i.id === col.linkedItemId);
        if (!linked || linked.category !== CategoryType.FIXED_EXPENSE) return true;
        return Object.values(linked.partialExpenses ?? {}).some(arr => (arr as PartialExpense[]).length > 0);
      });
      return cleaned.length !== prev.length ? cleaned : prev;
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
  const [visibleColIdx, setVisibleColIdx] = useState(0);

  const scrollToCard = (idx: number) => {
    const container = columnsScrollRef.current;
    if (!container) return;
    const cardWidth = container.scrollWidth / Math.max(columns.length, 1);
    container.scrollTo({ left: idx * cardWidth, behavior: 'smooth' });
  };

  const handleContainerScroll = () => {
    const container = columnsScrollRef.current;
    if (!container || columns.length === 0) return;
    const cardWidth = container.scrollWidth / columns.length;
    const idx = Math.round(container.scrollLeft / cardWidth);
    setVisibleColIdx(Math.max(0, Math.min(idx, columns.length - 1)));
  };

  // Sort mode: long-press activates, then use ← → arrows to move the card
  const [sortColId, setSortColId] = useState<string | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleColTouchStart = (colId: string) => (e: React.TouchEvent) => {
    if (isHistoricalView) return;
    if (longPressRef.current) clearTimeout(longPressRef.current);
    longPressStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    longPressRef.current = setTimeout(() => {
      longPressRef.current = null;
      setSortColId(colId);
      if ('vibrate' in navigator) (navigator as any).vibrate(40);
    }, 450);
  };

  const handleColTouchMove = (e: React.TouchEvent) => {
    if (!longPressRef.current || !longPressStartRef.current) return;
    const dx = Math.abs(e.touches[0].clientX - longPressStartRef.current.x);
    const dy = Math.abs(e.touches[0].clientY - longPressStartRef.current.y);
    if (dx > 10 || dy > 10) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  const handleColTouchEnd = () => {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
    longPressStartRef.current = null;
  };

  const moveSortCol = (colId: string, dir: -1 | 1) => {
    setColumns(prev => {
      const idx = prev.findIndex(c => c.id === colId);
      if (idx === -1) return prev;
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr;
    });
  };

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleDeletePress = (col: ColumnData) => {
    if (isHistoricalView || columns.length <= 1) return;
    if (col.linkedItemId) {
      setDeleteConfirmId(col.id === deleteConfirmId ? null : col.id);
    } else {
      removeColumn(col.id);
    }
  };

  const [entryDescriptions, setEntryDescriptions] = useState<Record<string, string>>({});
  const [entryErrors, setEntryErrors] = useState<Record<string, boolean>>({});
  const [installMode, setInstallMode] = useState<Record<string, boolean>>({});
  const [installData, setInstallData] = useState<Record<string, { desc: string; total: string; qty: string }>>({});
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
      value: parsed,
    };
    onAddPartial(itemId, expense, currentYear, currentMonthIdx);
    if (valueInputRefs.current[colId]) valueInputRefs.current[colId]!.value = '';
    setEntryDescriptions(prev => ({ ...prev, [colId]: '' }));
    setEntryErrors(prev => ({ ...prev, [colId]: false }));
  };

  const handleSubmitInstallment = (colId: string, itemId: string) => {
    if (!itemId) return;
    const data = installData[colId];
    if (!data?.desc.trim() || !data.total) return;
    const total = parseFloat(data.total.replace(',', '.'));
    const qty = parseInt(data.qty) || 2;
    if (isNaN(total) || total <= 0 || qty < 2 || qty > 24) return;

    const linkedItem = items.find(i => i.id === itemId);
    const card = linkedItem?.linkedCardId ? items.find(i => i.id === linkedItem.linkedCardId) : null;
    const todayDay = new Date().getDate();
    const isAfterClosing = card?.closingDay ? todayDay >= card.closingDay : false;

    // Absolute month index to handle year boundaries safely
    const startAbsMonth = (currentYear * 12 + currentMonthIdx) + (isAfterClosing ? 1 : 0);
    const baseValue = parseFloat((total / qty).toFixed(2));

    for (let i = 0; i < qty; i++) {
      const absMonth = startAbsMonth + i;
      const targetMonthIdx = absMonth % 12;
      const targetYear = Math.floor(absMonth / 12);
      // Last installment absorbs rounding remainder
      const value = i === qty - 1 ? parseFloat((total - baseValue * (qty - 1)).toFixed(2)) : baseValue;
      const expense: PartialExpense = {
        id: crypto.randomUUID(),
        date: `01/${String(targetMonthIdx + 1).padStart(2, '0')}`,
        description: `${data.desc.trim()} ${i + 1}/${qty}`,
        value,
      };
      onAddPartial(itemId, expense, targetYear, targetMonthIdx);
    }

    setInstallMode(prev => ({ ...prev, [colId]: false }));
    setInstallData(prev => ({ ...prev, [colId]: { desc: '', total: '', qty: '2' } }));
  };

  const updateInstall = (colId: string, field: 'desc' | 'total' | 'qty', value: string) => {
    setInstallData(prev => ({
      ...prev,
      [colId]: { ...(prev[colId] ?? { desc: '', total: '', qty: '2' }), [field]: value },
    }));
  };

  return (
    <div className="p-3 lg:p-6 animate-in fade-in zoom-in-95 duration-500">
      <div className="mb-4 flex items-center gap-2">
        <div className="relative">
          <select
            value={selectedMonthKey}
            onChange={e => setSelectedMonthKey(e.target.value)}
            className="appearance-none bg-zinc-800 text-white font-black text-xs uppercase px-4 py-2.5 pr-8 rounded-xl border border-zinc-700 outline-none cursor-pointer"
          >
            {availableMonths.map(key => (
              <option key={key} value={key}>
                {labelForKey(key)}{key === currentMonthKey ? ' ●' : ''}
              </option>
            ))}
          </select>
          <i className="fas fa-chevron-down text-zinc-400 text-[9px] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"></i>
        </div>
        {!isHistoricalView && (
          <button
            onClick={addColumn}
            className="bg-green-500 active:bg-green-400 text-black font-black px-5 py-2.5 rounded-xl text-xs uppercase transition-all shadow-lg flex items-center gap-2 shrink-0"
          >
            <i className="fas fa-plus-circle"></i> Adicionar
          </button>
        )}
      </div>

      {isHistoricalView && (
        <div className="mb-3 flex items-center gap-2 bg-zinc-800/60 border border-zinc-700 rounded-xl px-4 py-2">
          <i className="fas fa-history text-green-400 text-xs"></i>
          <span className="text-zinc-400 text-xs font-bold uppercase tracking-widest">
            Histórico: {labelForKey(selectedMonthKey)} — somente leitura
          </span>
        </div>
      )}

      {sortColId && (
        <p className="text-[9px] font-black uppercase tracking-widest text-green-400 text-center mb-2 animate-pulse">
          Use ← → para mover • toque no card para fechar
        </p>
      )}

      {/* Navigation arrows + dots — only shown when there are multiple cards */}
      {columns.length > 1 && (
        <div className="flex items-center justify-between px-1 mb-2">
          <button
            onClick={() => scrollToCard(visibleColIdx - 1)}
            disabled={visibleColIdx === 0}
            className={`w-8 h-8 flex items-center justify-center rounded-full transition-all ${visibleColIdx === 0 ? 'text-zinc-700' : 'text-green-400 active:bg-green-400/10'}`}
          >
            <i className="fas fa-chevron-left text-sm"></i>
          </button>
          <div className="flex items-center gap-1.5">
            {columns.map((_, i) => (
              <button
                key={i}
                onClick={() => scrollToCard(i)}
                className={`rounded-full transition-all ${i === visibleColIdx ? 'w-4 h-1.5 bg-green-400' : 'w-1.5 h-1.5 bg-zinc-600'}`}
              />
            ))}
          </div>
          <button
            onClick={() => scrollToCard(visibleColIdx + 1)}
            disabled={visibleColIdx === columns.length - 1}
            className={`w-8 h-8 flex items-center justify-center rounded-full transition-all ${visibleColIdx === columns.length - 1 ? 'text-zinc-700' : 'text-green-400 active:bg-green-400/10'}`}
          >
            <i className="fas fa-chevron-right text-sm"></i>
          </button>
        </div>
      )}

      <div ref={columnsScrollRef} onScroll={handleContainerScroll} className="flex gap-3 items-start overflow-x-auto pb-6 pt-1 px-1 snap-x snap-mandatory scrollbar-none">
        {columns.map((col, colIdx) => {
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

          const inInstallMode = !!installMode[col.id];
          const iData = installData[col.id];
          const installTotal = parseFloat(iData?.total?.replace(',', '.') || '0');
          const installQty = parseInt(iData?.qty || '2');
          const installPreview = iData?.total && !isNaN(installTotal) && installTotal > 0 && installQty >= 2
            ? formatCurrency(installTotal / installQty)
            : null;

          const isUnlinked = !col.linkedItemId;
          const isSorting = sortColId === col.id;

          return (
            <div
              key={col.id}
              onTouchStart={handleColTouchStart(col.id)}
              onTouchMove={handleColTouchMove}
              onTouchEnd={handleColTouchEnd}
              onClick={() => { if (isSorting) setSortColId(null); }}
              className={`w-[calc(100vw-48px)] lg:w-64 flex-shrink-0 snap-start flex flex-col rounded-2xl border overflow-hidden transition-all duration-150 ${
                isSorting ? 'border-green-400 ring-2 ring-green-400/40 scale-[0.98]' :
                isUnlinked ? 'border-orange-500/40' :
                'border-zinc-800'
              }`}
            >

              {/* Header */}
              <div className={isUnlinked ? 'bg-orange-500/10 border-b border-orange-500/20' : 'bg-green-400'}>
                {isSorting && (
                  <div className="flex items-center justify-between px-2 pt-1.5 pb-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); moveSortCol(col.id, -1); }}
                      className="w-8 h-7 flex items-center justify-center bg-black/20 active:bg-black/40 rounded-lg text-black font-black text-sm"
                    >‹</button>
                    <span className="text-[9px] font-black uppercase tracking-widest text-black/70">Mover</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); moveSortCol(col.id, 1); }}
                      className="w-8 h-7 flex items-center justify-center bg-black/20 active:bg-black/40 rounded-lg text-black font-black text-sm"
                    >›</button>
                  </div>
                )}
                {isUnlinked && (
                  <div className="px-3 pt-2 pb-0.5 flex items-center gap-1.5">
                    <i className="fas fa-exclamation-triangle text-orange-400 text-[9px]"></i>
                    <span className="text-orange-400 text-[9px] font-black uppercase tracking-widest">Vincular ao orçamento</span>
                  </div>
                )}
                <div className="flex items-center gap-1 px-2 pt-2 pb-0.5">
                  <button
                    onClick={() => handleDeletePress(col)}
                    className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all ${
                      isHistoricalView || columns.length <= 1 ? 'opacity-0 pointer-events-none' :
                      deleteConfirmId === col.id ? 'bg-red-500 text-white scale-110' :
                      'bg-red-500/20 text-red-400 active:bg-red-500 active:text-white'
                    }`}
                  >
                    <i className="fas fa-times text-[9px]"></i>
                  </button>
                  <select
                    className={`flex-1 bg-transparent border-none text-[10px] font-black uppercase text-center outline-none cursor-pointer ${isUnlinked ? 'text-orange-400' : 'text-black'}`}
                    value={col.linkedItemId}
                    onChange={(e) => updateColumn(col.id, 'linkedItemId', e.target.value)}
                  >
                    <option value="" className="bg-zinc-900 text-orange-400">⚠ VINCULAR ITEM</option>
                    {items.filter(i =>
                      i.category === CategoryType.FIXED_EXPENSE ||
                      i.category === CategoryType.VARIABLE_EXPENSE ||
                      i.category === CategoryType.PERSONAL_LEISURE
                    ).map(i => (
                      <option key={i.id} value={i.id} className="bg-zinc-900 text-white">
                        {i.description || 'Sem nome'}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="text"
                  value={col.title}
                  onChange={(e) => updateColumn(col.id, 'title', e.target.value)}
                  className={`w-full bg-transparent border-none text-center font-black text-xs uppercase px-3 pb-3 pt-0.5 outline-none tracking-widest ${isUnlinked ? 'text-orange-400/80 placeholder:text-orange-400/40' : 'text-black'}`}
                  placeholder="NOME DA COLUNA"
                />
              </div>

              {/* Delete confirmation banner */}
              {deleteConfirmId === col.id && (
                <div className="bg-red-950 border-b border-red-800 px-3 py-2 flex items-center justify-between gap-2">
                  <p className="text-[9px] text-red-300 font-bold leading-tight flex-1">
                    Excluir apagará todos os lançamentos vinculados a esta despesa.
                  </p>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="px-2.5 py-1 rounded-lg bg-zinc-700 text-zinc-300 text-[9px] font-black uppercase active:bg-zinc-600"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => { removeColumn(col.id); setDeleteConfirmId(null); }}
                      className="px-2.5 py-1 rounded-lg bg-red-600 text-white text-[9px] font-black uppercase active:bg-red-500"
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              )}

              {/* Budget bar — only when a budget is set */}
              {teto > 0 && (
                <div className={`px-4 py-3 ${isOverLimit ? 'bg-red-950/40' : 'bg-zinc-900'}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Teto</span>
                    <span className={`text-xs font-black font-mono ${isOverLimit ? 'text-red-400' : 'text-zinc-400'}`}>{formatCurrency(teto)}</span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${isOverLimit ? 'bg-red-500' : progressPct > 80 ? 'bg-green-400' : 'bg-green-500'}`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Entry form */}
              {!isHistoricalView && (
                <div className="bg-white border-t border-zinc-100">
                  {!inInstallMode ? (
                    <>
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
                          className="mr-2 bg-green-400 active:bg-green-300 text-black font-black text-[10px] px-3 py-1.5 rounded-lg uppercase shrink-0"
                        >
                          OK
                        </button>
                      </div>
                      <button
                        onClick={() => setInstallMode(prev => ({ ...prev, [col.id]: true }))}
                        className="w-full text-center text-[9px] text-zinc-400 active:text-green-500 py-1.5 font-bold uppercase tracking-widest border-t border-zinc-100 transition-colors"
                      >
                        <i className="fas fa-credit-card mr-1"></i>Parcelar
                      </button>
                    </>
                  ) : (
                    <div className="p-3 space-y-2">
                      <p className="text-[9px] font-black uppercase text-zinc-500 tracking-widest flex items-center gap-1">
                        <i className="fas fa-credit-card text-green-400"></i> Compra Parcelada
                      </p>
                      <input
                        type="text"
                        placeholder="Ex: Tênis Nike"
                        value={iData?.desc ?? ''}
                        onChange={e => updateInstall(col.id, 'desc', e.target.value)}
                        className="w-full py-2 px-3 text-[11px] outline-none border border-zinc-200 rounded-lg bg-zinc-50 text-zinc-700"
                      />
                      <div className="flex gap-2">
                        <div className="flex-1 flex items-center border border-zinc-200 rounded-lg bg-zinc-50 overflow-hidden">
                          <span className="pl-2 text-zinc-400 text-[10px] font-bold shrink-0">R$</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            placeholder="Total"
                            value={iData?.total ?? ''}
                            onChange={e => updateInstall(col.id, 'total', e.target.value)}
                            className="flex-1 pl-1 pr-2 py-2 text-sm outline-none bg-transparent font-black text-zinc-900"
                          />
                        </div>
                        <select
                          value={iData?.qty ?? '2'}
                          onChange={e => updateInstall(col.id, 'qty', e.target.value)}
                          className="w-16 py-2 px-2 text-xs outline-none border border-zinc-200 rounded-lg bg-zinc-50 font-black text-zinc-900 appearance-none text-center"
                        >
                          {[2,3,4,5,6,7,8,9,10,12,18,24].map(n => (
                            <option key={n} value={String(n)}>{n}x</option>
                          ))}
                        </select>
                      </div>
                      {installPreview && (
                        <p className="text-[9px] text-zinc-500 text-center font-bold">
                          {installQty}x de {installPreview} / mês
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSubmitInstallment(col.id, col.linkedItemId)}
                          className="flex-1 bg-green-400 active:bg-green-300 text-black font-black text-[10px] py-2.5 rounded-lg uppercase"
                        >
                          Confirmar
                        </button>
                        <button
                          onClick={() => setInstallMode(prev => ({ ...prev, [col.id]: false }))}
                          className="px-3 bg-zinc-100 active:bg-zinc-200 text-zinc-500 font-black text-[10px] py-2.5 rounded-lg uppercase"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Expense list — only shown when there are expenses */}
              {partials.length > 0 && (
                <div className="flex flex-col bg-white border-t border-zinc-100">
                  {partials.map((p) => (
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
                  ))}
                </div>
              )}

              {/* Total footer — only shown when there are expenses */}
              {totalSpent > 0 && (
                <div className={`px-4 py-3 text-center mt-auto ${isOverLimit ? 'bg-red-50' : 'bg-zinc-900'} ${card ? '' : 'rounded-b-2xl'}`}>
                  <p className={`text-[9px] font-black uppercase mb-0.5 ${isOverLimit ? 'text-red-500' : 'text-zinc-500'}`}>Total Lançado</p>
                  <p className={`text-lg font-black font-mono tracking-tighter ${isOverLimit ? 'text-red-500' : 'text-green-400'}`}>
                    {formatCurrency(totalSpent)}
                  </p>
                  {isOverLimit && teto > 0 && (
                    <p className="text-red-400 text-[9px] font-bold mt-0.5">+{formatCurrency(totalSpent - teto)} acima do teto</p>
                  )}
                </div>
              )}

              {card && (
                <div className="rounded-b-2xl border-t border-zinc-700 bg-zinc-800 px-3 py-2 text-center">
                  <p className="text-[9px] text-zinc-400 leading-relaxed">
                    <i className="fas fa-credit-card mr-1 text-green-400"></i>
                    Fatura <span className="text-green-300 font-black">{billingMonthName}</span>
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
