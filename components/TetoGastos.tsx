
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { FinanceItem, PartialExpense, CategoryType } from '../types';
import { formatCurrency, MONTHS_BR } from '../constants';
import { SupabaseClient } from '@supabase/supabase-js';
import { loadTetoColumns, saveTetoColumns } from '../lib/db';

interface TetoGastosProps {
  items: FinanceItem[];
  currentMonthIdx: number;
  currentYear: number;
  // Slots do plano (0-11 a partir do mês inicial). Necessário porque
  // item.values[] é indexado por SLOT, não pelo mês do calendário.
  months: { index: number; year: number }[];
  onAddPartial: (itemId: string, expense: PartialExpense, year?: number, month?: number) => void;
  onRemovePartial: (itemId: string, expenseId: string) => void;
  db?: SupabaseClient | null;
  householdId?: string | null;
  // Alerta de teto: aviso na tela quando um gasto cruza X% do teto
  tetoAlert?: { enabled: boolean; pct: number };
}

interface ColumnData {
  id: string;
  title: string;
  linkedItemId: string;
}

function isRecurringItem(item: FinanceItem): boolean {
  return item.category === CategoryType.PERSONAL_LEISURE || item.category === CategoryType.VARIABLE_EXPENSE;
}

const TetoGastos: React.FC<TetoGastosProps> = ({ items, currentMonthIdx, currentYear, months, onAddPartial, onRemovePartial, db, householdId, tetoAlert }) => {
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

  // Slot do plano correspondente ao mês selecionado. O teto vem de
  // item.values[slot] — usar o mês do calendário aqui puxava o teto do mês
  // errado (ex.: teto de julho aparecia como o de outro mês). Bug 2026-07-11.
  const tetoSlotIdx = useMemo(() => {
    const [selYear, selMonth] = monthKey.split('-').map(Number);
    return months.findIndex(m => m.year === selYear && m.index === selMonth);
  }, [months, monthKey]);

  const [columns, setColumns] = useState<ColumnData[]>([]);
  const [tetoAlertData, setTetoAlertData] = useState<{ name: string; pct: number; teto: number; spent: number } | null>(null);

  // Isolamento de perfil: limpa estado e refs ao trocar de householdId
  // Sem isso, colunas de um cliente vazam para outro via localStorage ou estado residual
  const isFirstRender = useRef(true);
  const autoLinkedRef = useRef(false);
  useEffect(() => {
    setColumns([]);
    setColumnsLoaded(false);
    isFirstRender.current = true;
    autoLinkedRef.current = false;
  }, [householdId]);

  useEffect(() => {
    if (!db || !householdId) { setColumnsLoaded(true); return; }
    loadTetoColumns(db, householdId).then((rows) => {
      if (rows.length > 0) {
        const loaded = rows.map((r: any) => ({
          id: r.id,
          title: r.title,
          linkedItemId: r.linked_item_id ?? '',
        }));
        // Dedup: keep only the first column per linkedItemId to fix accumulated duplicates
        const seen = new Set<string>();
        const deduped = loaded.filter(col => {
          if (!col.linkedItemId) return true;
          if (seen.has(col.linkedItemId)) return false;
          seen.add(col.linkedItemId);
          return true;
        });
        setColumns(deduped);
      }
      // When Supabase has no columns, start empty — do NOT fall back to localStorage.
      // localStorage is not isolated per profile and causes cross-profile contamination.
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
  // Only run with real Supabase items (UUID IDs). Default placeholder items load before
  // Supabase completes and would cause incorrect auto-link and cleanedFixed behaviour.
  const hasRealItems = items.some(i => /^[0-9a-f]{8}-[0-9a-f]{4}/.test(i.id));

  useEffect(() => {
    if (!columnsLoaded || autoLinkedRef.current || !hasRealItems) return;
    autoLinkedRef.current = true;

    setColumns(prev => {
      const alreadyLinked = new Set(prev.map(c => c.linkedItemId).filter(Boolean));
      // Contas fixas que "gastam ao longo do mês" e merecem card de teto quando
      // preenchidas: mercado e gasolina. Lazer sempre tem card. Variáveis só
      // quando já têm lançamentos. Demais contas fixas NÃO criam card automático.
      const TETO_FIXED_KEYWORDS = ['mercado', 'gasolina'];
      const isTetoWorthy = (item: FinanceItem): boolean => {
        if (item.category === CategoryType.PERSONAL_LEISURE) return true;
        if (item.category === CategoryType.VARIABLE_EXPENSE) {
          return Object.values(item.partialExpenses ?? {}).some(arr => (arr as PartialExpense[]).length > 0);
        }
        if (item.category === CategoryType.FIXED_EXPENSE) {
          const desc = item.description.toLowerCase();
          return TETO_FIXED_KEYWORDS.some(k => desc.includes(k)) && item.values.some(v => v > 0);
        }
        return false;
      };
      const toAdd = items.filter(item => isTetoWorthy(item) && !alreadyLinked.has(item.id));
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
      const merged = [...updatedPrev, ...newCols];
      // Final dedup: prevent accumulation of duplicate columns across sessions
      const seenIds = new Set<string>();
      return merged.filter(col => {
        if (!col.linkedItemId) return true;
        if (seenIds.has(col.linkedItemId)) return false;
        seenIds.add(col.linkedItemId);
        return true;
      });
    });
  }, [columnsLoaded, items, hasRealItems]);

  // NOTA: havia aqui um efeito que removia automaticamente colunas ligadas a
  // Contas Fixas sem gastos registrados. Isso foi REMOVIDO (bug em produção
  // 2026-07-11): uma coluna só se liga a um item fixo por ação MANUAL do
  // usuário (o auto-link acima só cria para variáveis/lazer). Então o efeito só
  // apagava cards criados pelo próprio usuário — e, por timing (antes do gasto
  // sincronizar do banco), sumia até com cards que já tinham gasto. Remoção de
  // card agora é só pelo botão de excluir.

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

  // Variable expense columns only show when they have entries in the viewed month.
  // Fixed, Leisure, CreditCard columns always show.
  const displayColumns = useMemo(() => {
    return columns.filter(col => {
      if (!col.linkedItemId) return true;
      const linkedItem = items.find(i => i.id === col.linkedItemId);
      if (!linkedItem) return true;
      if (linkedItem.category === CategoryType.VARIABLE_EXPENSE) {
        const partials = linkedItem.partialExpenses?.[monthKey] || [];
        return partials.length > 0;
      }
      return true;
    });
  }, [columns, items, monthKey]);

  const columnsScrollRef = useRef<HTMLDivElement>(null);
  const [visibleColIdx, setVisibleColIdx] = useState(0);

  const scrollToCard = (idx: number) => {
    const container = columnsScrollRef.current;
    if (!container) return;
    const cardWidth = container.scrollWidth / Math.max(displayColumns.length, 1);
    container.scrollTo({ left: idx * cardWidth, behavior: 'smooth' });
  };

  const handleContainerScroll = () => {
    const container = columnsScrollRef.current;
    if (!container || displayColumns.length === 0) return;
    const cardWidth = container.scrollWidth / displayColumns.length;
    const idx = Math.round(container.scrollLeft / cardWidth);
    setVisibleColIdx(Math.max(0, Math.min(idx, displayColumns.length - 1)));
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
  const [installCardIds, setInstallCardIds] = useState<Record<string, string>>({});
  const [deletePartialConfirm, setDeletePartialConfirm] = useState<{ itemId: string; expId: string; description: string; value: number } | null>(null);
  const [editPartialConfirm, setEditPartialConfirm] = useState<{ itemId: string; expId: string; description: string; value: number; date: string; monthKey: string } | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editValue, setEditValue] = useState('');
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

    // Alerta de teto: dispara só quando ESTE gasto cruza o limite (não repete
    // nos lançamentos seguintes do mesmo mês).
    if (tetoAlert?.enabled && linkedItem && tetoSlotIdx >= 0) {
      const teto = linkedItem.values[tetoSlotIdx] || 0;
      if (teto > 0) {
        const before = (linkedItem.partialExpenses?.[monthKey] || []).reduce((a, p) => a + p.value, 0);
        const after = before + parsed;
        const limit = teto * (tetoAlert.pct / 100);
        if (after >= limit && before < limit) {
          setTetoAlertData({ name: linkedItem.description || 'este gasto', pct: Math.round((after / teto) * 100), teto, spent: after });
        }
      }
    }

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

    const creditCardItems = items.filter(i => i.category === CategoryType.CREDIT_CARD);
    const selectedCardId = installCardIds[colId];
    if (creditCardItems.length > 0 && !selectedCardId) return;

    const selectedCard = selectedCardId ? items.find(i => i.id === selectedCardId) : null;
    const linkedItem = items.find(i => i.id === itemId);
    const card = selectedCard ?? (linkedItem?.linkedCardId ? items.find(i => i.id === linkedItem.linkedCardId) : null);
    const cardLabel = card?.description ? ` (${card.description})` : '';

    const startAbsMonth = currentYear * 12 + currentMonthIdx;
    const baseValue = parseFloat((total / qty).toFixed(2));

    for (let i = 0; i < qty; i++) {
      const absMonth = startAbsMonth + i;
      const targetMonthIdx = absMonth % 12;
      const targetYear = Math.floor(absMonth / 12);
      const value = i === qty - 1 ? parseFloat((total - baseValue * (qty - 1)).toFixed(2)) : baseValue;
      const expense: PartialExpense = {
        id: crypto.randomUUID(),
        date: `01/${String(targetMonthIdx + 1).padStart(2, '0')}`,
        description: `${data.desc.trim()} ${i + 1}/${qty}${cardLabel}`,
        value,
      };
      onAddPartial(itemId, expense, targetYear, targetMonthIdx);
    }

    setInstallMode(prev => ({ ...prev, [colId]: false }));
    setInstallData(prev => ({ ...prev, [colId]: { desc: '', total: '', qty: '2' } }));
    setInstallCardIds(prev => ({ ...prev, [colId]: '' }));
  };

  const updateInstall = (colId: string, field: 'desc' | 'total' | 'qty', value: string) => {
    setInstallData(prev => ({
      ...prev,
      [colId]: { ...(prev[colId] ?? { desc: '', total: '', qty: '2' }), [field]: value },
    }));
  };

  return (
    <div className="p-3 lg:p-6 animate-in fade-in zoom-in-95 duration-500">
      {/* Pop-up de alerta de teto */}
      {tetoAlertData && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setTetoAlertData(null)}>
          <div className="w-full max-w-sm bg-zinc-900 border border-orange-500/40 rounded-3xl p-6 shadow-2xl text-center" onClick={e => e.stopPropagation()}>
            <div className="w-16 h-16 rounded-full bg-orange-500/10 border border-orange-500/30 flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-triangle-exclamation text-2xl text-orange-400"></i>
            </div>
            <h3 className="text-white text-lg font-black italic uppercase tracking-tighter mb-2">Atenção ao teto!</h3>
            <p className="text-zinc-400 text-sm leading-relaxed mb-5">
              Você já usou <span className="text-orange-400 font-black">{tetoAlertData.pct}%</span> do seu teto de{' '}
              <span className="text-white font-bold">{tetoAlertData.name}</span> este mês
              ({formatCurrency(tetoAlertData.spent)} de {formatCurrency(tetoAlertData.teto)}). Pise no freio para não estourar.
            </p>
            <button
              onClick={() => setTetoAlertData(null)}
              className="w-full text-black font-black py-3.5 rounded-2xl text-xs uppercase tracking-widest active:scale-95 transition-all"
              style={{ background: 'linear-gradient(90deg, #fb923c, #f97316)' }}
            >
              Entendi
            </button>
          </div>
        </div>
      )}

      <div className="mb-4 flex items-center gap-2">
        <div className="relative">
          <select
            value={selectedMonthKey}
            onChange={e => setSelectedMonthKey(e.target.value)}
            className="appearance-none bg-white text-[#1d1d1f] font-black text-xs uppercase px-4 py-2.5 pr-8 rounded-xl border border-[#e8e8ed] outline-none cursor-pointer"
          >
            {availableMonths.map(key => (
              <option key={key} value={key}>
                {labelForKey(key)}{key === currentMonthKey ? ' ●' : ''}
              </option>
            ))}
          </select>
          <i className="fas fa-chevron-down text-[#aeaeb2] text-[9px] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"></i>
        </div>
        {!isHistoricalView && (
          <button
            onClick={addColumn}
            className="k-btn-lime px-5 py-2.5 flex items-center gap-2 shrink-0"
          >
            <i className="fas fa-plus-circle"></i> Adicionar
          </button>
        )}
      </div>

      {isHistoricalView && (
        <div className="mb-3 flex items-center gap-2 bg-[#f5f5f7] border border-[#e8e8ed] rounded-xl px-4 py-2">
          <i className="fas fa-history text-[#7ab800] text-xs"></i>
          <span className="text-[#aeaeb2] text-xs font-bold uppercase tracking-widest">
            Histórico: {labelForKey(selectedMonthKey)} — somente leitura
          </span>
        </div>
      )}

      {sortColId && (
        <p className="text-[9px] font-black uppercase tracking-widest text-[#7ab800] text-center mb-2 animate-pulse">
          Use ← → para mover • toque no card para fechar
        </p>
      )}

      {/* Navigation arrows + dots — only shown when there are multiple cards */}
      {displayColumns.length > 1 && (
        <div className="flex items-center justify-between px-1 mb-2">
          <button
            onClick={() => scrollToCard(visibleColIdx - 1)}
            disabled={visibleColIdx === 0}
            className={`w-8 h-8 flex items-center justify-center rounded-full transition-all ${visibleColIdx === 0 ? 'text-[#d2d2d7]' : 'text-[#7ab800] active:bg-[#f0fad0]'}`}
          >
            <i className="fas fa-chevron-left text-sm"></i>
          </button>
          <div className="flex items-center gap-1.5">
            {displayColumns.map((_, i) => (
              <button
                key={i}
                onClick={() => scrollToCard(i)}
                className={`rounded-full transition-all ${i === visibleColIdx ? 'w-4 h-1.5 bg-[#a8e716]' : 'w-1.5 h-1.5 bg-[#e8e8ed]'}`}
              />
            ))}
          </div>
          <button
            onClick={() => scrollToCard(visibleColIdx + 1)}
            disabled={visibleColIdx === displayColumns.length - 1}
            className={`w-8 h-8 flex items-center justify-center rounded-full transition-all ${visibleColIdx === displayColumns.length - 1 ? 'text-[#d2d2d7]' : 'text-[#7ab800] active:bg-[#f0fad0]'}`}
          >
            <i className="fas fa-chevron-right text-sm"></i>
          </button>
        </div>
      )}

      <div ref={columnsScrollRef} onScroll={handleContainerScroll} className="flex gap-3 items-start overflow-x-auto pb-6 pt-1 px-1 snap-x snap-mandatory scrollbar-none">
        {/* Loading skeleton — avoids a blank screen while columns load from the DB */}
        {!columnsLoaded && displayColumns.length === 0 && [0, 1].map(i => (
          <div key={`sk-${i}`} className="w-[calc(100vw-48px)] lg:w-64 flex-shrink-0 snap-start rounded-2xl border border-[#e8e8ed] overflow-hidden bg-white">
            <div className="h-11 bg-[#f0fad0] animate-pulse"></div>
            <div className="p-4 space-y-3">
              <div className="h-3 w-2/3 bg-[#f5f5f7] rounded animate-pulse"></div>
              <div className="h-2 w-full bg-[#f5f5f7] rounded-full animate-pulse"></div>
              <div className="h-9 w-full bg-[#f5f5f7] rounded-xl animate-pulse"></div>
              <div className="h-3 w-1/2 bg-[#f5f5f7] rounded animate-pulse"></div>
              <div className="h-3 w-3/4 bg-[#f5f5f7] rounded animate-pulse"></div>
            </div>
          </div>
        ))}
        {displayColumns.map((col, colIdx) => {
          const linkedItem = items.find(i => i.id === col.linkedItemId);
          const teto = linkedItem && tetoSlotIdx >= 0 ? (linkedItem.values[tetoSlotIdx] || 0) : 0;
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
                isSorting ? 'border-[#a8e716] ring-2 ring-[rgba(168,231,22,0.3)] scale-[0.98]' :
                isUnlinked ? 'border-orange-500/40' :
                'border-[#e8e8ed]'
              }`}
            >

              {/* Header */}
              <div className={isUnlinked ? 'bg-orange-500/10 border-b border-orange-500/20' : 'bg-[#f0fad0]'}>
                {isSorting && (
                  <div className="flex items-center justify-between px-2 pt-1.5 pb-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); moveSortCol(col.id, -1); }}
                      className="w-8 h-7 flex items-center justify-center bg-black/10 active:bg-black/20 rounded-lg text-[#1d1d1f] font-black text-sm"
                    >‹</button>
                    <span className="text-[9px] font-black uppercase tracking-widest text-[#6e6e73]">Mover</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); moveSortCol(col.id, 1); }}
                      className="w-8 h-7 flex items-center justify-center bg-black/10 active:bg-black/20 rounded-lg text-[#1d1d1f] font-black text-sm"
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
                      deleteConfirmId === col.id ? 'bg-[#ff3b30] text-white scale-110' :
                      'bg-[#ff3b30]/15 text-[#ff3b30] active:bg-[#ff3b30] active:text-white'
                    }`}
                  >
                    <i className="fas fa-times text-[9px]"></i>
                  </button>
                  <select
                    className={`flex-1 bg-transparent border-none text-[10px] font-black uppercase text-center outline-none cursor-pointer ${isUnlinked ? 'text-orange-400' : 'text-[#1d1d1f]'}`}
                    value={col.linkedItemId}
                    onChange={(e) => updateColumn(col.id, 'linkedItemId', e.target.value)}
                  >
                    <option value="" className="bg-white text-orange-400">⚠ VINCULAR ITEM</option>
                    {items.filter(i =>
                      i.category === CategoryType.FIXED_EXPENSE ||
                      i.category === CategoryType.VARIABLE_EXPENSE ||
                      i.category === CategoryType.PERSONAL_LEISURE
                    ).map(i => (
                      <option key={i.id} value={i.id} className="bg-white text-[#1d1d1f]">
                        {i.description || 'Sem nome'}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="text"
                  value={col.title}
                  onChange={(e) => updateColumn(col.id, 'title', e.target.value)}
                  className={`w-full bg-transparent border-none text-center font-black text-xs uppercase px-3 pb-3 pt-0.5 outline-none tracking-widest ${isUnlinked ? 'text-orange-400/80 placeholder:text-orange-400/40' : 'text-[#1d1d1f]'}`}
                  placeholder="NOME DA COLUNA"
                />
              </div>

              {/* Delete confirmation banner */}
              {deleteConfirmId === col.id && (
                <div className="bg-[#fff0f0] border-b border-[rgba(255,59,48,0.2)] px-3 py-2 flex items-center justify-between gap-2">
                  <p className="text-[9px] text-[#ff3b30] font-bold leading-tight flex-1">
                    Excluir apagará todos os lançamentos vinculados a esta despesa.
                  </p>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="px-2.5 py-1 rounded-lg bg-[#f5f5f7] border border-[#e8e8ed] text-[#6e6e73] text-[9px] font-black uppercase"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => { removeColumn(col.id); setDeleteConfirmId(null); }}
                      className="px-2.5 py-1 rounded-lg bg-[#ff3b30] text-white text-[9px] font-black uppercase active:opacity-80"
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              )}

              {/* Budget bar — only when a budget is set */}
              {teto > 0 && (
                <div className={`px-4 py-3 ${isOverLimit ? 'bg-[#fff0f0]' : 'bg-[#fafafa]'}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[8px] font-black text-[#aeaeb2] uppercase tracking-widest">Teto</span>
                    <span className={`text-xs font-black k-num ${isOverLimit ? 'text-[#ff3b30]' : 'text-[#6e6e73]'}`}>{formatCurrency(teto)}</span>
                  </div>
                  <div className="h-1.5 bg-[#e8e8ed] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${isOverLimit ? 'bg-[#ff3b30]' : progressPct > 80 ? 'bg-[#a8e716]' : 'bg-[#7ab800]'}`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Entry form */}
              {!isHistoricalView && (
                <div className="bg-white border-t border-[#e8e8ed]">
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
                            ? 'bg-[#fff0f0] border-[rgba(255,59,48,0.3)] placeholder:text-[#ff3b30] placeholder:font-bold'
                            : 'bg-[#f5f5f7] border-[#e8e8ed] placeholder:text-[#aeaeb2]'
                        } text-[#1d1d1f]`}
                      />
                      <div className="flex items-center pr-4">
                        <div className="pl-3 text-[#aeaeb2] text-[10px] font-bold shrink-0">R$</div>
                        <input
                          ref={el => { valueInputRefs.current[col.id] = el; }}
                          type="number"
                          inputMode="decimal"
                          placeholder="Valor..."
                          className="flex-1 min-w-0 py-3 pl-2 pr-2 text-sm outline-none bg-transparent focus:bg-[#f0fad0]/30 font-black text-[#1d1d1f] transition-all placeholder:text-[#d2d2d7] placeholder:font-normal placeholder:text-xs k-num"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSubmitEntry(col.id, col.linkedItemId, e.currentTarget.value);
                          }}
                        />
                        <button
                          onClick={() => handleSubmitEntry(col.id, col.linkedItemId, valueInputRefs.current[col.id]?.value ?? '')}
                          className="ml-2 shrink-0 k-btn-lime text-[10px] px-3 py-1.5"
                        >
                          OK
                        </button>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setInstallMode(prev => ({ ...prev, [col.id]: true })); }}
                        className="w-full flex items-center justify-center gap-2 py-2.5 border-t border-[#e8e8ed] bg-[#f5f5f7] active:bg-[#e8e8ed] transition-colors"
                      >
                        <i className="fas fa-credit-card text-[#7ab800] text-[10px]"></i>
                        <span className="text-[10px] font-black uppercase tracking-widest text-[#7ab800]">Parcelar</span>
                        <i className="fas fa-chevron-right text-[8px] text-[#aeaeb2]"></i>
                      </button>
                    </>
                  ) : (() => {
                    const creditCardItems = items.filter(i => i.category === CategoryType.CREDIT_CARD);
                    const installCardMissing = creditCardItems.length > 0 && !installCardIds[col.id];
                    return (
                    <div className="p-3 space-y-2">
                      <p className="text-[9px] font-black uppercase text-[#aeaeb2] tracking-widest flex items-center gap-1">
                        <i className="fas fa-credit-card text-[#7ab800]"></i> Compra Parcelada
                      </p>
                      <input
                        type="text"
                        placeholder="Ex: Tênis Nike"
                        value={iData?.desc ?? ''}
                        onChange={e => updateInstall(col.id, 'desc', e.target.value)}
                        className="w-full py-2 px-3 text-[11px] outline-none border border-[#e8e8ed] rounded-lg bg-[#f5f5f7] text-[#1d1d1f] placeholder:text-[#aeaeb2]"
                      />
                      {creditCardItems.length > 0 && (
                        <select
                          value={installCardIds[col.id] ?? ''}
                          onChange={e => setInstallCardIds(prev => ({ ...prev, [col.id]: e.target.value }))}
                          className={`w-full py-2 px-3 text-xs outline-none border rounded-lg font-black text-[#1d1d1f] ${installCardMissing ? 'border-[rgba(255,59,48,0.4)] bg-[#fff8f8]' : 'border-[#e8e8ed] bg-[#f5f5f7]'}`}
                        >
                          <option value="">🔴 Selecionar cartão *</option>
                          {creditCardItems.map(card => (
                            <option key={card.id} value={card.id}>{card.description}</option>
                          ))}
                        </select>
                      )}
                      <div className="flex gap-2">
                        <div className="flex-1 flex items-center border border-[#e8e8ed] rounded-lg bg-[#f5f5f7] overflow-hidden">
                          <span className="pl-2 text-[#aeaeb2] text-[10px] font-bold shrink-0">R$</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            placeholder="Total"
                            value={iData?.total ?? ''}
                            onChange={e => updateInstall(col.id, 'total', e.target.value)}
                            className="flex-1 pl-1 pr-2 py-2 text-sm outline-none bg-transparent font-black text-[#1d1d1f] k-num"
                          />
                        </div>
                        <select
                          value={iData?.qty ?? '2'}
                          onChange={e => updateInstall(col.id, 'qty', e.target.value)}
                          className="w-16 py-2 px-2 text-xs outline-none border border-[#e8e8ed] rounded-lg bg-[#f5f5f7] font-black text-[#1d1d1f] appearance-none text-center"
                        >
                          {[2,3,4,5,6,7,8,9,10,12,18,24].map(n => (
                            <option key={n} value={String(n)}>{n}x</option>
                          ))}
                        </select>
                      </div>
                      {installPreview && (
                        <p className="text-[9px] text-[#6e6e73] text-center font-bold k-num">
                          {installQty}x de {installPreview} / mês
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSubmitInstallment(col.id, col.linkedItemId)}
                          disabled={installCardMissing || !iData?.desc?.trim() || !iData?.total}
                          className={`flex-1 py-2.5 ${(installCardMissing || !iData?.desc?.trim() || !iData?.total) ? 'bg-[#e8e8ed] text-[#aeaeb2] font-black text-[10px] rounded-lg uppercase cursor-not-allowed' : 'k-btn-lime'}`}
                        >
                          Confirmar
                        </button>
                        <button
                          onClick={() => { setInstallMode(prev => ({ ...prev, [col.id]: false })); setInstallCardIds(prev => ({ ...prev, [col.id]: '' })); }}
                          className="px-3 bg-[#f5f5f7] border border-[#e8e8ed] text-[#6e6e73] font-black text-[10px] py-2.5 rounded-lg uppercase"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                    );
                  })()}
                </div>
              )}

              {/* Expense list — only shown when there are expenses */}
              {partials.length > 0 && (
                <div className="flex flex-col bg-white border-t border-[#e8e8ed]">
                  {partials.map((p) => (
                    <div key={p.id} className="border-b border-[#f5f5f7] flex items-center gap-2 px-3 py-2">
                      <span className="text-[9px] text-[#aeaeb2] font-bold uppercase shrink-0">{p.date}</span>
                      <button
                        className="flex-1 flex items-center gap-2 min-w-0 text-left active:opacity-60"
                        onClick={() => {
                          if (isHistoricalView) return;
                          setEditPartialConfirm({ itemId: col.linkedItemId, expId: p.id, description: p.description, value: p.value, date: p.date, monthKey });
                          setEditDesc(p.description);
                          setEditValue(String(p.value));
                        }}
                      >
                        <span className="flex-1 text-[10px] text-[#6e6e73] font-medium truncate">{p.description}</span>
                        <span className="text-xs font-black text-[#1d1d1f] k-num shrink-0">{formatCurrency(p.value)}</span>
                      </button>
                      <button
                        onClick={() => setDeletePartialConfirm({ itemId: col.linkedItemId, expId: p.id, description: p.description, value: p.value })}
                        className="text-[#ff3b30]/60 active:text-[#ff3b30] p-1 shrink-0"
                      >
                        <i className="fas fa-times-circle text-xs"></i>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Total footer — only shown when there are expenses */}
              {totalSpent > 0 && (
                <div className={`px-4 py-3 text-center mt-auto ${isOverLimit ? 'bg-[#fff0f0]' : 'bg-[#fafafa]'} ${card ? '' : 'rounded-b-2xl'}`}>
                  <p className={`text-[9px] font-black uppercase mb-0.5 ${isOverLimit ? 'text-[#ff3b30]' : 'text-[#aeaeb2]'}`}>Total Lançado</p>
                  <p className={`text-lg font-black k-num tracking-tighter ${isOverLimit ? 'text-[#ff3b30]' : 'text-[#7ab800]'}`}>
                    {formatCurrency(totalSpent)}
                  </p>
                  {isOverLimit && teto > 0 && (
                    <p className="text-[#ff3b30] text-[9px] font-bold mt-0.5 k-num">+{formatCurrency(totalSpent - teto)} acima do teto</p>
                  )}
                </div>
              )}

              {card && (
                <div className="rounded-b-2xl border-t border-[#e8e8ed] bg-[#f5f5f7] px-3 py-2 text-center">
                  <p className="text-[9px] text-[#aeaeb2] leading-relaxed">
                    <i className="fas fa-credit-card mr-1 text-[#7ab800]"></i>
                    Fatura <span className="text-[#7ab800] font-black">{billingMonthName}</span>
                    {!isAfterClosing && <span className="text-[#aeaeb2]"> (aberta)</span>}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Delete expense confirmation modal */}
      {deletePartialConfirm && (
        <div className="fixed inset-0 z-[60] flex items-end" onClick={() => setDeletePartialConfirm(null)}>
          <div className="w-full bg-white rounded-t-3xl p-6 pb-10 border-t border-[#e8e8ed] animate-in slide-in-from-bottom-4 duration-200" onClick={e => e.stopPropagation()}>
            <div className="w-8 h-1 bg-[#e8e8ed] rounded-full mx-auto mb-5" />
            <div className="flex items-center gap-3 mb-4">
              <div className="w-11 h-11 rounded-full bg-[#fff0f0] flex items-center justify-center shrink-0">
                <i className="fas fa-trash-alt text-[#ff3b30] text-base" />
              </div>
              <div className="min-w-0">
                <p className="text-[#1d1d1f] font-black text-sm">Excluir lançamento?</p>
                <p className="text-[#6e6e73] text-xs mt-0.5 truncate">{deletePartialConfirm.description}</p>
                <p className="text-[#ff3b30] text-xs font-black mt-0.5 k-num">{formatCurrency(deletePartialConfirm.value)}</p>
              </div>
            </div>
            <div className="bg-[#fff8f0] border border-[rgba(255,149,0,0.2)] rounded-xl p-3 mb-5">
              <p className="text-[#6e6e73] text-[11px] leading-relaxed">
                <i className="fas fa-exclamation-triangle text-[#ff9500] mr-1.5" />
                Esta operação <strong className="text-[#1d1d1f]">não poderá ser desfeita</strong>. Se for uma parcela, apenas esta será removida — as demais continuam.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setDeletePartialConfirm(null)}
                className="flex-1 py-3.5 rounded-2xl bg-[#f5f5f7] text-[#1d1d1f] font-black text-sm border border-[#e8e8ed] active:opacity-70"
              >
                Cancelar
              </button>
              <button
                onClick={() => { onRemovePartial(deletePartialConfirm.itemId, deletePartialConfirm.expId); setDeletePartialConfirm(null); }}
                className="flex-1 py-3.5 rounded-2xl bg-[#ff3b30] text-white font-black text-sm active:opacity-80"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
      {editPartialConfirm && (
        <div className="fixed inset-0 z-[60] flex items-end" onClick={() => setEditPartialConfirm(null)}>
          <div className="w-full bg-white rounded-t-3xl p-6 pb-10 border-t border-[#e8e8ed] animate-in slide-in-from-bottom-4 duration-200" onClick={e => e.stopPropagation()}>
            <div className="w-8 h-1 bg-[#e8e8ed] rounded-full mx-auto mb-5" />
            <div className="flex items-center gap-3 mb-4">
              <div className="w-11 h-11 rounded-full bg-[#f0fad0] flex items-center justify-center shrink-0">
                <i className="fas fa-pen text-[#7ab800] text-base" />
              </div>
              <div>
                <p className="text-[#1d1d1f] font-black text-sm">Editar lançamento</p>
                <p className="text-[#6e6e73] text-xs mt-0.5">Altere a descrição ou o valor</p>
              </div>
            </div>
            <div className="space-y-3 mb-5">
              <div>
                <p className="text-[9px] text-[#aeaeb2] font-black uppercase tracking-widest mb-1.5">Descrição</p>
                <input
                  type="text"
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  className="w-full py-2.5 px-3 text-sm border border-[#e8e8ed] rounded-xl bg-[#f5f5f7] text-[#1d1d1f] outline-none focus:border-[#7ab800]"
                  autoFocus
                />
              </div>
              <div>
                <p className="text-[9px] text-[#aeaeb2] font-black uppercase tracking-widest mb-1.5">Valor</p>
                <div className="flex items-center border border-[#e8e8ed] rounded-xl bg-[#f5f5f7] overflow-hidden">
                  <span className="pl-3 text-[#aeaeb2] text-sm font-bold shrink-0">R$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    className="flex-1 pl-2 pr-3 py-2.5 text-sm bg-transparent text-[#1d1d1f] font-black outline-none k-num"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setEditPartialConfirm(null)}
                className="flex-1 py-3.5 rounded-2xl bg-[#f5f5f7] text-[#1d1d1f] font-black text-sm border border-[#e8e8ed] active:opacity-70"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  const newValue = parseFloat(editValue.replace(',', '.'));
                  if (!editDesc.trim() || isNaN(newValue) || newValue <= 0) return;
                  const [targetYear, targetMonthIdx] = editPartialConfirm.monthKey.split('-').map(Number);
                  onRemovePartial(editPartialConfirm.itemId, editPartialConfirm.expId);
                  onAddPartial(editPartialConfirm.itemId, {
                    id: crypto.randomUUID(),
                    date: editPartialConfirm.date,
                    description: editDesc.trim(),
                    value: newValue,
                  }, targetYear, targetMonthIdx);
                  setEditPartialConfirm(null);
                }}
                className="flex-[2] py-3.5 rounded-2xl bg-[#7ab800] text-white font-black text-sm active:opacity-80"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TetoGastos;
