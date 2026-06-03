
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useUser, useClerk, useSignIn, useAuth, SignIn, SignUp } from '@clerk/clerk-react';
import { CategoryType, FinanceItem, SummaryData, LinkType, PartialExpense, Goal } from './types';
import { getNext12Months, formatCurrency, MONTHS_BR } from './constants';
import BlockSection from './components/BlockSection';
import ExpenseSheet, { DetectedExpense } from './components/ExpenseSheet';
import Diagnosis from './components/Diagnosis';
import TetoGastos from './components/TetoGastos';
import AICoach from './components/AICoach';
import OnboardingTutorial from './components/OnboardingTutorial';
import { useSupabase } from './lib/useSupabase';
import { getOrCreateHousehold, getHousehold, loadFinanceItems, saveFinanceItem, deleteFinanceItem, addPartialExpense, deletePartialExpense, updateHouseholdPlan, loadGoals, loadTetoColumns, saveTetoColumns } from './lib/db';
import { processInviteFromUrl } from './lib/invites';
import InvitePartner from './components/InvitePartner';
import CoachDashboard from './components/CoachDashboard';
import ClientSettings from './components/ClientSettings';
import SubscriptionGate from './components/SubscriptionGate';
import OnboardingWizard, { WizardResult } from './components/OnboardingWizard';
import Desempenho from './components/Desempenho';
import Metas from './components/Metas';

const ADMIN_IDS = (import.meta.env.VITE_ADMIN_USER_IDS ?? '').split(',').map((s: string) => s.trim()).filter(Boolean);

const DEFAULT_FIXED_EXPENSES = [
  'Moradia', 'Condominio', 'Telefone fixo', 'Internet', 'Celular',
  'Compras mercado (média mensal)', 'Gás', 'Luz', 'Água', 'Convênio',
  'Gasolina/uber (media mensal)', 'Iptu (mensal)', 'Educação',
  'Unha e sobrancelha', 'Academia', 'Cabelo', 'Estética', 'Dízimo',
  'Diarista', 'Comida pet', 'Banho pet', 'Personal', 'Netflix', 'Spotify',
  'Emprestimo (parcela mensal)', 'Previdência', 'Parcela seguro carro',
  'Parcela de carro', 'Terapia', 'Emprestimo'
];

const App: React.FC = () => {
  const { isSignedIn, user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const { signIn, setActive: setSignInActive } = useSignIn();
  const { getToken } = useAuth();
  const db = useSupabase();
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [clerkTimeout, setClerkTimeout] = useState(false);
  const [showTutorial, setShowTutorial] = useState<boolean>(() => {
    return localStorage.getItem('tutorial_completed') !== 'true';
  });
  const isNativeApp = !!(window as any).Capacitor?.isNativePlatform?.();
  const [showWebNotice, setShowWebNotice] = useState<boolean>(() => {
    return isNativeApp && localStorage.getItem('web_notice_dismissed') !== 'true';
  });
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [dbLoading, setDbLoading] = useState(false);
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [coachViewHouseholdId, setCoachViewHouseholdId] = useState<string | null>(null);
  const [coachViewClientName, setCoachViewClientName] = useState<string>('');
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [showSubscriptionGate, setShowSubscriptionGate] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const itemIdMapRef = useRef<Record<string, string>>({}); // localId -> dbId
  const pendingDeletesRef = useRef<Set<string>>(new Set());
  const userDataLoadedRef = useRef<string | null>(null); // tracks userId to prevent token-refresh reloads
  const coachViewLoadedRef = useRef<string | null>(null);
  // Snapshot of coach's own data — restored when exiting a client view
  const ownDataSnapshotRef = useRef<{ householdId: string; items: FinanceItem[]; startMonth: number; startYear: number } | null>(null);
  // Mirrors of current state for capturing snapshots before async overwrites
  const currentHouseholdIdRef = useRef<string | null>(null);
  const currentItemsRef = useRef<FinanceItem[]>([]);
  const currentStartMonthRef = useRef<number>(new Date().getMonth());
  const currentStartYearRef = useRef<number>(new Date().getFullYear());
  const [tetoColumns, setTetoColumns] = useState<{ id: string; title: string; linkedItemId: string }[]>([]);
  const [pendingExpense, setPendingExpense] = useState<(DetectedExpense & { source: 'ai' | 'manual' }) | null>(null);
  // Guard: true only after items have been loaded from DB (prevents saving default items on load failure)
  const dbItemsLoadedRef = useRef(false);

  // Timeout: se Clerk não carregar em 12s, mostra tela de erro com retry
  useEffect(() => {
    if (isLoaded) return;
    const t = setTimeout(() => setClerkTimeout(true), 12000);
    return () => clearTimeout(t);
  }, [isLoaded]);

  const isAdminByEnv = user ? ADMIN_IDS.includes(user.id) : false;
  const [isAdminByDb, setIsAdminByDb] = useState(false);
  const isAdmin = isAdminByEnv || isAdminByDb;

  // Checa assistentes cadastradas na tabela admin_users
  useEffect(() => {
    if (!db || !user || isAdminByEnv) return;
    const email = user.emailAddresses[0]?.emailAddress?.toLowerCase();
    if (!email) return;
    db.from('admin_users').select('id').eq('email', email).maybeSingle()
      .then(({ data }) => { if (data) setIsAdminByDb(true); })
      .catch(() => {});
  }, [db, user, isAdminByEnv]);

  const [showProjectionModal, setShowProjectionModal] = useState(false);
  const [pendingStartMonth, setPendingStartMonth] = useState<{month: number, year: number} | null>(null);
  const [formData, setFormData] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [activeTab, setActiveTab] = useState<'plan' | 'teto' | 'metas' | 'desempenho'>('plan');
  const [goals, setGoals] = useState<Goal[]>(() => {
    try { return JSON.parse(localStorage.getItem('kashim_goals') || '[]'); } catch { return []; }
  });
  const [mobileMonthIdx, setMobileMonthIdx] = useState(0);

  const [startMonth, setStartMonth] = useState<number>(() => {
    const cached = localStorage.getItem('kashim_startMonth');
    return cached !== null ? parseInt(cached) : new Date().getMonth();
  });
  const [startYear, setStartYear] = useState<number>(() => {
    const cached = localStorage.getItem('kashim_startYear');
    return cached !== null ? parseInt(cached) : new Date().getFullYear();
  });

  const months = useMemo(() => {
    const result = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(startYear, startMonth + i, 1);
      result.push({
        monthName: MONTHS_BR[d.getMonth()],
        year: d.getFullYear(),
        index: d.getMonth()
      });
    }
    return result;
  }, [startMonth, startYear]);

  const currentActualMonth = new Date().getMonth();
  const currentActualYear = new Date().getFullYear();

  const [items, setItems] = useState<FinanceItem[]>(() =>
    DEFAULT_FIXED_EXPENSES.map((desc, idx) => ({
      id: `default-fixed-${idx}`,
      description: desc,
      category: CategoryType.FIXED_EXPENSE,
      values: new Array(12).fill(0),
      paidStatus: new Array(12).fill(false)
    }))
  );

  // Carrega dados do Supabase quando o cliente estiver pronto (não roda para admins)
  useEffect(() => {
    if (!db || !user || isAdminByEnv) return;

    async function loadData() {
      setDbLoading(true);
      try {
        // Processa convite da URL antes de criar/buscar household
        const inviteHouseholdId = await processInviteFromUrl(db!, user!.id);
        const hId = inviteHouseholdId ?? await getOrCreateHousehold(db!, user!.id);
        setHouseholdId(hId);

        const [household, dbItems, dbCols] = await Promise.all([
          getHousehold(db!, hId),
          loadFinanceItems(db!, hId),
          loadTetoColumns(db!, hId),
        ]);
        if (dbCols.length > 0) {
          setTetoColumns(dbCols.map((r: any) => ({
            id: r.id,
            title: r.title ?? '',
            linkedItemId: r.linked_item_id ?? '',
          })));
        }

        const loadedStartMonth = household?.start_month ?? new Date().getMonth();
        const loadedStartYear = household?.start_year ?? new Date().getFullYear();
        if (household?.start_month != null) setStartMonth(loadedStartMonth);
        if (household?.start_year != null) setStartYear(loadedStartYear);

        // Jump mobileMonthIdx to the actual current calendar month based on real DB start
        const tempMonths = Array.from({ length: 12 }, (_, i) => {
          const d = new Date(loadedStartYear, loadedStartMonth + i, 1);
          return { index: d.getMonth(), year: d.getFullYear() };
        });
        const calIdx = tempMonths.findIndex(m => m.index === new Date().getMonth() && m.year === new Date().getFullYear());
        if (calIdx >= 0) setMobileMonthIdx(calIdx);

        // Verifica status da assinatura
        const status = household?.subscription_status ?? null;
        setSubscriptionStatus(status);

        // Checa se o acesso do coach expirou e não tem assinatura (via API server-side — bypassa RLS)
        const token = await getToken({ template: 'supabase' });
        const coachAccessRes = await fetch(`/api/check-coach-access?householdId=${hId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.ok ? r.json() : null).catch(() => null) as { hasCoach: boolean; expired: boolean } | null;
        const coachExpired = coachAccessRes?.expired ?? false;
        const hasCoach = coachAccessRes?.hasCoach ?? false;

        if (coachExpired && status !== 'active') {
          setShowSubscriptionGate(true);
        }

        if (dbItems.length > 0) {
          // Auto-cleanup: remove zero-value duplicate items (may exist from a prior bug)
          const byKey = new Map<string, FinanceItem[]>();
          for (const item of dbItems) {
            const key = `${item.description}|${item.category}`;
            byKey.set(key, [...(byKey.get(key) ?? []), item]);
          }
          const toDelete: string[] = [];
          const deduped: FinanceItem[] = [];
          const hasData = (i: FinanceItem) =>
            i.values.some(v => v > 0) || i.paidStatus.some(Boolean) ||
            !!(i.partialExpenses && Object.keys(i.partialExpenses).length > 0);
          for (const group of byKey.values()) {
            if (group.length === 1) { deduped.push(group[0]); continue; }
            const withData = group.filter(hasData);
            const noData = group.filter(i => !hasData(i));
            if (withData.length > 0) {
              deduped.push(...withData);
              toDelete.push(...noData.map(i => i.id));
            } else {
              deduped.push(group[0]);
              toDelete.push(...group.slice(1).map(i => i.id));
            }
          }
          if (toDelete.length > 0) {
            toDelete.forEach(id => deleteFinanceItem(db!, id).catch(() => {}));
          }
          setItems(deduped);
          dbItemsLoadedRef.current = true;
        }

        // Carrega metas
        loadGoals(db!, hId).then(g => {
          if (g.length > 0) { setGoals(g); localStorage.setItem('kashim_goals', JSON.stringify(g)); }
        }).catch(() => {});

        // Detecta se é cliente sem coach que precisa do wizard de onboarding
        const onboardingKey = `onboarding_done_${user!.id}`;
        if (localStorage.getItem(onboardingKey) !== 'true') {
          const hasData = dbItems.some(i => i.values.some(v => v > 0));
          if (!hasCoach && !hasData) {
            setShowOnboarding(true);
          } else {
            localStorage.setItem(onboardingKey, 'true');
          }
        }
      } catch (e) {
        console.error('Erro ao carregar dados:', e);
      } finally {
        setDbLoading(false);
      }
    }

    // Skip if already loaded for this user — prevents token-refresh (every 50s) from wiping state
    if (userDataLoadedRef.current === user.id) return;
    userDataLoadedRef.current = user.id;

    loadData();
  }, [db, user]);

  // Persist startMonth/startYear to localStorage so PWA reloads don't flash back to current month
  useEffect(() => {
    localStorage.setItem('kashim_startMonth', String(startMonth));
    localStorage.setItem('kashim_startYear', String(startYear));
  }, [startMonth, startYear]);

  // Keep refs in sync with state so we can capture snapshots synchronously
  useEffect(() => { currentHouseholdIdRef.current = householdId; }, [householdId]);
  useEffect(() => { currentItemsRef.current = items; }, [items]);
  useEffect(() => { currentStartMonthRef.current = startMonth; }, [startMonth]);
  useEffect(() => { currentStartYearRef.current = startYear; }, [startYear]);

  // Quando coach entra no painel de um cliente, carrega os dados daquele household
  useEffect(() => {
    if (!db || !coachViewHouseholdId) return;
    if (coachViewLoadedRef.current === coachViewHouseholdId) return;
    coachViewLoadedRef.current = coachViewHouseholdId;

    async function loadClientData() {
      setDbLoading(true);
      try {
        // Save coach's own state before overwriting (refs have current values synchronously)
        if (currentHouseholdIdRef.current && currentHouseholdIdRef.current !== coachViewHouseholdId) {
          ownDataSnapshotRef.current = {
            householdId: currentHouseholdIdRef.current,
            items: currentItemsRef.current,
            startMonth: currentStartMonthRef.current,
            startYear: currentStartYearRef.current,
          };
        }
        setHouseholdId(coachViewHouseholdId!);
        const [household, dbItems] = await Promise.all([
          getHousehold(db!, coachViewHouseholdId!),
          loadFinanceItems(db!, coachViewHouseholdId!),
        ]);
        if (household?.start_month != null) setStartMonth(household.start_month);
        if (household?.start_year != null) setStartYear(household.start_year);
        if (dbItems.length > 0) setItems(dbItems);
      } catch (e) {
        console.error('Erro ao carregar dados do cliente:', e);
      } finally {
        setDbLoading(false);
      }
    }

    loadClientData();
  }, [db, coachViewHouseholdId]);

  // Quando coach sai da visão de cliente, restaura os próprios dados
  useEffect(() => {
    if (coachViewHouseholdId) return; // só roda ao sair
    const snap = ownDataSnapshotRef.current;
    if (!snap) return;
    ownDataSnapshotRef.current = null;
    coachViewLoadedRef.current = null;
    setHouseholdId(snap.householdId);
    setItems(snap.items);
    setStartMonth(snap.startMonth);
    setStartYear(snap.startYear);
  }, [coachViewHouseholdId]);

  // Salva item no Supabase sempre que items mudar (debounced)
  const saveTimeoutRef = useRef<any>(null);
  useEffect(() => {
    if (!db || !householdId || dbLoading || !dbItemsLoadedRef.current) return;

    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const dbId = itemIdMapRef.current[item.id] ?? item.id;
        if (pendingDeletesRef.current.has(item.id) || pendingDeletesRef.current.has(dbId)) continue;
        try {
          const savedId = await saveFinanceItem(db!, householdId, item, i);
          if (savedId !== item.id) {
            itemIdMapRef.current[item.id] = savedId;
          }
        } catch (e) {
          console.error('Erro ao salvar item', item.id, e);
        }
      }
    }, 1500);
  }, [items, db, householdId]);

  // startMonth/startYear are saved explicitly in handleReproject and handleSetStartMonth only.
  // Auto-saving here caused a race condition: householdId becoming non-null triggered this effect
  // before setStartMonth(DB value) ran, overwriting the DB with the wrong (current date) month.


  // Detecta retorno do Stripe com pagamento confirmado
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      setSubscriptionStatus('active');
      setShowSubscriptionGate(false);
      window.history.replaceState({}, '', '/');
    }
  }, []);

  // Autenticação via link mágico (sign_in_token)
  useEffect(() => {
    if (!signIn || !setSignInActive || isSignedIn) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('sign_in_token');
    if (!token) return;
    window.history.replaceState({}, '', '/');
    signIn.create({ strategy: 'ticket', ticket: token })
      .then((result) => {
        if (result.status === 'complete') {
          return setSignInActive({ session: result.createdSessionId });
        }
      })
      .catch((err) => console.error('Erro ao autenticar com link mágico:', err));
  }, [signIn, setSignInActive, isSignedIn]);

  const handleCompleteTutorial = () => {
    localStorage.setItem('tutorial_completed', 'true');
    setShowTutorial(false);
  };

  const resetFactory = () => {
    if (confirm("⚠️ RESET DE FÁBRICA: Isso apagará todos os seus lançamentos e configurações para que você possa ver o tutorial novamente. Deseja continuar?")) {
      localStorage.clear();
      window.location.reload();
    }
  };

  const exportBackup = () => {
    const dataStr = JSON.stringify(items, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', `backup_financeiro_rico_${startMonth}_${startYear}.json`);
    linkElement.click();
  };

  const handleReproject = (newStartMonth: number, newStartYear: number) => {
    exportBackup();
    const oldMonths = [...months];
    const newProjectionMonths = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(newStartYear, newStartMonth + i, 1);
      newProjectionMonths.push({ monthName: MONTHS_BR[d.getMonth()], year: d.getFullYear(), index: d.getMonth() });
    }

    setItems(prevItems => prevItems.map(item => {
      const newValues = new Array(12).fill(0);
      const newPaidStatus = new Array(12).fill(false);
      const newPartialExpenses: Record<string, PartialExpense[]> = {};

      newProjectionMonths.forEach((newM, newIdx) => {
        const oldIdx = oldMonths.findIndex(oldM => oldM.monthName === newM.monthName && oldM.year === newM.year);
        if (oldIdx !== -1) {
          newValues[newIdx] = item.values[oldIdx];
          newPaidStatus[newIdx] = item.paidStatus[oldIdx];
          const oldMonthKey = `${oldMonths[oldIdx].year}-${oldMonths[oldIdx].index}`;
          if (item.partialExpenses && item.partialExpenses[oldMonthKey]) {
            newPartialExpenses[`${newM.year}-${newM.index}`] = item.partialExpenses[oldMonthKey];
          }
        }
      });
      return { ...item, values: newValues, paidStatus: newPaidStatus, partialExpenses: newPartialExpenses };
    }));

    setStartMonth(newStartMonth);
    setStartYear(newStartYear);
    if (householdId) {
      getToken({ template: 'supabase' }).then(token =>
        fetch('/api/update-start-month', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ householdId, startMonth: newStartMonth, startYear: newStartYear }),
        })
      ).catch(console.error);
    }
    setShowProjectionModal(false);
  };

  // Moves the 12-month window back to an earlier start WITHOUT remapping values.
  // Safe because going back just relabels which position = which month (no data lost).
  // Uses the service-key API to bypass RLS (direct Supabase client fails for coach views).
  const handleSetStartMonth = async (newStartMonth: number, newStartYear: number) => {
    setStartMonth(newStartMonth);
    setStartYear(newStartYear);
    if (householdId) {
      try {
        const token = await getToken({ template: 'supabase' });
        await fetch('/api/update-start-month', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ householdId, startMonth: newStartMonth, startYear: newStartYear }),
        });
      } catch (e) {
        console.error('handleSetStartMonth save failed:', e);
      }
    }
    const tempMonths = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(newStartYear, newStartMonth + i, 1);
      return { index: d.getMonth(), year: d.getFullYear() };
    });
    const calIdx = tempMonths.findIndex(m => m.index === new Date().getMonth() && m.year === new Date().getFullYear());
    if (calIdx >= 0) setMobileMonthIdx(calIdx);
  };

  const handleWizardComplete = async (result: WizardResult) => {
    const allUpdated: FinanceItem[] = [];

    setItems(prev => {
      const next = prev.map(item => {
        // Update income
        if (item.category === CategoryType.INCOME && result.income > 0) {
          const updated = { ...item, values: new Array(12).fill(result.income) };
          allUpdated.push(updated);
          return updated;
        }
        // Update fixed expense by description
        const expVal = result.expenses[item.description];
        if (expVal !== undefined && expVal > 0) {
          const updated = { ...item, values: new Array(12).fill(expVal) };
          allUpdated.push(updated);
          return updated;
        }
        return item;
      });

      // Add income item if none exists
      const hasIncome = prev.some(i => i.category === CategoryType.INCOME);
      if (!hasIncome && result.income > 0) {
        const newIncome: FinanceItem = { id: crypto.randomUUID(), description: 'Salário', category: CategoryType.INCOME, values: new Array(12).fill(result.income), paidStatus: new Array(12).fill(false) };
        allUpdated.push(newIncome);
        next.push(newIncome);
      }

      // Add extra custom items
      for (const extra of result.extraItems) {
        const newItem: FinanceItem = { id: crypto.randomUUID(), description: extra.description, category: CategoryType.FIXED_EXPENSE, values: new Array(12).fill(extra.value), paidStatus: new Array(12).fill(false) };
        allUpdated.push(newItem);
        next.push(newItem);
      }

      // Add leisure item
      if (result.leisure > 0) {
        const leisure: FinanceItem = { id: crypto.randomUUID(), description: 'Lazer e Despesas Pessoais', category: CategoryType.PERSONAL_LEISURE, values: new Array(12).fill(result.leisure), paidStatus: new Array(12).fill(false) };
        allUpdated.push(leisure);
        next.push(leisure);
      }

      // Remove fixed/leisure items where all values are 0 (user skipped them in wizard)
      return next.filter(item => {
        if (item.category === CategoryType.FIXED_EXPENSE || item.category === CategoryType.PERSONAL_LEISURE) {
          return item.values.some(v => v > 0);
        }
        return true;
      });
    });

    // Save all to DB
    if (db && householdId) {
      for (const item of allUpdated) {
        await saveFinanceItem(db, householdId, item).catch(console.error);
      }
    }

    localStorage.setItem(`onboarding_done_${user!.id}`, 'true');
    localStorage.setItem('tutorial_completed', 'true');
    setShowTutorial(false);
    setShowOnboarding(false);
  };

  const handleGoalsChange = (next: Goal[]) => {
    setGoals(next);
    localStorage.setItem('kashim_goals', JSON.stringify(next));
  };

  const handleAddItem = (category: CategoryType, customData?: Partial<FinanceItem>) => {
    const newItem: FinanceItem = {
      id: crypto.randomUUID(),
      description: customData?.description || '',
      category,
      values: customData?.values || new Array(12).fill(0),
      paidStatus: new Array(12).fill(false)
    };
    setItems(prev => [...prev, newItem]);
  };

  const handleUpdateValue = (id: string, monthIdx: number, value: string) => {
    const numericValue = value === '' ? 0 : parseFloat(value);
    setItems(prev => prev.map(item => item.id === id ? { ...item, values: item.values.map((v, i) => i === monthIdx ? numericValue : v) } : item));
  };

  const handleUpdateDescription = (id: string, desc: string) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, description: desc } : item));
  };

  const handleTogglePaid = (id: string, monthIdx: number) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, paidStatus: item.paidStatus.map((s, i) => i === monthIdx ? !s : s) } : item));
  };

  const handleRemoveItem = (id: string) => {
    const dbId = itemIdMapRef.current[id] ?? id;
    pendingDeletesRef.current.add(id);
    pendingDeletesRef.current.add(dbId);
    setItems(prev => prev.filter(item => item.id !== id));
    if (db) {
      deleteFinanceItem(db, dbId)
        .catch(console.error)
        .finally(() => {
          pendingDeletesRef.current.delete(id);
          pendingDeletesRef.current.delete(dbId);
        });
    }
  };

  const handleUpdateCardConfig = (id: string, field: 'closingDay' | 'dueDay', value: number) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  const handleAddPartial = (itemId: string, expense: PartialExpense, overrideYear?: number, overrideMonth?: number) => {
    // Always record in the month the expense actually happened.
    // The credit card "fatura" month is informational only (shown as a label in TetoGastos).
    const targetMonth = overrideMonth ?? currentActualMonth;
    const targetYear = overrideYear ?? currentActualYear;

    const monthKey = `${targetYear}-${targetMonth}`;
    setItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      const partials = item.partialExpenses || {};
      return { ...item, partialExpenses: { ...partials, [monthKey]: [...(partials[monthKey] || []), expense] } };
    }));

    if (db) {
      const saveWithRetry = (attempt: number) => {
        const dbId = itemIdMapRef.current[itemId] ?? itemId;
        addPartialExpense(db!, dbId, targetYear, targetMonth, expense).catch(() => {
          if (attempt < 5) {
            setTimeout(() => saveWithRetry(attempt + 1), 1500 * attempt);
          }
        });
      };
      saveWithRetry(1);
    }
  };

  const handleExpenseDetected = (data: DetectedExpense) => {
    const source = data.itemId ? 'ai' : 'manual';
    setPendingExpense({ ...data, source });
  };

  const handleAddLeisureItem = (value: number) => {
    const newId = crypto.randomUUID();
    const newItem: FinanceItem = {
      id: newId,
      description: 'Lazer e Despesas Pessoais',
      category: CategoryType.PERSONAL_LEISURE,
      values: new Array(12).fill(value),
      paidStatus: new Array(12).fill(false),
    };
    setItems(prev => [...prev, newItem]);

    // Auto-create a Gastos column linked to the new item (only if none exists yet)
    setTetoColumns(prev => {
      const alreadyHas = prev.some(c => {
        const linked = items.find(i => i.id === c.linkedItemId);
        return linked?.category === CategoryType.PERSONAL_LEISURE;
      });
      if (alreadyHas) return prev;
      const newCol = { id: crypto.randomUUID(), title: 'LAZER', linkedItemId: newId };
      const next = [...prev, newCol];
      if (db && householdId) saveTetoColumns(db, householdId, next).catch(() => {});
      return next;
    });

    setActiveTab('teto');
  };

  const handleConfirmExpense = (data: DetectedExpense) => {
    if (!data.itemId) return;
    const matchedItem = items.find(i => i.id === data.itemId);
    // matchedItem may be null when item was just created in the same event (stale closure) — proceed anyway

    const now = new Date();
    // Use the purchase date the user specified; fall back to today for AI-detected expenses
    const refDay = data.purchaseDate?.day ?? now.getDate();
    const refMonth = data.purchaseDate?.month ?? now.getMonth(); // 0-indexed
    const refYear = data.purchaseDate?.year ?? now.getFullYear();

    const installments = Math.max(1, data.installments ?? 1);
    const fallbackDesc = data.description || matchedItem?.description || '';

    // Convert (year, calendarMonth) → position in the months[] array (0-11)
    const toArrIdx = (year: number, calMonth: number) =>
      months.findIndex(m => m.year === year && m.index === calMonth);

    if (installments <= 1) {
      const dateStr = `${String(refDay).padStart(2, '0')}/${String(refMonth + 1).padStart(2, '0')}`;
      handleAddPartial(data.itemId, {
        id: crypto.randomUUID(),
        date: dateStr,
        description: fallbackDesc,
        value: data.value,
      }, refYear, refMonth);
      if (!matchedItem) {
        const arrIdx = toArrIdx(refYear, refMonth);
        if (arrIdx >= 0) handleUpdateValue(data.itemId, arrIdx, String(data.value));
      }
    } else {
      // Installments start from the purchase month so budget tracking aligns with the card billing cycle.
      // E.g. buying on May 20 → installment 1 tracked in May → offsets June's card bill.
      const startAbsMonth = refYear * 12 + refMonth;
      const baseValue = parseFloat((data.value / installments).toFixed(2));

      for (let i = 0; i < installments; i++) {
        const absMonth = startAbsMonth + i;
        const targetCalMonth = absMonth % 12;
        const targetYear = Math.floor(absMonth / 12);
        const value = i === installments - 1 ? parseFloat((data.value - baseValue * (installments - 1)).toFixed(2)) : baseValue;
        handleAddPartial(data.itemId, {
          id: crypto.randomUUID(),
          date: `${String(i === 0 ? refDay : 1).padStart(2, '0')}/${String(targetCalMonth + 1).padStart(2, '0')}`,
          description: `${fallbackDesc} ${i + 1}/${installments}`,
          value,
        }, targetYear, targetCalMonth);
        if (!matchedItem) {
          const arrIdx = toArrIdx(targetYear, targetCalMonth);
          if (arrIdx >= 0) handleUpdateValue(data.itemId, arrIdx, String(value));
        }
      }
    }

    // Stamp payment method so "Forma de pagamento pendente" doesn't persist
    const newLinkType = !data.isCredit
      ? LinkType.DEBIT
      : (data.installments ?? 1) > 1 ? LinkType.INSTALLMENT : LinkType.ONCE;
    const linkedCardId = (data as DetectedExpense & { linkedCardId?: string }).linkedCardId;
    setItems(prev => prev.map(item => {
      if (item.id !== data.itemId) return item;
      return {
        ...item,
        linkType: item.linkType ?? newLinkType,
        ...(data.isCredit && linkedCardId ? { linkedCardId } : {}),
      };
    }));

    setPendingExpense(null);
  };

  const handleCreateItem = (description: string, category: CategoryType): string => {
    const newId = crypto.randomUUID();
    setItems(prev => [...prev, {
      id: newId,
      description,
      category,
      values: new Array(12).fill(0),
      paidStatus: new Array(12).fill(false),
    }]);
    return newId;
  };

  const handleRemovePartial = (itemId: string, expenseId: string) => {
    setItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      const partials = item.partialExpenses || {};
      const newPartials: Record<string, PartialExpense[]> = {};
      Object.keys(partials).forEach(key => {
        newPartials[key] = partials[key].filter(p => p.id !== expenseId);
      });
      return { ...item, partialExpenses: newPartials };
    }));

    if (db) {
      deletePartialExpense(db, expenseId).catch(console.error);
    }
  };

  const handleReplicateValue = (id: string, monthIdx: number) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, values: i.values.map((v, idx) => idx >= monthIdx ? i.values[monthIdx] : v) } : i));
  };

  const handleMoveItem = (id: string, direction: 'up' | 'down') => {
    setItems(prev => {
      const idx = prev.findIndex(i => i.id === id);
      if (idx === -1) return prev;
      const next = [...prev];
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;
      // Só move dentro da mesma categoria
      if (next[idx].category !== next[swapIdx].category) return prev;
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  };

  const handleLinkCard = (itemId: string, cardId: string, linkType?: LinkType) => {
    setItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      if (linkType === LinkType.DEBIT) return { ...item, linkedCardId: undefined, linkType: LinkType.DEBIT };
      return { ...item, linkedCardId: cardId || undefined, linkType: cardId ? (linkType || LinkType.RECURRING) : undefined };
    }));
  };

  const monthlySummaries = useMemo((): SummaryData[] => {
    const summaries: SummaryData[] = [];
    let accumulated = 0;
    for (let m = 0; m < 12; m++) {
      const totalIncome = items.filter(i => i.category === CategoryType.INCOME).reduce((sum, i) => sum + (i.values[m] || 0), 0);
      const totalFixed = items.filter(i => i.category === CategoryType.FIXED_EXPENSE).reduce((sum, i) => sum + (i.values[m] || 0), 0);
      const totalVariable = items.filter(i => i.category === CategoryType.VARIABLE_EXPENSE).reduce((sum, i) => sum + (i.values[m] || 0), 0);
      const totalLeisure = items.filter(i => i.category === CategoryType.PERSONAL_LEISURE).reduce((sum, i) => sum + (i.values[m] || 0), 0);

      // Desconta da fatura os gastos rastreados via TetoGastos no mês anterior
      // Evita dupla contagem: gasto rastreado em Maio + fatura de Junho com o mesmo valor
      const prevMonthKey = m > 0 ? `${months[m - 1].year}-${months[m - 1].index}` : null;
      const totalCreditCard = items
        .filter(i => i.category === CategoryType.CREDIT_CARD)
        .reduce((sum, card) => {
          const fatura = card.values[m] || 0;
          if (!fatura || !prevMonthKey) return sum + fatura;
          const trackedPrev = items
            .filter(i => i.linkedCardId === card.id)
            .reduce((s, i) => {
              const partials = i.partialExpenses?.[prevMonthKey] || [];
              return s + partials.reduce((ps, p) => ps + p.value, 0);
            }, 0);
          return sum + Math.max(0, fatura - trackedPrev);
        }, 0);

      // Deduplica itens de orçamento fixo/variável/lazer que já estão embutidos na fatura
      // (ex: parcelas ou itens do mês 0 vinculados ao cartão)
      const totalFixedDuplicado = items.filter(i => i.category === CategoryType.FIXED_EXPENSE && i.linkedCardId && (m === 0 || i.linkType === LinkType.INSTALLMENT)).reduce((sum, i) => sum + (i.values[m] || 0), 0);
      const totalVariableDuplicado = items.filter(i => i.category === CategoryType.VARIABLE_EXPENSE && i.linkedCardId && (m === 0 || i.linkType === LinkType.INSTALLMENT)).reduce((sum, i) => sum + (i.values[m] || 0), 0);
      const totalLeisureDuplicado = items.filter(i => i.category === CategoryType.PERSONAL_LEISURE && i.linkedCardId && (m === 0 || i.linkType === LinkType.INSTALLMENT)).reduce((sum, i) => sum + (i.values[m] || 0), 0);

      const totalCost = totalCreditCard +
                        (totalFixed - totalFixedDuplicado) +
                        (totalVariable - totalVariableDuplicado) +
                        (totalLeisure - totalLeisureDuplicado);
      const balance = totalIncome - totalCost;
      accumulated += balance;
      summaries.push({ totalIncome, totalCreditCard, totalFixed, totalVariable, totalLeisure, totalCost, balance, accumulated });
    }
    return summaries;
  }, [items, months]);

  const allCards = useMemo(() => items.filter(i => i.category === CategoryType.CREDIT_CARD), [items]);

  const trackedByCardPrevMonth = useMemo((): Record<string, number> => {
    if (mobileMonthIdx === 0) return {};
    const prevMonthData = months[mobileMonthIdx - 1];
    const prevMonthKey = `${prevMonthData.year}-${prevMonthData.index}`;
    const result: Record<string, number> = {};
    allCards.forEach(card => {
      const tracked = items
        .filter(i => i.linkedCardId === card.id)
        .reduce((sum, i) => {
          const partials = i.partialExpenses?.[prevMonthKey] || [];
          return sum + partials.reduce((s, p) => s + p.value, 0);
        }, 0);
      if (tracked > 0) result[card.id] = tracked;
    });
    return result;
  }, [items, allCards, mobileMonthIdx, months]);

  const trackedByCardAllMonths = useMemo((): Record<string, Record<number, number>> => {
    const result: Record<string, Record<number, number>> = {};
    allCards.forEach(card => {
      months.forEach((_, mIdx) => {
        if (mIdx === 0) return;
        const prevMonthData = months[mIdx - 1];
        const prevMonthKey = `${prevMonthData.year}-${prevMonthData.index}`;
        const tracked = items
          .filter(i => i.linkedCardId === card.id)
          .reduce((sum, i) => {
            const partials = i.partialExpenses?.[prevMonthKey] || [];
            return sum + partials.reduce((s, p) => s + p.value, 0);
          }, 0);
        if (tracked > 0) {
          if (!result[card.id]) result[card.id] = {};
          result[card.id][mIdx] = tracked;
        }
      });
    });
    return result;
  }, [items, allCards, months]);

  const projectionOptions = useMemo(() => {
    const options = [];
    const now = new Date();
    for (let i = -3; i < 21; i++) { // 3 months back so user can recover from auto-advance bug
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      options.push({ month: d.getMonth(), year: d.getFullYear(), label: `${MONTHS_BR[d.getMonth()]} ${d.getFullYear()}` });
    }
    return options;
  }, []);

  // Coach/assistente sem cliente selecionado → Dashboard
  if (isLoaded && isSignedIn && isAdmin && !coachViewHouseholdId) {
    return (
      <CoachDashboard
        onEnterClient={(hId, name) => {
          setCoachViewHouseholdId(hId);
          setCoachViewClientName(name);
        }}
        isSuperAdmin={ADMIN_IDS.includes(user?.id ?? '')}
      />
    );
  }

  if (!isLoaded) {
    if (clerkTimeout) {
      return (
        <div className="min-h-screen bg-[#f5f5f7] flex flex-col items-center justify-center gap-6 p-8">
          <img src="/kashim-icon.png" alt="Kashim" className="w-16 h-16 rounded-2xl opacity-60" />
          <p className="text-[#6e6e73] text-sm text-center">Falha ao conectar. Verifique sua internet e tente novamente.</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 text-[#182200] font-bold rounded-xl text-sm k-btn-lime"
            style={{background:'linear-gradient(180deg,#c5f23a 0%,#a2d800 50%,#8cc400 100%)',boxShadow:'0 4px 14px rgba(130,192,0,0.4)'}}
          >
            Tentar novamente
          </button>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-[#a8e716] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-green-500/10 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-green-500/5 rounded-full blur-[120px]"></div>

        <div className="max-w-md w-full relative z-10 flex flex-col items-center gap-10">
          <div className="text-center flex flex-col items-center gap-4">
            <img src="/kashim-icon.png" alt="Kashim" className="w-20 h-20 rounded-3xl shadow-2xl shadow-green-500/20" />
            <h1 className="text-3xl font-black uppercase italic tracking-tighter text-white">Kashim</h1>
            <p className="text-zinc-400 text-xs font-bold uppercase tracking-[0.2em] leading-relaxed">
              A forma mais simples de se manter organizado financeiramente.
            </p>
          </div>

          {authMode === 'login' ? (
            <SignIn routing="hash" appearance={{
              elements: {
                headerTitle: 'hidden',
                headerSubtitle: 'hidden',
              }
            }} />
          ) : (
            <SignUp routing="hash" appearance={{
              elements: {
                headerTitle: 'hidden',
                headerSubtitle: 'hidden',
              }
            }} />
          )}

          <button
            onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
            className="text-zinc-500 hover:text-green-400 text-[10px] font-black uppercase tracking-[0.2em] transition-colors"
          >
            {authMode === 'login' ? 'Ainda não é membro? Criar conta' : 'Já possuo conta? Entrar'}
          </button>

          <div className="text-zinc-900 text-[10px] font-black uppercase tracking-[0.6em] opacity-40">Professor Digital Stets</div>

          <p className="text-zinc-700 text-[10px] text-center leading-relaxed">
            Ao criar sua conta, você concorda com os nossos{' '}
            <a href="/termos.html" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-green-400 underline transition-colors">
              Termos de Uso e Política de Privacidade
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f]">
      {showOnboarding && user && (
        <OnboardingWizard
          userName={user.firstName || user.emailAddresses[0]?.emailAddress.split('@')[0] || ''}
          onComplete={handleWizardComplete}
        />
      )}

      {!showOnboarding && showTutorial && <OnboardingTutorial onComplete={handleCompleteTutorial} />}

      {showWebNotice && (
        <div className="fixed bottom-20 left-3 right-3 z-[90] animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div className="bg-zinc-900 border border-green-500/30 rounded-2xl px-4 py-3 shadow-2xl flex items-center gap-3">
            <i className="fas fa-desktop text-green-400 shrink-0"></i>
            <p className="text-zinc-300 text-xs leading-relaxed flex-1">
              Sabia que você também acessa o Kashim pelo navegador em <span className="text-green-300 font-bold">app.kashim.com.br</span> com uma experiência ainda mais completa?
            </p>
            <button
              onClick={() => { localStorage.setItem('web_notice_dismissed', 'true'); setShowWebNotice(false); }}
              className="text-zinc-500 active:text-white shrink-0 p-1"
            >
              <i className="fas fa-times text-sm"></i>
            </button>
          </div>
        </div>
      )}

      {showSubscriptionGate && (
        <SubscriptionGate onClose={() => setShowSubscriptionGate(false)} />
      )}

      {showSettings && isAdmin ? (
        <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowSettings(false)}>
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-t-3xl p-6 pb-10" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mb-6"></div>
            {user && (
              <div className="flex items-center gap-3 mb-6 p-4 bg-zinc-800 rounded-2xl">
                <img src={user.imageUrl} className="w-12 h-12 rounded-full border-2 border-green-400/30" alt="Avatar" />
                <div>
                  <p className="text-white font-black text-sm uppercase italic">{user.firstName} {user.lastName}</p>
                  <p className="text-zinc-500 text-xs">{user.emailAddresses[0]?.emailAddress}</p>
                  <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full bg-green-400/10 border border-green-400/20 text-green-400 mt-1 inline-block">Consultor</span>
                </div>
              </div>
            )}
            <button
              onClick={() => signOut()}
              className="w-full bg-red-500/10 border border-red-500/20 active:bg-red-500/20 text-red-400 font-black py-3.5 rounded-2xl transition-all text-sm uppercase flex items-center justify-center gap-2"
            >
              <i className="fas fa-sign-out-alt"></i> Sair da conta
            </button>
            <button
              onClick={() => setShowSettings(false)}
              className="w-full mt-2 text-zinc-600 font-black py-2 rounded-2xl transition-all text-xs uppercase"
            >
              Fechar
            </button>
          </div>
        </div>
      ) : showSettings && db && householdId ? (
        <ClientSettings
          db={db}
          householdId={householdId}
          onClose={() => setShowSettings(false)}
          summary={monthlySummaries[mobileMonthIdx]}
          currentMonthIdx={months[mobileMonthIdx].index}
          currentYear={months[mobileMonthIdx].year}
          subscriptionStatus={subscriptionStatus}
        />
      ) : showSettings && dbLoading ? (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowSettings(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 text-center">
            <div className="w-10 h-10 border-2 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-zinc-400 text-sm">Carregando perfil...</p>
          </div>
        </div>
      ) : showSettings ? (
        <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowSettings(false)}>
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-t-3xl p-6 pb-10" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mb-6"></div>
            {user && (
              <div className="flex items-center gap-3 mb-6 p-4 bg-zinc-800 rounded-2xl">
                <img src={user.imageUrl} className="w-12 h-12 rounded-full border-2 border-green-400/30" alt="Avatar" />
                <div>
                  <p className="text-white font-black text-sm uppercase italic">{user.firstName} {user.lastName}</p>
                  <p className="text-zinc-500 text-xs">{user.emailAddresses[0]?.emailAddress}</p>
                </div>
              </div>
            )}
            <button
              onClick={() => signOut()}
              className="w-full bg-red-500/10 border border-red-500/20 active:bg-red-500/20 text-red-400 font-black py-3.5 rounded-2xl transition-all text-sm uppercase flex items-center justify-center gap-2"
            >
              <i className="fas fa-sign-out-alt"></i> Sair da conta
            </button>
            <button onClick={() => setShowSettings(false)} className="w-full mt-2 text-zinc-600 font-black py-2 text-xs uppercase">Fechar</button>
          </div>
        </div>
      ) : null}

      {showInvitePanel && db && householdId && user && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm">
          <div className="max-w-md w-full relative">
            <button
              onClick={() => setShowInvitePanel(false)}
              className="absolute -top-4 -right-4 w-10 h-10 bg-zinc-800 text-zinc-400 hover:text-white rounded-full flex items-center justify-center z-10 border border-zinc-700"
            >
              <i className="fas fa-times"></i>
            </button>
            <InvitePartner db={db} householdId={householdId} currentUserId={user.id} />
          </div>
        </div>
      )}
      
      {showProjectionModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/85 backdrop-blur-md animate-in fade-in duration-300">
          <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-[30px] p-8 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-red-600"></div>
            <div className="w-16 h-16 bg-red-600/10 rounded-full flex items-center justify-center mb-6 border border-red-600/20">
              <i className="fas fa-exclamation-triangle text-2xl text-red-600"></i>
            </div>
            <h3 className="text-white text-xl font-black uppercase italic tracking-tighter mb-4">Reprojetar Plano</h3>
            <div className="space-y-4 text-zinc-400 text-sm mb-10 leading-relaxed">
              <p>Você selecionou projetar a partir de <span className="text-green-400 font-bold uppercase">{MONTHS_BR[pendingStartMonth?.month || 0]} {pendingStartMonth?.year}</span>.</p>
              <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-800 flex flex-col gap-4">
                <div className="flex gap-4">
                  <i className="fas fa-trash-alt text-red-500 mt-1"></i>
                  <p><span className="text-white font-bold">Todos os meses anteriores serão apagados</span> do seu dashboard atual.</p>
                </div>
                <div className="flex gap-4">
                  <i className="fas fa-file-excel text-green-500 mt-1"></i>
                  <p><span className="text-white font-bold">Enviaremos um arquivo Excel</span> com todas as informações passadas para que você as tenha guardadas.</p>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => pendingStartMonth && handleReproject(pendingStartMonth.month, pendingStartMonth.year)}
                className="w-full bg-green-500 hover:bg-green-400 text-black font-black py-4 rounded-2xl transition-all shadow-lg uppercase text-xs tracking-widest"
              >
                Sim, Reprojetar e Baixar Backup
              </button>
              <button onClick={() => { setShowProjectionModal(false); setPendingStartMonth(null); }} className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-4 rounded-2xl transition-all uppercase text-[10px] tracking-widest">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── HEADER ─────────────────────────────────────────────── */}
      <header id="header" className="bg-white/90 backdrop-blur-xl safe-top sticky top-0 z-50 border-b border-[#e8e8ed]">

        {/* Mobile header */}
        <div className="lg:hidden flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-2">
            <img src="/kashim-icon.png" alt="Kashim" className="h-8 w-8 rounded-xl" />
            <span className="text-[#1d1d1f] font-black text-sm uppercase italic tracking-tight">Kashim</span>
            {dbLoading && <i className="fas fa-circle-notch animate-spin text-[#7ab800] text-xs ml-1"></i>}
          </div>
          {coachViewHouseholdId && (
            <div className="flex items-center gap-1 bg-[#f0fad0] border border-[rgba(122,184,0,0.3)] px-2 py-1 rounded-lg">
              <i className="fas fa-eye text-[#7ab800] text-xs"></i>
              <span className="text-[#7ab800] text-[9px] font-black uppercase truncate max-w-[80px]">{coachViewClientName}</span>
              <button onClick={() => { setCoachViewHouseholdId(null); setCoachViewClientName(''); }} className="text-[#aeaeb2] ml-1">
                <i className="fas fa-times text-xs"></i>
              </button>
            </div>
          )}
          <div className="flex items-center gap-1">
            {!isAdmin && (
              <button onClick={() => setShowInvitePanel(p => !p)} className="w-10 h-10 flex items-center justify-center text-[#aeaeb2] active:text-[#7ab800]">
                <i className="fas fa-user-plus text-base"></i>
              </button>
            )}
            {user?.imageUrl ? (
              <img src={user.imageUrl} className="w-8 h-8 rounded-full border border-[#e8e8ed] cursor-pointer" onClick={() => setShowSettings(true)} />
            ) : (
              <button onClick={() => setShowSettings(true)} className="w-10 h-10 flex items-center justify-center text-[#aeaeb2] active:text-[#7ab800]">
                <i className="fas fa-user-circle text-xl"></i>
              </button>
            )}
          </div>
        </div>

        {/* Desktop header */}
        <div className="hidden lg:flex max-w-[1600px] mx-auto px-8 py-3 flex-col lg:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <img src="/kashim-icon.png" alt="Kashim" className="h-10 w-10 rounded-xl shadow-sm" />
            {user && (
              <div className="flex items-center gap-3 border-l border-[#e8e8ed] pl-4">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#6e6e73]">{user.firstName || user.emailAddresses[0]?.emailAddress.split('@')[0]}</span>
              </div>
            )}
          </div>
          <div className="flex gap-2 bg-[#f5f5f7] p-1 rounded-xl border border-[#e8e8ed]">
            <button onClick={() => setActiveTab('plan')} className={`px-6 py-2 rounded-lg text-xs font-black uppercase transition-all ${activeTab === 'plan' ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#6e6e73] hover:text-[#1d1d1f]'}`}>Gastos Mensais</button>
            <button id="tab-gastos-frequentes" onClick={() => setActiveTab('teto')} className={`px-6 py-2 rounded-lg text-xs font-black uppercase transition-all ${activeTab === 'teto' ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#6e6e73] hover:text-[#1d1d1f]'}`}>Gastos Frequentes</button>
            <button onClick={() => setActiveTab('metas')} className={`px-6 py-2 rounded-lg text-xs font-black uppercase transition-all ${activeTab === 'metas' ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#6e6e73] hover:text-[#1d1d1f]'}`}>Metas</button>
            <button onClick={() => setActiveTab('desempenho')} className={`px-6 py-2 rounded-lg text-xs font-black uppercase transition-all ${activeTab === 'desempenho' ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#6e6e73] hover:text-[#1d1d1f]'}`}>Desempenho</button>
            {coachViewHouseholdId && (
              <div className="flex items-center gap-2 bg-[#f0fad0] border border-[rgba(122,184,0,0.3)] px-3 py-1.5 rounded-xl">
                <i className="fas fa-eye text-[#7ab800] text-xs"></i>
                <span className="text-[#7ab800] text-[10px] font-black uppercase">{coachViewClientName}</span>
                <button onClick={() => { setCoachViewHouseholdId(null); setCoachViewClientName(''); }} className="text-[#aeaeb2] hover:text-[#1d1d1f] ml-1 transition-colors">
                  <i className="fas fa-times text-xs"></i>
                </button>
              </div>
            )}
            {dbLoading && <div className="px-3 py-2 text-[#7ab800]"><i className="fas fa-circle-notch animate-spin text-xs"></i></div>}
            {!isAdmin && (
              <button onClick={() => setShowInvitePanel(p => !p)} className="px-3 py-2 text-[#aeaeb2] hover:text-[#7ab800] transition-colors" title="Convidar parceiro(a)">
                <i className="fas fa-user-plus"></i>
              </button>
            )}
            {!isAdmin && (
              <button onClick={() => setShowSettings(true)} className="px-3 py-2 text-[#aeaeb2] hover:text-[#7ab800] transition-colors" title="Configurações">
                <i className="fas fa-cog"></i>
              </button>
            )}
            <button onClick={() => signOut()} className="px-3 py-2 text-[#aeaeb2] hover:text-red-500 transition-colors"><i className="fas fa-sign-out-alt"></i></button>
          </div>
        </div>
      </header>


      <main className={`${activeTab === 'plan' ? 'max-w-[1600px]' : 'w-full px-2'} mx-auto px-2 lg:px-8 mt-2 lg:mt-8`} style={(activeTab === 'desempenho' || activeTab === 'metas') ? { maxWidth: '100%' } : {}}>
        {activeTab === 'desempenho' ? (
          <Desempenho summary={monthlySummaries[mobileMonthIdx]} summaries={monthlySummaries.slice(0, mobileMonthIdx + 1)} items={items} goals={goals} />
        ) : activeTab === 'metas' ? (
          <Metas goals={goals} onGoalsChange={handleGoalsChange} db={db} householdId={householdId} />
        ) : activeTab === 'plan' ? (
          <>
            <div id="stets"><AICoach summary={monthlySummaries[mobileMonthIdx]} items={items} monthName={months[mobileMonthIdx].monthName} onExpenseDetected={handleExpenseDetected} tetoColumns={tetoColumns} /></div>
            <div id="diagnosis" className="hidden lg:block"><Diagnosis summary={monthlySummaries[0]} monthName={months[0].monthName} /></div>

            {/* ── MOBILE SUMMARY CARDS ──────────────────────────────── */}
            {/* Hero dark card — Acumulado */}
            <div className="lg:hidden px-3 mb-3">
              <div className="bg-[#1d1d1f] rounded-[24px] p-5 relative overflow-hidden">
                <div className="absolute top-[-50px] right-[-30px] w-[180px] h-[180px] rounded-full pointer-events-none" style={{background:'radial-gradient(circle,rgba(168,231,22,0.18) 0%,transparent 65%)'}}></div>
                <div className="text-[10px] font-bold uppercase tracking-[2px] text-white/40 mb-1">Acumulado</div>
                <div className="text-white font-black k-num" style={{fontSize:'36px',letterSpacing:'-0.04em',lineHeight:1}}>
                  {formatCurrency(monthlySummaries[mobileMonthIdx].accumulated)}
                </div>
                <div className="text-white/30 text-[11px] mt-2">
                  {months[mobileMonthIdx].monthName} {months[mobileMonthIdx].year}
                </div>
              </div>
            </div>
            <div className="lg:hidden grid grid-cols-3 gap-2 px-3 mb-3">
              <div className="bg-white border border-[#e8e8ed] rounded-[18px] p-3 overflow-hidden shadow-sm">
                <div className="text-[7px] font-black uppercase text-[#aeaeb2] tracking-widest mb-1">Entradas</div>
                <div className="text-[#34c759] font-black k-num text-xs leading-tight truncate">{formatCurrency(monthlySummaries[mobileMonthIdx].totalIncome)}</div>
              </div>
              <div className="bg-white border border-[#e8e8ed] rounded-[18px] p-3 overflow-hidden shadow-sm">
                <div className="text-[7px] font-black uppercase text-[#aeaeb2] tracking-widest mb-1">Gastos</div>
                <div className="text-[#ff3b30] font-black k-num text-xs leading-tight truncate">{formatCurrency(monthlySummaries[mobileMonthIdx].totalCost)}</div>
              </div>
              <div className={`border rounded-[18px] p-3 overflow-hidden shadow-sm ${monthlySummaries[mobileMonthIdx].balance >= 0 ? 'bg-[#f0fad0] border-[rgba(122,184,0,0.25)]' : 'bg-[#fff0f0] border-[rgba(255,59,48,0.2)]'}`}>
                <div className="text-[7px] font-black uppercase tracking-widest mb-1 text-[#aeaeb2]">Sobra/Falta</div>
                <div className={`font-black k-num text-xs leading-tight truncate ${monthlySummaries[mobileMonthIdx].balance >= 0 ? 'text-[#7ab800]' : 'text-[#ff3b30] animate-pulse'}`}>{formatCurrency(monthlySummaries[mobileMonthIdx].balance)}</div>
              </div>
            </div>

            {/* ── MOBILE MONTH NAVIGATOR ── */}
            <div className="lg:hidden bg-white border border-[#e8e8ed] rounded-[18px] mx-3 mb-3 shadow-sm">
              <div className="flex items-center justify-between px-3 py-3">
                <button onClick={() => setMobileMonthIdx(i => Math.max(0, i - 1))} disabled={mobileMonthIdx === 0} className="w-10 h-10 flex items-center justify-center text-[#aeaeb2] disabled:opacity-20 active:text-[#7ab800] rounded-xl">
                  <i className="fas fa-chevron-left text-sm"></i>
                </button>
                <div className="text-center">
                  <div className="text-[#1d1d1f] font-black uppercase tracking-tight text-base">{months[mobileMonthIdx].monthName} {months[mobileMonthIdx].year}</div>
                  {months[mobileMonthIdx].index === currentActualMonth && months[mobileMonthIdx].year === currentActualYear && <div className="text-[#7ab800] text-[9px] font-black uppercase tracking-widest mt-0.5">Mês atual</div>}
                </div>
                <button onClick={() => setMobileMonthIdx(i => Math.min(11, i + 1))} disabled={mobileMonthIdx === 11} className="w-10 h-10 flex items-center justify-center text-[#aeaeb2] disabled:opacity-20 active:text-[#7ab800] rounded-xl">
                  <i className="fas fa-chevron-right text-sm"></i>
                </button>
              </div>
              <div className="flex justify-center gap-1.5 pb-3">
                {months.map((_, i) => (
                  <button key={i} onClick={() => setMobileMonthIdx(i)} className={`rounded-full transition-all ${i === mobileMonthIdx ? 'w-4 h-1.5 bg-[#a8e716]' : 'w-1.5 h-1.5 bg-[#e8e8ed]'}`} />
                ))}
              </div>
            </div>

            <div id="blocks">
              {[
                { title: "ENTRADAS (Rendas)", type: CategoryType.INCOME },
                { title: "FATURAS DE CARTÃO", type: CategoryType.CREDIT_CARD },
                { title: "CONTAS FIXAS", subtitle: "Recorrentes ou > 12 parcelas", type: CategoryType.FIXED_EXPENSE },
                { title: "CONTAS VARIÁVEIS", type: CategoryType.VARIABLE_EXPENSE },
                { title: "LAZER E GASTOS PESSOAIS", type: CategoryType.PERSONAL_LEISURE }
              ].map(block => (
                <BlockSection
                  key={block.type} title={block.title} subtitle={block.subtitle} category={block.type}
                  items={items.filter(i => i.category === block.type)} allCards={allCards} months={months}
                  totalIncome={monthlySummaries[0].totalIncome}
                  mobileMonthIdx={mobileMonthIdx}
                  onAddItem={handleAddItem} onUpdateValue={handleUpdateValue} onTogglePaid={handleTogglePaid}
                  onRemoveItem={handleRemoveItem} onUpdateDescription={handleUpdateDescription}
                  onReplicateValue={handleReplicateValue} onLinkCard={handleLinkCard}
                  onUpdateCardConfig={handleUpdateCardConfig} onMoveItem={handleMoveItem}
                  trackedByCardId={block.type === CategoryType.CREDIT_CARD ? trackedByCardPrevMonth : undefined}
                  trackedByCardAllMonths={block.type === CategoryType.CREDIT_CARD ? trackedByCardAllMonths : undefined}
                  onRequestExpenseSheet={block.type === CategoryType.VARIABLE_EXPENSE
                    ? () => {
                        const vm = months[mobileMonthIdx];
                        const isNow = vm.index === currentActualMonth && vm.year === currentActualYear;
                        setPendingExpense({ source: 'manual', itemId: '', value: 0, description: '', installments: 1, isCredit: false, purchaseDate: { day: isNow ? new Date().getDate() : 1, month: vm.index, year: vm.year } });
                      }
                    : undefined}
                  onAddLeisureItem={block.type === CategoryType.PERSONAL_LEISURE ? handleAddLeisureItem : undefined}
                />
              ))}
            </div>

            <div id="summary-section" className="hidden lg:block bg-zinc-900 border border-green-500/30 rounded-[40px] p-8 mt-12 mb-8 shadow-2xl overflow-hidden">
              <h3 className="text-green-400 font-black text-xl uppercase italic tracking-tighter mb-8 flex items-center gap-3"><i className="fas fa-vault"></i> Compilação Financeira</h3>
              <div className="overflow-x-auto pb-4">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-zinc-500 font-black uppercase text-[10px] tracking-widest border-b border-zinc-800">
                      <th className="p-4 bg-zinc-950/50 rounded-tl-2xl">Mês / Ano</th>
                      {months.map((m, i) => (
                        <th key={i} className={`p-4 text-center ${i === 0 ? 'text-green-400 bg-green-400/5 font-black' : 'font-bold'}`}>
                          <div className="flex flex-col">
                            <span>{m.monthName}</span>
                            <span className="text-[8px] opacity-50">{m.year}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                      <td className="p-4 font-bold text-zinc-300">Total de Entradas</td>
                      {monthlySummaries.map((s, i) => <td key={i} className="p-4 text-center text-green-500 font-mono font-bold">{formatCurrency(s.totalIncome)}</td>)}
                    </tr>
                    <tr className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                      <td className="p-4 font-bold text-zinc-300">Faturas de Cartão</td>
                      {monthlySummaries.map((s, i) => <td key={i} className="p-4 text-center text-orange-400 font-mono">{formatCurrency(s.totalCreditCard)}</td>)}
                    </tr>
                    <tr className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                      <td className="p-4 font-bold text-zinc-300">Custos Fixos</td>
                      {monthlySummaries.map((s, i) => <td key={i} className="p-4 text-center text-red-400/80 font-mono">{formatCurrency(s.totalFixed)}</td>)}
                    </tr>
                    <tr className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                      <td className="p-4 font-bold text-zinc-300">Custos Variáveis</td>
                      {monthlySummaries.map((s, i) => <td key={i} className="p-4 text-center text-cyan-400/80 font-mono">{formatCurrency(s.totalVariable)}</td>)}
                    </tr>
                    <tr className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                      <td className="p-4 font-bold text-zinc-300">Gastos Pessoais e Lazer</td>
                      {monthlySummaries.map((s, i) => <td key={i} className="p-4 text-center text-purple-400/80 font-mono">{formatCurrency(s.totalLeisure)}</td>)}
                    </tr>
                    <tr className="border-b-2 border-zinc-800 bg-zinc-950/20">
                      <td className="p-4 font-black text-white uppercase italic">Sobras / Faltas</td>
                      {monthlySummaries.map((s, i) => (
                        <td key={i} className={`p-4 text-center font-black font-mono whitespace-nowrap ${s.balance >= 0 ? 'text-green-400' : 'text-red-500 animate-pulse'}`}>
                          {formatCurrency(s.balance)}
                        </td>
                      ))}
                    </tr>
                    <tr className="bg-green-500/5">
                      <td className="p-6 font-black text-green-400 uppercase italic text-base">ACUMULADO</td>
                      {monthlySummaries.map((s, i) => <td key={i} className="p-6 text-center font-black font-mono text-lg text-green-400 drop-shadow-lg whitespace-nowrap">{formatCurrency(s.accumulated)}</td>)}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6 mb-20">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-zinc-100 rounded-2xl flex items-center justify-center text-zinc-400">
                  <i className="fas fa-history text-xl"></i>
                </div>
                <div>
                  <h4 className="text-[10px] font-black uppercase text-zinc-400 tracking-widest">Gestão de Ciclo</h4>
                  <p className="text-sm font-bold text-zinc-800">Seu plano atual inicia em <span className="text-green-500 uppercase italic">{months[0].monthName} {months[0].year}</span></p>
                </div>
              </div>
              <div className="flex items-center gap-3 w-full md:w-auto">
                <select
                  className="bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-xs font-black uppercase text-zinc-700 outline-none focus:border-green-400 transition-all"
                  value={`${startMonth}-${startYear}`}
                  onChange={(e) => {
                    const [m, y] = e.target.value.split('-').map(Number);
                    const selectedAbs = y * 12 + m;
                    const currentAbs = startYear * 12 + startMonth;
                    if (selectedAbs <= currentAbs) {
                      // Going back: just relabel months, no remap or data loss
                      handleSetStartMonth(m, y);
                    } else {
                      // Going forward: full reproject (export + remap)
                      setPendingStartMonth({ month: m, year: y });
                      setShowProjectionModal(true);
                    }
                  }}
                >
                  {projectionOptions.map((opt, i) => <option key={i} value={`${opt.month}-${opt.year}`}>{opt.label}</option>)}
                </select>
                <button 
                  onClick={() => setShowProjectionModal(true)} 
                  className="bg-zinc-900 hover:bg-black text-green-400 text-[10px] font-black px-6 py-3.5 rounded-xl uppercase transition-all shadow-lg whitespace-nowrap"
                >
                  Reprojetar Ciclo
                </button>
              </div>
            </div>
          </>
        ) : (
          <TetoGastos items={items} currentMonthIdx={currentActualMonth} currentYear={currentActualYear} onAddPartial={handleAddPartial} onRemovePartial={handleRemovePartial} db={db} householdId={householdId} />
        )}
      </main>

      {/* ── MOBILE BOTTOM TAB BAR ──────────────────────────────────────── */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 safe-bottom" style={{background:'rgba(245,245,247,0.92)',backdropFilter:'blur(28px) saturate(1.8)',borderTop:'0.5px solid rgba(0,0,0,0.1)'}}>
        <div className="overflow-x-auto scrollbar-none">
          <div className="flex min-w-max">
            <button
              onClick={() => setActiveTab('plan')}
              className={`min-w-[72px] flex flex-col items-center justify-center pt-2 pb-1 gap-0.5 transition-colors active:scale-95 relative ${activeTab === 'plan' ? 'text-[#7ab800]' : 'text-[#aeaeb2]'}`}
            >
              <div className={`w-7 h-7 flex items-center justify-center rounded-[9px] transition-all ${activeTab === 'plan' ? 'bg-[#f0fad0]' : ''}`}>
                <i className={`fas fa-chart-bar text-lg`}></i>
              </div>
              <span className="text-[9px] font-black uppercase tracking-wide">Plano</span>
            </button>

            <button
              onClick={() => setActiveTab('teto')}
              className={`min-w-[72px] flex flex-col items-center justify-center pt-2 pb-1 gap-0.5 transition-colors active:scale-95 relative ${activeTab === 'teto' ? 'text-[#7ab800]' : 'text-[#aeaeb2]'}`}
            >
              <div className={`w-7 h-7 flex items-center justify-center rounded-[9px] transition-all ${activeTab === 'teto' ? 'bg-[#f0fad0]' : ''}`}>
                <i className={`fas fa-wallet text-lg`}></i>
              </div>
              <span className="text-[9px] font-black uppercase tracking-wide">Gastos</span>
            </button>

            {/* Central launch button */}
            <button
              onClick={() => {
                const vm = months[mobileMonthIdx];
                const isNow = vm.index === currentActualMonth && vm.year === currentActualYear;
                setPendingExpense({ source: 'manual', itemId: '', value: 0, description: '', installments: 1, isCredit: false, purchaseDate: { day: isNow ? new Date().getDate() : 1, month: vm.index, year: vm.year } });
              }}
              className="min-w-[72px] flex flex-col items-center justify-center py-1.5 gap-0.5 mx-1 rounded-xl active:scale-95 transition-all k-btn-lime"
              style={{background:'linear-gradient(180deg,#c5f23a 0%,#a2d800 50%,#8cc400 100%)',boxShadow:'0 4px 14px rgba(130,192,0,0.4),inset 0 1px 0 rgba(255,255,255,0.45)',borderRadius:'14px'}}
            >
              <i className="fas fa-plus text-[#182200] text-lg font-black"></i>
              <span className="text-[9px] font-black uppercase tracking-wide text-[#182200]">Lançar</span>
            </button>

            <button
              onClick={() => setActiveTab('metas')}
              className={`min-w-[72px] flex flex-col items-center justify-center pt-2 pb-1 gap-0.5 transition-colors active:scale-95 relative ${activeTab === 'metas' ? 'text-[#7ab800]' : 'text-[#aeaeb2]'}`}
            >
              <div className={`w-7 h-7 flex items-center justify-center rounded-[9px] transition-all ${activeTab === 'metas' ? 'bg-[#f0fad0]' : ''}`}>
                <i className={`fas fa-bullseye text-lg`}></i>
              </div>
              <span className="text-[9px] font-black uppercase tracking-wide">Metas</span>
            </button>

            <button
              onClick={() => setActiveTab('desempenho')}
              className={`min-w-[80px] flex flex-col items-center justify-center pt-2 pb-1 gap-0.5 transition-colors active:scale-95 relative ${activeTab === 'desempenho' ? 'text-[#7ab800]' : 'text-[#aeaeb2]'}`}
            >
              <div className={`w-7 h-7 flex items-center justify-center rounded-[9px] transition-all ${activeTab === 'desempenho' ? 'bg-[#f0fad0]' : ''}`}>
                <i className={`fas fa-chart-pie text-lg`}></i>
              </div>
              <span className="text-[9px] font-black uppercase tracking-wide">Desempenho</span>
            </button>

            <button
              onClick={() => setShowSettings(true)}
              className="min-w-[72px] flex flex-col items-center justify-center pt-2 pb-1 gap-0.5 text-[#aeaeb2] transition-colors active:scale-95"
            >
              <div className="w-7 h-7 flex items-center justify-center rounded-[9px]">
                <i className="fas fa-user-circle text-lg"></i>
              </div>
              <span className="text-[9px] font-black uppercase tracking-wide">Perfil</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Spacer so bottom tab bar doesn't cover content on mobile */}
      <div className="lg:hidden h-20"></div>

      {/* Expense confirmation / entry sheet */}
      <ExpenseSheet
        open={!!pendingExpense}
        source={pendingExpense?.source ?? 'manual'}
        items={items}
        initialItemId={pendingExpense?.itemId}
        initialValue={pendingExpense?.value}
        initialDescription={pendingExpense?.description}
        initialInstallments={pendingExpense?.installments}
        defaultPurchaseDate={pendingExpense?.purchaseDate}
        onConfirm={handleConfirmExpense}
        onClose={() => setPendingExpense(null)}
        onCreateItem={handleCreateItem}
      />
    </div>
  );
};

export default App;
