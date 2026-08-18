
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { FinanceItem, PartialExpense, CategoryType } from '../types';
import { formatCurrency, MONTHS_BR } from '../constants';
import { SupabaseClient } from '@supabase/supabase-js';
import { loadTetoColumns, saveTetoColumns } from '../lib/db';
import RecategorizarSheet from './RecategorizarSheet';
import { getSourceInfo } from '../lib/paymentSource';

/** Rótulo curto por categoria, para o seletor do diálogo de edição. */
const CATEGORY_SHORT: Record<string, string> = {
  [CategoryType.FIXED_EXPENSE]: 'Fixa',
  [CategoryType.VARIABLE_EXPENSE]: 'Variável',
  [CategoryType.PERSONAL_LEISURE]: 'Lazer',
  [CategoryType.CREDIT_CARD]: 'Cartão',
};

interface TetoGastosProps {
  items: FinanceItem[];
  currentMonthIdx: number;
  currentYear: number;
  // Slots do plano (0-11 a partir do mês inicial). Necessário porque
  // item.values[] é indexado por SLOT, não pelo mês do calendário.
  months: { index: number; year: number }[];
  onAddPartial: (itemId: string, expense: PartialExpense, year?: number, month?: number) => void;
  onRemovePartial: (itemId: string, expenseId: string) => void;
  /** Item que veio do Plano — rola até ele e destaca ao abrir. */
  focusItemId?: string | null;
  onFocusHandled?: () => void;
  db?: SupabaseClient | null;
  householdId?: string | null;
  // Traduz o id local do item para o id que ele tem no banco. Sem isto, o
  // vínculo do card era gravado com um id que pode não existir em
  // finance_items, e a foreign key rejeitava a gravação (erro 23503).
  resolveDbId?: (localId: string) => string;
  // Alerta de teto: aviso na tela quando um gasto cruza X% do teto
  tetoAlert?: { enabled: boolean; pct: number };
  // Cria nova linha de gasto no plano e retorna o id
  onCreateItem?: (description: string, category: CategoryType) => string;
  /** Vindo do Plano: filtra este item nesta fonte de pagamento ao abrir. */
  initialFilter?: { linkedItemId: string; sourceKey: string } | null;
  /** Chamado depois de aplicar o filtro inicial, para limpar o estado no pai. */
  onInitialFilterHandled?: () => void;
}

interface ColumnData {
  id: string;
  title: string;
  linkedItemId: string;
}

function isRecurringItem(item: FinanceItem): boolean {
  return item.category === CategoryType.PERSONAL_LEISURE || item.category === CategoryType.VARIABLE_EXPENSE;
}

// Traduz o erro do Postgres para algo acionável na tela. Mensagem genérica não
// ajuda ninguém: cada um destes códigos aponta para uma causa diferente.
function describeSaveError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === '23503') {
    // FK: o card aponta para um lançamento que não chegou ao banco — quase
    // sempre porque o INSERT do próprio lançamento foi barrado antes (42501).
    return 'O lançamento vinculado a este card não foi salvo, então o card não pode ser gravado. Confira se o lançamento aparece em Gastos Mensais.';
  }
  if (code === '42501' || code === 'PGRST301') {
    return 'Sem permissão para gravar nesta conta. Se você está acessando como consultor, o acesso de escrita precisa ser liberado.';
  }
  return 'Verifique a conexão — o app segue tentando sozinho.';
}

const TetoGastos: React.FC<TetoGastosProps> = ({ items, currentMonthIdx, currentYear, months, onAddPartial, onRemovePartial, db, householdId, resolveDbId, tetoAlert, focusItemId, onFocusHandled, onCreateItem, initialFilter, onInitialFilterHandled }) => {
  const currentMonthKey = `${currentYear}-${currentMonthIdx}`;

  // MÊS DE TRABALHO: normalmente o mês corrente do calendário — mas o plano do
  // cliente pode começar no FUTURO (cliente cadastrado em julho com plano a
  // partir de agosto). Nesse caso o mês corrente não tem slot no plano,
  // `tetoSlotIdx` dava -1, o teto vinha zero e o card aparecia SEM limite; o
  // seletor também não oferecia nenhum mês válido para escolher (bug real na
  // conta da Miriam, 2026-07-24). Aqui caímos no primeiro mês do plano.
  const planMonthKeys = useMemo(
    () => months.map(m => `${m.year}-${m.index}`),
    [months]
  );
  const workingMonthKey = useMemo(
    () => (planMonthKeys.includes(currentMonthKey) ? currentMonthKey : (planMonthKeys[0] ?? currentMonthKey)),
    [planMonthKeys, currentMonthKey]
  );

  // Ano/mês do mês de trabalho — é NELE que os lançamentos entram. Usar o mês do
  // calendário aqui gravava o gasto num mês fora do plano, e ele simplesmente
  // não aparecia no card (que exibe o mês de trabalho).
  const [workingYear, workingMonthIdx] = useMemo(() => {
    const [y, m] = workingMonthKey.split('-').map(Number);
    return [y, m] as const;
  }, [workingMonthKey]);

  const [selectedMonthKey, setSelectedMonthKey] = useState(workingMonthKey);
  const [columnsLoaded, setColumnsLoaded] = useState(false);

  useEffect(() => { setSelectedMonthKey(workingMonthKey); }, [workingMonthKey]);

  const availableMonths = useMemo(() => {
    const keys = new Set<string>();
    keys.add(workingMonthKey);
    // Meses do plano ATÉ o mês de trabalho (passados + atual), mesmo vazios —
    // assim dá pra abrir um mês passado e lançar retroativo.
    const [wy, wm] = workingMonthKey.split('-').map(Number);
    const wAbs = wy * 12 + wm;
    planMonthKeys.forEach(k => {
      const [y, m] = k.split('-').map(Number);
      if (y * 12 + m <= wAbs) keys.add(k);
    });
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
  }, [items, workingMonthKey, planMonthKeys]);

  function labelForKey(key: string): string {
    const [year, mIdx] = key.split('-').map(Number);
    return `${MONTHS_BR[mIdx]} ${year}`;
  }

  // Compara com o mês de TRABALHO, não com o do calendário: senão, num plano
  // que começa no futuro, a tela abriria permanentemente em modo somente-leitura.
  const monthKey = selectedMonthKey;
  // Mês SELECIONADO em índice absoluto. Passados do plano são EDITÁVEIS (permite
  // lançamento retroativo); só o FUTURO fica somente-leitura (é planejamento).
  const [selYear, selMonthIdx] = useMemo(() => {
    const [y, m] = selectedMonthKey.split('-').map(Number);
    return [y, m] as const;
  }, [selectedMonthKey]);
  const selAbs = selYear * 12 + selMonthIdx;
  const workingAbs = workingYear * 12 + workingMonthIdx;
  const isFutureView = selAbs > workingAbs;
  const isPastView = selAbs < workingAbs;

  // Slot do plano correspondente ao mês selecionado. O teto vem de
  // item.values[slot] — usar o mês do calendário aqui puxava o teto do mês
  // errado (ex.: teto de julho aparecia como o de outro mês). Bug 2026-07-11.
  const tetoSlotIdx = useMemo(() => {
    const [selYear, selMonth] = monthKey.split('-').map(Number);
    return months.findIndex(m => m.year === selYear && m.index === selMonth);
  }, [months, monthKey]);

  const [columns, setColumns] = useState<ColumnData[]>([]);
  const [tetoAlertData, setTetoAlertData] = useState<{ name: string; pct: number; teto: number; spent: number } | null>(null);

  // `columnsLoaded` controla só o skeleton da UI. Quem libera GRAVAR e
  // AUTO-CRIAR é `dbSynced`, que só vira true quando o load do banco realmente
  // resolveu. Separar os dois é essencial: antes, quando `db`/`householdId`
  // ainda não estavam prontos, o componente marcava "carregado", o auto-link
  // rodava sobre uma lista VAZIA e o save seguinte apagava no banco os cards
  // que o usuário tinha criado (bug dos cards que sumiam ao trocar de aba).
  const [dbSynced, setDbSynced] = useState(false);

  // Isolamento de perfil: limpa estado e refs ao trocar de householdId
  // Sem isso, colunas de um cliente vazam para outro via localStorage ou estado residual
  const loadedForRef = useRef<string | null>(null);   // household já carregado
  const lastSavedRef = useRef<string>('[]');           // JSON do último estado persistido
  const savingRef = useRef(false);                     // save em voo (evita corrida)
  const failuresRef = useRef(0);                       // falhas seguidas do mesmo estado
  const lastAttemptRef = useRef<string>('');           // JSON da última tentativa
  const [saveTick, setSaveTick] = useState(0);         // reexecuta o save após cada tentativa
  const [saveFailed, setSaveFailed] = useState<string | null>(null); // motivo da falha → aviso na tela

  // Cards que o usuário apagou de propósito. O auto-link agora reage a QUALQUER
  // mudança nos itens, então sem este registro um card removido voltaria
  // sozinho no render seguinte (ressurreição — mesmo padrão de bug que já
  // aconteceu com os lançamentos excluídos).
  const dismissedRef = useRef<Set<string>>(new Set());
  const dismissKey = householdId ? `kashim_teto_dismissed_${householdId}` : '';
  const rememberDismissed = (linkedItemId: string) => {
    if (!linkedItemId) return;
    dismissedRef.current.add(linkedItemId);
    if (!dismissKey) return;
    try { localStorage.setItem(dismissKey, JSON.stringify(Array.from(dismissedRef.current))); } catch {}
  };

  useEffect(() => {
    setColumns([]);
    setColumnsLoaded(false);
    setDbSynced(false);
    loadedForRef.current = null;
    lastSavedRef.current = '[]';
    savingRef.current = false;
    failuresRef.current = 0;
    lastAttemptRef.current = '';
    let restored = new Set<string>();
    if (householdId) {
      try {
        const raw = localStorage.getItem(`kashim_teto_dismissed_${householdId}`);
        if (raw) restored = new Set(JSON.parse(raw) as string[]);
      } catch {}
    }
    dismissedRef.current = restored;
  }, [householdId]);

  useEffect(() => {
    if (!db || !householdId) {
      // Sem banco ainda: libera só o skeleton. NÃO marca dbSynced — nada pode
      // ser gravado nem auto-criado enquanto a verdade do banco não chegou.
      setColumnsLoaded(true);
      return;
    }
    // Carrega UMA vez por household. O client do Supabase é recriado a cada
    // ~50s (renovação de token) — sem esta trava, o load redisparava e
    // SOBRESCREVIA o que o usuário tinha na tela (perda do 1º lançamento,
    // bug real 2026-07-16).
    if (loadedForRef.current === householdId) return;
    loadedForRef.current = householdId;
    loadTetoColumns(db, householdId).then((rows) => {
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
      // MERGE com o que o usuário digitou ENQUANTO o load estava em voo —
      // substituir o estado apagava a primeira adição (setColumns(deduped)
      // chegava depois do Enter do usuário). Local vem por último.
      setColumns(prev => {
        if (prev.length === 0) return deduped;
        const dbIds = new Set(deduped.map(c => c.id));
        const dbLinked = new Set(deduped.map(c => c.linkedItemId).filter(Boolean));
        const localOnly = prev.filter(c => !dbIds.has(c.id) && !(c.linkedItemId && dbLinked.has(c.linkedItemId)));
        return [...deduped, ...localOnly];
      });
      // Só considera "salvo" o que veio do banco; se houve merge local, o save
      // logo abaixo persiste a diferença.
      lastSavedRef.current = JSON.stringify(deduped);
      // When Supabase has no columns, start empty — do NOT fall back to localStorage.
      // localStorage is not isolated per profile and causes cross-profile contamination.
      setColumnsLoaded(true);
      setDbSynced(true);
    }).catch(() => {
      // Load falhou: mostra a UI, mas continua PROIBIDO gravar. Gravar aqui
      // apagaria no banco tudo que não conseguimos ler.
      setColumnsLoaded(true);
    });
  }, [db, householdId]);

  /**
   * Card nasce sozinho no SEGUNDO gasto da mesma linha.
   *
   * Premissa do Eduardo (2026-08-14): o card so existe para linha que acumula
   * varios gastos no mes — mercado, gasolina, assinaturas. Conta de internet,
   * paga uma vez, nao precisa de card.
   *
   * Sem isto, gasto lancado num item sem coluna ficava INALCANCAVEL: nao
   * aparecia em Gastos, e como so de la se edita um lancamento, nao havia como
   * recategorizar depois. O ciclo nao fechava.
   */
  useEffect(() => {
    if (!dbSynced || !columnsLoaded) return;

    const jaTemColuna = new Set(columns.map((c) => c.linkedItemId).filter(Boolean));
    const novas = items
      .filter((item) => {
        if (item.category === CategoryType.INCOME) return false;
        if (jaTemColuna.has(item.id)) return false;
        // Conta os lancamentos do item em QUALQUER mes do plano: dois no mesmo
        // mes ja justificam o card.
        return Object.values(item.partialExpenses ?? {}).some((lista) => ((lista as PartialExpense[] | undefined)?.length ?? 0) > 1);
      })
      .map((item) => ({ id: crypto.randomUUID(), title: (item.description || 'GASTO').toUpperCase(), linkedItemId: item.id }));

    if (novas.length > 0) setColumns((prev) => [...prev, ...novas]);
  }, [items, columns, dbSynced, columnsLoaded]);

  useEffect(() => {
    if (!dbSynced || !db || !householdId) return;
    const json = JSON.stringify(columns);
    if (json === lastSavedRef.current) return;
    // Uma gravação por vez: duas em paralelo podem chegar fora de ordem e a
    // mais antiga apagaria as colunas da mais nova na limpeza de órfãs.
    // O `saveTick` no fim reexecuta este efeito, então a mudança mais recente
    // nunca fica para trás.
    if (savingRef.current) return;

    // Backoff limitado por conteúdo: um estado novo zera as tentativas, um
    // estado que falha repetidamente para de martelar o servidor.
    if (lastAttemptRef.current !== json) {
      lastAttemptRef.current = json;
      failuresRef.current = 0;
    } else if (failuresRef.current > 5) {
      return;
    }

    savingRef.current = true;
    // Grava sempre o id do banco no vínculo (ver resolveDbId nas props).
    const forDb = columns.map(c => ({
      ...c,
      linkedItemId: c.linkedItemId ? (resolveDbId?.(c.linkedItemId) ?? c.linkedItemId) : '',
    }));
    saveTetoColumns(db, householdId, forDb)
      .then(() => {
        // Só aqui vira "persistido". Antes o estado era marcado como salvo
        // ANTES do await, e uma falha do insert (depois do delete) virava
        // perda silenciosa e definitiva dos cards.
        lastSavedRef.current = json;
        failuresRef.current = 0;
        savingRef.current = false;
        setSaveFailed(null);
        setSaveTick(t => t + 1);
      })
      .catch((err) => {
        // Falha de gravação NUNCA pode ser silenciosa: foi exatamente assim que
        // os cards sumiram sem deixar rastro. Se acontecer, o motivo está aqui.
        console.error('[TetoGastos] falha ao salvar os cards:', err);
        failuresRef.current += 1;
        savingRef.current = false;
        if (failuresRef.current >= 2) setSaveFailed(describeSaveError(err));
        setTimeout(() => setSaveTick(t => t + 1), 1500 * failuresRef.current);
      });
  }, [columns, dbSynced, db, householdId, saveTick]);

  // Only run with real Supabase items (UUID IDs). Default placeholder items load before
  // Supabase completes and would cause incorrect auto-link and cleanedFixed behaviour.
  const hasRealItems = items.some(i => /^[0-9a-f]{8}-[0-9a-f]{4}/.test(i.id));

  // Auto-criação dos cards. Roda sempre que os itens mudam (não mais uma única
  // vez por montagem): assim que o cliente preenche mercado, transporte/
  // gasolina ou lazer no planejamento, o card aparece aqui sozinho.
  // É idempotente — nunca cria um card para um item que já tem coluna, e nunca
  // recria um que o usuário apagou.
  useEffect(() => {
    if (!dbSynced || !hasRealItems) return;

    setColumns(prev => {
      const alreadyLinked = new Set(prev.map(c => c.linkedItemId).filter(Boolean));
      // Gastos que se consomem ao longo do mês e merecem card de teto assim que
      // são planejados — independentemente de estarem como conta fixa ou
      // variável (o onboarding cria mercado/transporte como variáveis).
      const TETO_KEYWORDS = ['mercado', 'supermercado', 'gasolina', 'combustivel', 'combustível', 'transporte', 'uber'];
      const isPlanned = (item: FinanceItem) => item.values.some(v => v > 0);
      const hasEntries = (item: FinanceItem) =>
        Object.values(item.partialExpenses ?? {}).some(arr => (arr as PartialExpense[]).length > 0);

      // REGRA FECHADA (pedido explícito do Eduardo, 2026-07-23): só existem
      // TRÊS cards automáticos — mercado, transporte/gasolina e lazer — e só
      // quando o cliente preencheu o valor no planejamento. Qualquer outro card
      // é criado à mão pelo usuário. Cartão de crédito e renda NUNCA geram card
      // (uma versão anterior checava a palavra-chave ANTES da categoria e criou
      // cards para cartões chamados "Mercado Pago").
      const isTetoWorthy = (item: FinanceItem): boolean => {
        const isFixed = item.category === CategoryType.FIXED_EXPENSE;
        const isVariable = item.category === CategoryType.VARIABLE_EXPENSE;
        const isLeisure = item.category === CategoryType.PERSONAL_LEISURE;
        if (!isFixed && !isVariable && !isLeisure) return false;
        if (!isPlanned(item) && !hasEntries(item)) return false;
        if (isLeisure) return true;
        const desc = item.description.toLowerCase();
        if (desc === 'gastos avulsos') return false;
        return TETO_KEYWORDS.some(k => desc.includes(k));
      };

      const toAdd = items.filter(item =>
        isTetoWorthy(item) &&
        !alreadyLinked.has(item.id) &&
        !dismissedRef.current.has(item.id)
      );
      if (toAdd.length === 0) return prev;

      const updatedPrev = prev.map(col => {
        if (col.linkedItemId) return col;
        const colTitle = col.title.toLowerCase().trim();
        // Card recém-criado (ainda com o nome padrão) é do usuário: ele vai
        // vincular à mão. Sequestrar aqui roubava o card antes de ele terminar.
        if (!colTitle || colTitle === 'nova despesa') return col;
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
  }, [dbSynced, items, hasRealItems]);

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
    const target = columns.find(c => c.id === id);
    if (target?.linkedItemId) rememberDismissed(target.linkedItemId);
    setColumns(prev => prev.filter(c => c.id !== id));
  };

  const updateColumn = (id: string, field: keyof ColumnData, value: string) => {
    setColumns(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  // Colunas de gasto variável só aparecem quando têm lançamento no mês — EXCETO
  // quando o gasto foi planejado (mercado/transporte vindos do onboarding têm
  // teto definido e precisam aparecer desde o primeiro dia, ainda sem lançamento).
  const displayColumns = useMemo(() => {
    return columns.filter(col => {
      if (!col.linkedItemId) return true;
      const linkedItem = items.find(i => i.id === col.linkedItemId);
      if (!linkedItem) return true;
      if (linkedItem.category === CategoryType.VARIABLE_EXPENSE) {
        const partials = linkedItem.partialExpenses?.[monthKey] || [];
        if (partials.length > 0) return true;
        return tetoSlotIdx >= 0 && (linkedItem.values[tetoSlotIdx] || 0) > 0;
      }
      return true;
    });
  }, [columns, items, monthKey, tetoSlotIdx]);

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
    if (isFutureView) return;
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
    if (isFutureView || columns.length <= 1) return;
    if (col.linkedItemId) {
      setDeleteConfirmId(col.id === deleteConfirmId ? null : col.id);
    } else {
      removeColumn(col.id);
    }
  };

  const [entryDescriptions, setEntryDescriptions] = useState<Record<string, string>>({});
  const [entryErrors, setEntryErrors] = useState<Record<string, boolean>>({});
  const [linkRequired, setLinkRequired] = useState<Record<string, boolean>>({});
  const [installMode, setInstallMode] = useState<Record<string, boolean>>({});
  const [installData, setInstallData] = useState<Record<string, { desc: string; total: string; qty: string }>>({});
  const [installCardIds, setInstallCardIds] = useState<Record<string, string>>({});
  const [deletePartialConfirm, setDeletePartialConfirm] = useState<{ itemId: string; expId: string; description: string; value: number } | null>(null);
  const [editPartialConfirm, setEditPartialConfirm] = useState<{ itemId: string; expId: string; description: string; value: number; date: string; monthKey: string; paymentSource?: 'debit' | 'credit'; cardLast4?: string } | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editValue, setEditValue] = useState('');
  // Sub-cards por fonte: chave = col.id, valor = sourceKey ativo ou null
  const [activeSourceKeys, setActiveSourceKeys] = useState<Record<string, string | null>>({});
  // Sheet de seleção de meio de pagamento
  const [sourceSheetColId, setSourceSheetColId] = useState<string | null>(null);

  // Aplica filtro de fonte quando navegado do Plano (Ponto 3)
  useEffect(() => {
    if (!initialFilter) return;
    const col = columns.find(c => c.linkedItemId === initialFilter.linkedItemId);
    if (!col) return;
    setActiveSourceKeys(prev => ({ ...prev, [col.id]: initialFilter.sourceKey }));
    onInitialFilterHandled?.();
  }, [initialFilter, columns]); // eslint-disable-line react-hooks/exhaustive-deps
  // Partial sendo recategorizado via RecategorizarSheet
  const [recategorizando, setRecategorizando] = useState<{
    itemId: string; expId: string; partial: PartialExpense; monthKey: string;
  } | null>(null);
  /**
   * Item de destino ao editar. Existe para o lançamento poder MUDAR de
   * categoria: o diálogo já removia e re-adicionava, mas sempre no mesmo item,
   * então gasto que caiu no lugar errado — sobretudo os que vêm do Open Finance
   * categorizados sozinhos — ficava preso onde entrou.
   */
  const [editItemId, setEditItemId] = useState('');

  /**
   * Rola até o card do item que veio do Plano e pisca a borda, para o cliente
   * não ter que caçar na lista qual card formava aquele número.
   */
  const [flashItemId, setFlashItemId] = useState<string | null>(null);
  useEffect(() => {
    if (!focusItemId) return;

    // As colunas vem do banco (`teto_columns`), de forma assincrona. Um timeout
    // fixo procurava o card antes de ele existir, nao achava nada e nao rolava
    // — o cliente ficava onde estava e parecia que o app tinha levado para o
    // card errado. Tenta ate aparecer, com teto de ~4s.
    // Se o item NAO tem card, nao ha para onde rolar — e era isso que
    // acontecia com "Assinaturas": um gasto so, card nunca criado, seletor sem
    // alvo, tela parada onde estava. Criar o card aqui e o que faz o clique
    // sempre ter destino; ele passa a existir porque o cliente quis olhar.
    const alvoDb = resolveDbId?.(focusItemId) ?? focusItemId;
    const temCard = columns.some((c) => c.linkedItemId === focusItemId || c.linkedItemId === alvoDb);
    if (!temCard && dbSynced) {
      const item = items.find((i) => i.id === focusItemId || i.id === alvoDb);
      if (item) {
        setColumns((prev) => [...prev, {
          id: crypto.randomUUID(),
          title: (item.description || 'GASTO').toUpperCase(),
          linkedItemId: item.id,
        }]);
      }
    }

    let tentativas = 0;
    let timer: ReturnType<typeof setTimeout>;

    // As colunas guardam o id do BANCO (ver resolveDbId na gravação), enquanto
    // o clique no Plano manda o id LOCAL do item. Sem tentar os dois, o seletor
    // nunca casa e a tela simplesmente nao rola — foi por isso que clicar em
    // Assinaturas parecia levar para Lazer: nao levava para lugar nenhum.
    const alvos = [focusItemId, resolveDbId?.(focusItemId)].filter(Boolean) as string[];

    const procurar = () => {
      const el = alvos
        .map((id) => document.querySelector(`[data-teto-item="${id}"]`))
        .find(Boolean) ?? null;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setFlashItemId(el.getAttribute('data-teto-item'));
        setTimeout(() => setFlashItemId(null), 2200);
        onFocusHandled?.();
        return;
      }
      if (++tentativas < 20) timer = setTimeout(procurar, 200);
      else onFocusHandled?.(); // desiste sem travar o estado
    };

    timer = setTimeout(procurar, 120);
    return () => clearTimeout(timer);
  }, [focusItemId, onFocusHandled, resolveDbId, columns, items, dbSynced]);
  const valueInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const handleSubmitEntry = (colId: string, itemId: string, value: string) => {
    if (!itemId) {
      setLinkRequired(prev => ({ ...prev, [colId]: true }));
      return;
    }
    setLinkRequired(prev => ({ ...prev, [colId]: false }));
    const desc = entryDescriptions[colId]?.trim();
    if (!desc) {
      setEntryErrors(prev => ({ ...prev, [colId]: true }));
      return;
    }
    const parsed = parseFloat(value.replace(',', '.'));
    if (!value || isNaN(parsed) || parsed <= 0) return;
    const linkedItem = items.find(i => i.id === itemId);
    // Data do lançamento reflete o mês SELECIONADO (retroativo usa dia 1 do mês
    // passado; no mês de trabalho usa o dia de hoje).
    const entryDay = isPastView ? 1 : new Date().getDate();
    const expense: PartialExpense = {
      id: crypto.randomUUID(),
      date: `${String(entryDay).padStart(2, '0')}/${String(selMonthIdx + 1).padStart(2, '0')}`,
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

    onAddPartial(itemId, expense, selYear, selMonthIdx);
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

    const startAbsMonth = selYear * 12 + selMonthIdx;
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

  // Ponto 2: todos os itens PERSONAL_LEISURE se fundem num único card visual
  // Cartoes cadastrados: usados para resolver a forma de pagamento de
  // lancamentos antigos, que herdam o cartao da linha.
  const creditCards = items.filter(i => i.category === CategoryType.CREDIT_CARD);
  const leisureItems = items.filter(i => i.category === CategoryType.PERSONAL_LEISURE);
  const partialItemMap = new Map<string, string>();
  const aggregatedLeisurePartials: PartialExpense[] = leisureItems.flatMap(i => {
    const ps = (i.partialExpenses?.[monthKey] ?? []) as PartialExpense[];
    ps.forEach(p => partialItemMap.set(p.id, i.id));
    return ps;
  });
  const firstLeisureColId = displayColumns.find(col => {
    const it = items.find(i => i.id === col.linkedItemId);
    return it?.category === CategoryType.PERSONAL_LEISURE;
  })?.id;

  return (
    <div className="p-3 lg:p-6 animate-in fade-in zoom-in-95 duration-500">
      {/* Gravação falhando: avisa NA TELA. Card sumindo em silêncio já custou
          horas de debug e confiança — o usuário precisa saber na hora que o
          que ele criou não foi salvo, em vez de descobrir na próxima aba. */}
      {saveFailed && (
        <div className="mb-3 flex items-start gap-3 rounded-2xl border border-orange-400/40 bg-orange-50 px-4 py-3">
          <i className="fas fa-triangle-exclamation text-orange-500 mt-0.5 shrink-0"></i>
          <div className="flex-1">
            <p className="text-orange-900 text-xs font-black uppercase tracking-wide">Não foi possível salvar os cards</p>
            <p className="text-orange-800/80 text-[11px] leading-relaxed mt-0.5">
              O que você criou agora pode não aparecer quando voltar. {saveFailed}
            </p>
          </div>
        </div>
      )}

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
                {labelForKey(key)}{key === workingMonthKey ? ' ●' : ''}
              </option>
            ))}
          </select>
          <i className="fas fa-chevron-down text-[#aeaeb2] text-[9px] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"></i>
        </div>
        {!isFutureView && (
          <button
            onClick={addColumn}
            className="k-btn-lime px-5 py-2.5 flex items-center gap-2 shrink-0"
          >
            <i className="fas fa-plus-circle"></i> Adicionar
          </button>
        )}
      </div>

      {isFutureView && (
        <div className="mb-3 flex items-center gap-2 bg-[#f5f5f7] border border-[#e8e8ed] rounded-xl px-4 py-2">
          <i className="fas fa-clock text-[#7ab800] text-xs"></i>
          <span className="text-[#aeaeb2] text-xs font-bold uppercase tracking-widest">
            {labelForKey(selectedMonthKey)} — planejamento futuro (somente leitura)
          </span>
        </div>
      )}
      {isPastView && (
        <div className="mb-3 flex items-center gap-2 bg-[#fff8f0] border border-[rgba(255,149,0,0.25)] rounded-xl px-4 py-2">
          <i className="fas fa-history text-[#ff9500] text-xs"></i>
          <span className="text-[#ff9500] text-xs font-bold uppercase tracking-widest">
            Lançamento retroativo em {labelForKey(selectedMonthKey)}
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
          const isLeisureCol = linkedItem?.category === CategoryType.PERSONAL_LEISURE;
          if (isLeisureCol && col.id !== firstLeisureColId) return null;
          const teto = linkedItem && tetoSlotIdx >= 0 ? (linkedItem.values[tetoSlotIdx] || 0) : 0;
          const partials = isLeisureCol ? aggregatedLeisurePartials : (linkedItem?.partialExpenses?.[monthKey] || []);
          const totalSpent = partials.reduce((acc, p) => acc + p.value, 0);
          const isOverLimit = totalSpent > teto && teto > 0;
          const progressPct = teto > 0 ? Math.min(100, (totalSpent / teto) * 100) : 0;
          // Lançamento sem origem gravada (anterior a este campo) conta como
          // "já saiu": é o que era verdade antes de existir a distinção.
          const creditTotal = partials.reduce((a, p) => a + (p.paymentSource === 'credit' ? p.value : 0), 0);
          const debitTotal = totalSpent - creditTotal;
          const debitPct = teto > 0 ? Math.min(100, (debitTotal / teto) * 100) : 0;
          const creditPct = teto > 0 ? Math.min(100 - debitPct, (creditTotal / teto) * 100) : 0;

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
              data-teto-item={col.linkedItemId || undefined}
              style={flashItemId && col.linkedItemId === flashItemId
                ? { outline: '2px solid #7ab800', outlineOffset: '2px', borderRadius: '18px' }
                : undefined}
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
                      isFutureView || columns.length <= 1 ? 'opacity-0 pointer-events-none' :
                      deleteConfirmId === col.id ? 'bg-[#ff3b30] text-white scale-110' :
                      'bg-[#ff3b30]/15 text-[#ff3b30] active:bg-[#ff3b30] active:text-white'
                    }`}
                  >
                    <i className="fas fa-times text-[9px]"></i>
                  </button>
                  <select
                    className={`flex-1 bg-transparent border-none text-[10px] font-black uppercase text-center outline-none cursor-pointer ${isUnlinked ? (linkRequired[col.id] ? 'text-[#ff3b30]' : 'text-orange-400') : 'text-[#1d1d1f]'}`}
                    value={col.linkedItemId}
                    onChange={(e) => { updateColumn(col.id, 'linkedItemId', e.target.value); setLinkRequired(prev => ({ ...prev, [col.id]: false })); }}
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

              {/* Link required banner — aparece ao clicar OK sem vincular categoria */}
              {linkRequired[col.id] && isUnlinked && (
                <div className="bg-[#fff8f0] border-b border-[rgba(255,149,0,0.3)] px-3 py-2 flex items-start gap-2">
                  <i className="fas fa-arrow-up text-[#ff9500] text-[9px] mt-0.5 shrink-0"></i>
                  <p className="text-[9px] text-[#ff9500] font-bold leading-tight">
                    Selecione a categoria acima para que este gasto contabilize no orçamento correto.
                  </p>
                </div>
              )}

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
                  {/* Uma barra, duas texturas: sólido é o que já saiu da conta
                      (débito/Pix), listrado é o que ainda vai sair na fatura do
                      cartão. O TETO continua sendo um só — o cliente decide
                      quanto quer gastar com a coisa, não com a forma de pagar. */}
                  <div className="h-1.5 bg-[#e8e8ed] rounded-full overflow-hidden flex">
                    <div
                      className={`h-full transition-all ${isOverLimit ? 'bg-[#ff3b30]' : progressPct > 80 ? 'bg-[#a8e716]' : 'bg-[#7ab800]'}`}
                      style={{ width: `${debitPct}%` }}
                    />
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${creditPct}%`,
                        backgroundImage: `repeating-linear-gradient(135deg, ${isOverLimit ? '#ff3b30' : '#7ab800'} 0 3px, transparent 3px 6px)`,
                        backgroundColor: isOverLimit ? 'rgba(255,59,48,0.22)' : 'rgba(122,184,0,0.22)',
                      }}
                    />
                  </div>
                  {creditTotal > 0 && debitTotal > 0 && (
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[8px] font-black text-[#6e6e73] flex items-center gap-1">
                        <i className="fas fa-square text-[6px]" style={{ color: isOverLimit ? '#ff3b30' : '#7ab800' }} />
                        {formatCurrency(debitTotal)} já saiu
                      </span>
                      <span className="text-[8px] font-black text-[#aeaeb2] flex items-center gap-1">
                        <i className="fas fa-credit-card text-[7px]" />
                        {formatCurrency(creditTotal)} na fatura
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Entry form */}
              {!isFutureView && (
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

              {/* Sub-cards por fonte de pagamento */}
              {(() => {
                type SourceGroup = { key: string; label: string; total: number; isCredit: boolean };
                const groups = new Map<string, SourceGroup>();
                for (const p of partials) {
                  // Lancamento antigo sem forma de pagamento herda o cartao da linha.
                  const owner = isLeisureCol
                    ? items.find(i => (i.partialExpenses?.[monthKey] || []).some(x => x.id === p.id))
                    : linkedItem;
                  const src = getSourceInfo(p, owner, creditCards);
                  if (!groups.has(src.key)) {
                    groups.set(src.key, { key: src.key, label: src.label, total: 0, isCredit: src.isCredit });
                  }
                  groups.get(src.key)!.total += p.value;
                }
                const list = Array.from(groups.values());
                if (list.length === 0) return null;
                const hasCredit = list.some(g => g.isCredit);
                const activeKey = activeSourceKeys[col.id] ?? null;
                return (
                  <div className="px-3 pt-2 pb-2 bg-white border-t border-[#e8e8ed] space-y-1.5">
                    {/* Filtro: ativo ou botão único */}
                    {list.length > 0 && (
                      activeKey ? (
                        <div className="flex items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black bg-[#1d1d1f] text-white">
                            <i className="fas fa-filter text-[7px]" />
                            {list.find(g => g.key === activeKey)?.label}
                          </span>
                          <button
                            onClick={() => setActiveSourceKeys(prev => ({ ...prev, [col.id]: null }))}
                            className="w-4 h-4 rounded-full bg-[#e8e8ed] flex items-center justify-center text-[#6e6e73] active:opacity-70"
                          >
                            <i className="fas fa-times text-[7px]" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setSourceSheetColId(col.id)}
                          className="inline-flex items-center gap-1.5 text-[9px] text-[#007aff] font-black active:opacity-70"
                        >
                          <i className="fas fa-filter text-[8px]" />
                          Meios de pagamento
                          <i className="fas fa-chevron-right text-[7px]" />
                        </button>
                      )
                    )}

                    {hasCredit && (
                      <p className="text-[8px] text-[#ff9500] font-bold flex items-center gap-1">
                        <i className="fas fa-info-circle text-[7px]" />
                        Compras no cartão entram na fatura do próximo mês
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Expense list — only shown when there are expenses */}
              {partials.length > 0 && (() => {
                const activeKey = activeSourceKeys[col.id] ?? null;
                const shown = activeKey
                  ? partials.filter(p => {
                      const k = p.paymentSource === 'credit' ? `credit_${p.cardLast4 ?? ''}` : 'debit';
                      return k === activeKey;
                    })
                  : partials;
                return (
                  <div className="flex flex-col bg-white border-t border-[#e8e8ed]">
                    {shown.map((p) => (
                      <div key={p.id} className="border-b border-[#f5f5f7] flex items-center gap-2 px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-[8px] text-[#aeaeb2] font-bold uppercase shrink-0">{p.date}</span>
                            {p.paymentSource === 'credit' && (
                              <span className="text-[8px] text-[#ff9500] whitespace-nowrap">
                                <i className="fas fa-credit-card text-[7px] mr-0.5" />
                                {p.cardLast4 ? `••${p.cardLast4}` : 'Cartão'}
                              </span>
                            )}
                            {p.paymentSource === 'debit' && (
                              <span className="text-[8px] text-[#007aff] whitespace-nowrap">
                                <i className="fas fa-arrow-right-from-bracket text-[7px] mr-0.5" />
                                Débito
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-[#1d1d1f] font-medium truncate block">{p.description}</span>
                        </div>
                        <span className="text-xs font-black text-[#1d1d1f] k-num shrink-0 mx-1">{formatCurrency(p.value)}</span>
                        {!isFutureView && (
                          <button
                            onClick={() => {
                              setRecategorizando({ itemId: isLeisureCol ? (partialItemMap.get(p.id) ?? col.linkedItemId) : col.linkedItemId, expId: p.id, partial: p, monthKey });
                            }}
                            className="shrink-0 flex items-center gap-1 bg-[#f0fad0] text-[#5a8c00] text-[9px] font-black px-2 py-1 rounded-full active:opacity-70 transition-all"
                          >
                            <i className="fas fa-pen text-[7px]" />
                            Editar
                          </button>
                        )}
                        <button
                          onClick={() => setDeletePartialConfirm({ itemId: isLeisureCol ? (partialItemMap.get(p.id) ?? col.linkedItemId) : col.linkedItemId, expId: p.id, description: p.description, value: p.value })}
                          className="text-[#ff3b30]/50 active:text-[#ff3b30] p-1 shrink-0"
                        >
                          <i className="fas fa-times-circle text-xs"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()}

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

      {/* RecategorizarSheet */}
      {recategorizando && onCreateItem && (
        <RecategorizarSheet
          expense={{
            description: recategorizando.partial.description,
            value: recategorizando.partial.value,
            date: recategorizando.partial.date,
            paymentSource: recategorizando.partial.paymentSource,
            cardLast4: recategorizando.partial.cardLast4,
            currentItemId: recategorizando.itemId,
          }}
          items={items}
          workingMonthKey={recategorizando.monthKey}
          onKeep={() => setRecategorizando(null)}
          onClose={() => setRecategorizando(null)}
          onCreateItem={onCreateItem}
          onConfirm={(newItemId) => {
            const [ty, tm] = recategorizando.monthKey.split('-').map(Number);
            const { description, value } = recategorizando.partial;
            const sourceItem = items.find(i => i.id === recategorizando.itemId);

            // Coleta a parcela atual + todas as irmãs futuras (mesma desc + valor)
            const toMove: Array<{ expId: string; partial: PartialExpense; year: number; month: number }> = [];
            for (const [mk, monthPartials] of Object.entries((sourceItem?.partialExpenses ?? {}) as Record<string, PartialExpense[]>)) {
              const [y, m] = mk.split('-').map(Number);
              if (y < ty || (y === ty && m < tm)) continue;
              for (const p of monthPartials) {
                if (p.description === description && Math.abs(p.value - value) < 0.01) {
                  toMove.push({ expId: p.id, partial: p, year: y, month: m });
                }
              }
            }
            if (toMove.length === 0) {
              toMove.push({ expId: recategorizando.expId, partial: recategorizando.partial, year: ty, month: tm });
            }

            for (const { expId, partial, year, month } of toMove) {
              onRemovePartial(recategorizando.itemId, expId);
              onAddPartial(newItemId, { ...partial, id: crypto.randomUUID() }, year, month);
            }
            setRecategorizando(null);
          }}
        />
      )}

      {/* Sheet: selecionar meio de pagamento para filtrar */}
      {sourceSheetColId && (() => {
        const sheetCol = columns.find(c => c.id === sourceSheetColId);
        if (!sheetCol) return null;
        const sheetItem = items.find(i => i.id === sheetCol.linkedItemId);
        const isLeisureSheet = sheetItem?.category === CategoryType.PERSONAL_LEISURE;
        const sheetPartials = isLeisureSheet ? aggregatedLeisurePartials : (sheetItem?.partialExpenses?.[monthKey] ?? []);
        type SourceGroup = { key: string; label: string; total: number; isCredit: boolean };
        const sheetGroups = new Map<string, SourceGroup>();
        for (const p of sheetPartials) {
          const owner = isLeisureSheet
            ? items.find(i => (i.partialExpenses?.[monthKey] || []).some(x => x.id === p.id))
            : sheetItem;
          const src = getSourceInfo(p, owner, creditCards);
          if (!sheetGroups.has(src.key)) {
            sheetGroups.set(src.key, { key: src.key, label: src.label, total: 0, isCredit: src.isCredit });
          }
          sheetGroups.get(src.key)!.total += p.value;
        }
        const sheetList = Array.from(sheetGroups.values());
        return (
          <div className="fixed inset-0 z-[65] flex items-end" onClick={() => setSourceSheetColId(null)}>
            <div
              className="w-full bg-white rounded-t-3xl pb-10 border-t border-[#e8e8ed] animate-in slide-in-from-bottom-4 duration-200"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-8 h-1 bg-[#e8e8ed] rounded-full mx-auto mt-4 mb-4" />
              <div className="px-6 pb-4 border-b border-[#f5f5f7]">
                <p className="text-[#1d1d1f] font-black text-base">{sheetCol.title}</p>
                <p className="text-[9px] text-[#aeaeb2] font-black uppercase tracking-widest mt-0.5">Filtrar por meio de pagamento</p>
              </div>
              <div className="px-6 pt-4 space-y-2">
                {sheetList.map(g => (
                  <button
                    key={g.key}
                    onClick={() => {
                      setActiveSourceKeys(prev => ({ ...prev, [sourceSheetColId]: g.key }));
                      setSourceSheetColId(null);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-[#e8e8ed] active:opacity-70"
                  >
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${g.isCredit ? 'bg-orange-100' : 'bg-blue-100'}`}>
                      <i className={`fas ${g.isCredit ? 'fa-credit-card text-orange-500' : 'fa-arrow-right-from-bracket text-blue-500'} text-sm`} />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="text-[#1d1d1f] font-black text-sm">{g.label}</p>
                      <p className="text-[#6e6e73] text-xs k-num">{formatCurrency(g.total)}</p>
                    </div>
                    <i className="fas fa-chevron-right text-[#aeaeb2] text-xs" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

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
                <p className="text-[#6e6e73] text-xs mt-0.5">
                  {editPartialConfirm.paymentSource === 'credit'
                    ? 'Veio da fatura do cartão — o valor não muda'
                    : 'Altere a categoria, a descrição ou o valor'}
                </p>
              </div>
            </div>
            <div className="space-y-3 mb-5">
              <div>
                <p className="text-[9px] text-[#aeaeb2] font-black uppercase tracking-widest mb-1.5">Categoria</p>
                <select
                  value={editItemId}
                  onChange={e => setEditItemId(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm rounded-xl bg-[#f5f5f7] border border-[#e8e8ed] text-[#1d1d1f] font-bold outline-none appearance-none"
                >
                  {items
                    .filter(i => i.category !== CategoryType.INCOME)
                    .map(i => (
                      <option key={i.id} value={i.id}>
                        {CATEGORY_SHORT[i.category] ?? ''}{CATEGORY_SHORT[i.category] ? ' · ' : ''}{i.description}
                      </option>
                    ))}
                </select>
                {editItemId !== editPartialConfirm.itemId && (
                  <p className="text-[10px] text-[#7ab800] font-bold mt-1.5">
                    <i className="fas fa-arrow-right-arrow-left mr-1" />
                    Este gasto vai mudar de categoria ao salvar
                  </p>
                )}
              </div>
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
                    readOnly={editPartialConfirm.paymentSource === 'credit'}
                    className={`flex-1 pl-2 pr-3 py-2.5 text-sm bg-transparent font-black outline-none k-num ${editPartialConfirm.paymentSource === 'credit' ? 'text-[#8e8e93] cursor-not-allowed' : 'text-[#1d1d1f]'}`}
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
                  // Tira do item antigo e devolve no ESCOLHIDO — é o que permite
                  // mover o gasto de categoria sem apagar e relançar.
                  onRemovePartial(editPartialConfirm.itemId, editPartialConfirm.expId);
                  onAddPartial(editItemId || editPartialConfirm.itemId, {
                    id: crypto.randomUUID(),
                    date: editPartialConfirm.date,
                    description: editDesc.trim(),
                    // Gasto de cartao mantem o valor original: ele ja foi
                    // cobrado, mudar aqui descasaria da fatura.
                    value: editPartialConfirm.paymentSource === 'credit' ? editPartialConfirm.value : newValue,
                    // A origem viaja junto: recategorizar nao transforma um
                    // gasto de cartao em gasto de debito.
                    paymentSource: editPartialConfirm.paymentSource,
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
