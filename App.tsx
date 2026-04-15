
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useUser, useClerk, useSignIn, SignIn, SignUp } from '@clerk/clerk-react';
import { CategoryType, FinanceItem, SummaryData, LinkType, PartialExpense } from './types';
import { getNext12Months, formatCurrency, MONTHS_BR } from './constants';
import BlockSection from './components/BlockSection';
import Diagnosis from './components/Diagnosis';
import TetoGastos from './components/TetoGastos';
import AICoach from './components/AICoach';
import OnboardingTutorial from './components/OnboardingTutorial';
import { useSupabase } from './lib/useSupabase';
import { getOrCreateHousehold, getHousehold, loadFinanceItems, saveFinanceItem, deleteFinanceItem, addPartialExpense, deletePartialExpense, updateHouseholdPlan } from './lib/db';
import { processInviteFromUrl } from './lib/invites';
import InvitePartner from './components/InvitePartner';
import CoachDashboard from './components/CoachDashboard';
import ClientSettings from './components/ClientSettings';
import SubscriptionGate from './components/SubscriptionGate';

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
  const db = useSupabase();
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [clerkTimeout, setClerkTimeout] = useState(false);
  const [showTutorial, setShowTutorial] = useState<boolean>(() => {
    return localStorage.getItem('tutorial_completed') !== 'true';
  });
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [dbLoading, setDbLoading] = useState(false);
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [coachViewHouseholdId, setCoachViewHouseholdId] = useState<string | null>(null);
  const [coachViewClientName, setCoachViewClientName] = useState<string>('');
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [showSubscriptionGate, setShowSubscriptionGate] = useState(false);
  const itemIdMapRef = useRef<Record<string, string>>({}); // localId -> dbId

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
  const [activeTab, setActiveTab] = useState<'plan' | 'teto'>('plan');
  const [mobileMonthIdx, setMobileMonthIdx] = useState(0);

  const [startMonth, setStartMonth] = useState<number>(() => new Date().getMonth());
  const [startYear, setStartYear] = useState<number>(() => new Date().getFullYear());

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

        const [household, dbItems] = await Promise.all([
          getHousehold(db!, hId),
          loadFinanceItems(db!, hId),
        ]);

        if (household?.start_month != null) setStartMonth(household.start_month);
        if (household?.start_year != null) setStartYear(household.start_year);

        // Verifica status da assinatura
        const status = household?.subscription_status ?? null;
        setSubscriptionStatus(status);

        // Checa se o acesso do coach expirou e não tem assinatura
        const coachAccessData = await db!.from('coach_access')
          .select('expires_at')
          .eq('household_id', hId)
          .eq('status', 'approved')
          .maybeSingle();
        const coachExpired = coachAccessData?.data?.expires_at
          ? new Date(coachAccessData.data.expires_at) < new Date()
          : false;

        if (coachExpired && status !== 'active') {
          setShowSubscriptionGate(true);
        }

        if (dbItems.length > 0) {
          setItems(dbItems);
        }
      } catch (e) {
        console.error('Erro ao carregar dados:', e);
      } finally {
        setDbLoading(false);
      }
    }

    loadData();
  }, [db, user]);

  // Quando coach entra no painel de um cliente, carrega os dados daquele household
  useEffect(() => {
    if (!db || !coachViewHouseholdId) return;

    async function loadClientData() {
      setDbLoading(true);
      try {
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

  // Salva item no Supabase sempre que items mudar (debounced)
  const saveTimeoutRef = useRef<any>(null);
  useEffect(() => {
    if (!db || !householdId || dbLoading) return;

    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const dbId = await saveFinanceItem(db!, householdId, item, i);
          if (dbId !== item.id) {
            itemIdMapRef.current[item.id] = dbId;
          }
        }
      } catch (e) {
        console.error('Erro ao salvar dados:', e);
      }
    }, 1500);
  }, [items, db, householdId]);

  // Salva mês/ano de início no Supabase
  useEffect(() => {
    if (!db || !householdId) return;
    updateHouseholdPlan(db, householdId, startMonth, startYear);
  }, [startMonth, startYear, db, householdId]);


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
    setShowProjectionModal(false);
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
    setItems(prev => prev.filter(item => item.id !== id));
    if (db) {
      const dbId = itemIdMapRef.current[id] ?? id;
      deleteFinanceItem(db, dbId).catch(console.error);
    }
  };

  const handleUpdateCardConfig = (id: string, field: 'closingDay' | 'dueDay', value: number) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  const handleAddPartial = (itemId: string, expense: PartialExpense, overrideYear?: number, overrideMonth?: number) => {
    const item = items.find(i => i.id === itemId);
    let targetMonth = overrideMonth ?? currentActualMonth;
    let targetYear = overrideYear ?? currentActualYear;

    // Only apply credit card shift logic when caller doesn't specify explicit month/year
    if (overrideYear === undefined && overrideMonth === undefined && item?.linkedCardId) {
      const card = items.find(c => c.id === item.linkedCardId);
      if (card?.closingDay) {
        const todayDay = new Date().getDate();
        if (todayDay >= card.closingDay) {
          const nextDate = new Date(currentActualYear, currentActualMonth + 1, 1);
          targetMonth = nextDate.getMonth();
          targetYear = nextDate.getFullYear();
        }
      }
    }

    const monthKey = `${targetYear}-${targetMonth}`;
    setItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      const partials = item.partialExpenses || {};
      return { ...item, partialExpenses: { ...partials, [monthKey]: [...(partials[monthKey] || []), expense] } };
    }));

    if (db) {
      const dbId = itemIdMapRef.current[itemId] ?? itemId;
      addPartialExpense(db, dbId, targetYear, targetMonth, expense).catch(console.error);
    }
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
    setItems(prev => prev.map(item => item.id === itemId ? { ...item, linkedCardId: cardId || undefined, linkType: cardId ? (linkType || LinkType.RECURRING) : undefined } : item));
  };

  const monthlySummaries = useMemo((): SummaryData[] => {
    const summaries: SummaryData[] = [];
    let accumulated = 0;
    for (let m = 0; m < 12; m++) {
      const totalIncome = items.filter(i => i.category === CategoryType.INCOME).reduce((sum, i) => sum + (i.values[m] || 0), 0);
      const totalCreditCard = items.filter(i => i.category === CategoryType.CREDIT_CARD).reduce((sum, i) => sum + (i.values[m] || 0), 0);
      const totalFixed = items.filter(i => i.category === CategoryType.FIXED_EXPENSE).reduce((sum, i) => sum + (i.values[m] || 0), 0);
      const totalVariable = items.filter(i => i.category === CategoryType.VARIABLE_EXPENSE).reduce((sum, i) => sum + (i.values[m] || 0), 0);
      const totalLeisure = items.filter(i => i.category === CategoryType.PERSONAL_LEISURE).reduce((sum, i) => sum + (i.values[m] || 0), 0);
      
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
  }, [items]);

  const allCards = useMemo(() => items.filter(i => i.category === CategoryType.CREDIT_CARD), [items]);

  const projectionOptions = useMemo(() => {
    const options = [];
    const now = new Date();
    for (let i = 0; i < 24; i++) {
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
        <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center gap-6 p-8">
          <img src="/kashim-icon.png" alt="Kashim" className="w-16 h-16 rounded-2xl opacity-60" />
          <p className="text-zinc-400 text-sm text-center">Falha ao conectar. Verifique sua internet e tente novamente.</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-yellow-600 text-black font-bold rounded-xl text-sm"
          >
            Tentar novamente
          </button>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-yellow-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-yellow-600/10 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-yellow-600/5 rounded-full blur-[120px]"></div>

        <div className="max-w-md w-full relative z-10 flex flex-col items-center gap-10">
          <div className="text-center flex flex-col items-center gap-4">
            <img src="/kashim-icon.png" alt="Kashim" className="w-20 h-20 rounded-3xl shadow-2xl shadow-yellow-600/20" />
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
            className="text-zinc-500 hover:text-yellow-500 text-[10px] font-black uppercase tracking-[0.2em] transition-colors"
          >
            {authMode === 'login' ? 'Ainda não é membro? Criar conta' : 'Já possuo conta? Entrar'}
          </button>

          <div className="text-zinc-900 text-[10px] font-black uppercase tracking-[0.6em] opacity-40">Professor Digital Stets</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {showTutorial && <OnboardingTutorial onComplete={handleCompleteTutorial} />}

      {showSubscriptionGate && (
        <SubscriptionGate onClose={() => setShowSubscriptionGate(false)} />
      )}

      {showSettings && isAdmin ? (
        <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowSettings(false)}>
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-t-3xl p-6 pb-10" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mb-6"></div>
            {user && (
              <div className="flex items-center gap-3 mb-6 p-4 bg-zinc-800 rounded-2xl">
                <img src={user.imageUrl} className="w-12 h-12 rounded-full border-2 border-yellow-500/30" alt="Avatar" />
                <div>
                  <p className="text-white font-black text-sm uppercase italic">{user.firstName} {user.lastName}</p>
                  <p className="text-zinc-500 text-xs">{user.emailAddresses[0]?.emailAddress}</p>
                  <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 mt-1 inline-block">Consultor</span>
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
        />
      ) : showSettings && dbLoading ? (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowSettings(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 text-center">
            <div className="w-10 h-10 border-2 border-yellow-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-zinc-400 text-sm">Carregando perfil...</p>
          </div>
        </div>
      ) : showSettings ? (
        <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowSettings(false)}>
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-t-3xl p-6 pb-10" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mb-6"></div>
            {user && (
              <div className="flex items-center gap-3 mb-6 p-4 bg-zinc-800 rounded-2xl">
                <img src={user.imageUrl} className="w-12 h-12 rounded-full border-2 border-yellow-500/30" alt="Avatar" />
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
              <p>Você selecionou projetar a partir de <span className="text-yellow-500 font-bold uppercase">{MONTHS_BR[pendingStartMonth?.month || 0]} {pendingStartMonth?.year}</span>.</p>
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
                className="w-full bg-yellow-600 hover:bg-yellow-500 text-black font-black py-4 rounded-2xl transition-all shadow-lg uppercase text-xs tracking-widest"
              >
                Sim, Reprojetar e Baixar Backup
              </button>
              <button onClick={() => { setShowProjectionModal(false); setPendingStartMonth(null); }} className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-4 rounded-2xl transition-all uppercase text-[10px] tracking-widest">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── HEADER DESKTOP ─────────────────────────────────────────────── */}
      <header id="header" className="bg-[#0f0f0f] text-white safe-top shadow-2xl sticky top-0 z-50 border-b-2 border-yellow-600/50">

        {/* Mobile header */}
        <div className="lg:hidden flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <img src="/kashim-icon.png" alt="Kashim" className="h-8 w-8 rounded-xl" />
            <span className="text-white font-black text-sm uppercase italic tracking-tight">Kashim</span>
            {dbLoading && <i className="fas fa-circle-notch animate-spin text-yellow-500 text-xs ml-1"></i>}
          </div>
          {coachViewHouseholdId && (
            <div className="flex items-center gap-1 bg-yellow-600/10 border border-yellow-600/30 px-2 py-1 rounded-lg">
              <i className="fas fa-eye text-yellow-500 text-xs"></i>
              <span className="text-yellow-500 text-[9px] font-black uppercase truncate max-w-[80px]">{coachViewClientName}</span>
              <button onClick={() => { setCoachViewHouseholdId(null); setCoachViewClientName(''); }} className="text-zinc-500 ml-1">
                <i className="fas fa-times text-xs"></i>
              </button>
            </div>
          )}
          <div className="flex items-center gap-1">
            {!isAdmin && (
              <button onClick={() => setShowInvitePanel(p => !p)} className="w-10 h-10 flex items-center justify-center text-zinc-400 active:text-yellow-500">
                <i className="fas fa-user-plus text-base"></i>
              </button>
            )}
            {user?.imageUrl ? (
              <img src={user.imageUrl} className="w-8 h-8 rounded-full border border-zinc-700 cursor-pointer" onClick={() => setShowSettings(true)} />
            ) : (
              <button onClick={() => setShowSettings(true)} className="w-10 h-10 flex items-center justify-center text-zinc-400 active:text-yellow-500">
                <i className="fas fa-user-circle text-xl"></i>
              </button>
            )}
          </div>
        </div>

        {/* Desktop header */}
        <div className="hidden lg:flex max-w-[1600px] mx-auto px-8 py-3 flex-col lg:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <img src="/kashim-icon.png" alt="Kashim" className="h-10 w-10 rounded-xl shadow-lg" />
            {user && (
              <div className="flex items-center gap-3 border-l border-zinc-800 pl-4">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">{user.firstName || user.emailAddresses[0]?.emailAddress.split('@')[0]}</span>
              </div>
            )}
          </div>
          <div className="flex gap-2 bg-zinc-900 p-1 rounded-xl border border-zinc-800">
            <button onClick={() => setActiveTab('plan')} className={`px-6 py-2 rounded-lg text-xs font-black uppercase transition-all ${activeTab === 'plan' ? 'bg-yellow-600 text-black shadow-lg shadow-yellow-600/20' : 'text-gray-400 hover:text-white'}`}>Gastos Mensais</button>
            <button id="tab-gastos-frequentes" onClick={() => setActiveTab('teto')} className={`px-6 py-2 rounded-lg text-xs font-black uppercase transition-all ${activeTab === 'teto' ? 'bg-yellow-600 text-black shadow-lg shadow-yellow-600/20' : 'text-gray-400 hover:text-white'}`}>Gastos Frequentes</button>
            {coachViewHouseholdId && (
              <div className="flex items-center gap-2 bg-yellow-600/10 border border-yellow-600/30 px-3 py-1.5 rounded-xl">
                <i className="fas fa-eye text-yellow-500 text-xs"></i>
                <span className="text-yellow-500 text-[10px] font-black uppercase">{coachViewClientName}</span>
                <button onClick={() => { setCoachViewHouseholdId(null); setCoachViewClientName(''); }} className="text-zinc-500 hover:text-white ml-1 transition-colors">
                  <i className="fas fa-times text-xs"></i>
                </button>
              </div>
            )}
            {dbLoading && <div className="px-3 py-2 text-yellow-500"><i className="fas fa-circle-notch animate-spin text-xs"></i></div>}
            {!isAdmin && (
              <button onClick={() => setShowInvitePanel(p => !p)} className="px-3 py-2 text-zinc-500 hover:text-yellow-500 transition-colors" title="Convidar parceiro(a)">
                <i className="fas fa-user-plus"></i>
              </button>
            )}
            {!isAdmin && (
              <button onClick={() => setShowSettings(true)} className="px-3 py-2 text-zinc-500 hover:text-yellow-500 transition-colors" title="Configurações">
                <i className="fas fa-cog"></i>
              </button>
            )}
            <button onClick={() => signOut()} className="px-3 py-2 text-zinc-600 hover:text-red-500 transition-colors"><i className="fas fa-sign-out-alt"></i></button>
          </div>
        </div>
      </header>

      {/* ── MOBILE MONTH NAVIGATOR ────────────────────────────────── */}
      {activeTab === 'plan' && (
        <div className="lg:hidden sticky top-[57px] z-40 bg-zinc-900/95 backdrop-blur-sm border-b border-zinc-800">
          <div className="flex items-center justify-between px-2 py-2">
            <button onClick={() => setMobileMonthIdx(i => Math.max(0, i - 1))} disabled={mobileMonthIdx === 0} className="w-11 h-11 flex items-center justify-center text-zinc-400 disabled:opacity-20 active:text-yellow-500 rounded-xl active:bg-zinc-800">
              <i className="fas fa-chevron-left text-base"></i>
            </button>
            <div className="text-center">
              <div className="text-white font-black uppercase italic tracking-tight text-base">{months[mobileMonthIdx].monthName} {months[mobileMonthIdx].year}</div>
              {mobileMonthIdx === 0 && <div className="text-yellow-500 text-[9px] font-black uppercase tracking-widest -mt-0.5">Mês atual</div>}
            </div>
            <button onClick={() => setMobileMonthIdx(i => Math.min(11, i + 1))} disabled={mobileMonthIdx === 11} className="w-11 h-11 flex items-center justify-center text-zinc-400 disabled:opacity-20 active:text-yellow-500 rounded-xl active:bg-zinc-800">
              <i className="fas fa-chevron-right text-base"></i>
            </button>
          </div>
          {/* Month dots indicator */}
          <div className="flex justify-center gap-1 pb-2">
            {months.map((_, i) => (
              <button key={i} onClick={() => setMobileMonthIdx(i)} className={`rounded-full transition-all ${i === mobileMonthIdx ? 'w-4 h-1.5 bg-yellow-500' : 'w-1.5 h-1.5 bg-zinc-700'}`} />
            ))}
          </div>
        </div>
      )}

      <main className={`${activeTab === 'plan' ? 'max-w-[1600px]' : 'w-full px-2'} mx-auto px-2 lg:px-8 mt-2 lg:mt-8`}>
        {activeTab === 'plan' ? (
          <>
            <div id="stets"><AICoach summary={monthlySummaries[mobileMonthIdx]} items={items} monthName={months[mobileMonthIdx].monthName} onAddPartial={handleAddPartial} /></div>
            <div id="diagnosis" className="hidden lg:block"><Diagnosis summary={monthlySummaries[0]} monthName={months[0].monthName} /></div>

            {/* ── MOBILE SUMMARY CARDS ──────────────────────────────── */}
            <div className="lg:hidden grid grid-cols-2 gap-3 px-1 mb-4">
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                <div className="text-[9px] font-black uppercase text-zinc-500 tracking-widest mb-1">Entradas</div>
                <div className="text-green-400 font-black font-mono text-base">{formatCurrency(monthlySummaries[mobileMonthIdx].totalIncome)}</div>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                <div className="text-[9px] font-black uppercase text-zinc-500 tracking-widest mb-1">Gastos</div>
                <div className="text-red-400 font-black font-mono text-base">{formatCurrency(monthlySummaries[mobileMonthIdx].totalCost)}</div>
              </div>
              <div className={`border rounded-2xl p-4 ${monthlySummaries[mobileMonthIdx].balance >= 0 ? 'bg-green-900/20 border-green-800/40' : 'bg-red-900/20 border-red-800/40'}`}>
                <div className="text-[9px] font-black uppercase text-zinc-500 tracking-widest mb-1">Sobra / Falta</div>
                <div className={`font-black font-mono text-base ${monthlySummaries[mobileMonthIdx].balance >= 0 ? 'text-green-400' : 'text-red-400 animate-pulse'}`}>{formatCurrency(monthlySummaries[mobileMonthIdx].balance)}</div>
              </div>
              <div className="bg-yellow-500/10 border border-yellow-600/30 rounded-2xl p-4">
                <div className="text-[9px] font-black uppercase text-yellow-600 tracking-widest mb-1">Acumulado Rico</div>
                <div className="text-yellow-500 font-black font-mono text-base">{formatCurrency(monthlySummaries[mobileMonthIdx].accumulated)}</div>
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
                />
              ))}
            </div>

            <div id="summary-section" className="hidden lg:block bg-zinc-900 border border-yellow-600/30 rounded-[40px] p-8 mt-12 mb-8 shadow-2xl overflow-hidden">
              <h3 className="text-yellow-500 font-black text-xl uppercase italic tracking-tighter mb-8 flex items-center gap-3"><i className="fas fa-vault"></i> Bússola do Enriquecimento</h3>
              <div className="overflow-x-auto pb-4">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-zinc-500 font-black uppercase text-[10px] tracking-widest border-b border-zinc-800">
                      <th className="p-4 bg-zinc-950/50 rounded-tl-2xl">Mês / Ano</th>
                      {months.map((m, i) => (
                        <th key={i} className={`p-4 text-center ${i === 0 ? 'text-yellow-500 bg-yellow-500/5 font-black' : 'font-bold'}`}>
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
                        <td key={i} className={`p-4 text-center font-black font-mono ${s.balance >= 0 ? 'text-green-400' : 'text-red-500 animate-pulse'}`}>
                          {formatCurrency(s.balance)}
                        </td>
                      ))}
                    </tr>
                    <tr className="bg-yellow-600/5">
                      <td className="p-6 font-black text-yellow-500 uppercase italic text-base">ACUMULADO RICO</td>
                      {monthlySummaries.map((s, i) => <td key={i} className="p-6 text-center font-black font-mono text-lg text-yellow-500 drop-shadow-lg">{formatCurrency(s.accumulated)}</td>)}
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
                  <p className="text-sm font-bold text-zinc-800">Seu plano atual inicia em <span className="text-yellow-600 uppercase italic">{months[0].monthName} {months[0].year}</span></p>
                </div>
              </div>
              <div className="flex items-center gap-3 w-full md:w-auto">
                <select 
                  className="bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-xs font-black uppercase text-zinc-700 outline-none focus:border-yellow-500 transition-all"
                  value={`${startMonth}-${startYear}`}
                  onChange={(e) => {
                    const [m, y] = e.target.value.split('-').map(Number);
                    setPendingStartMonth({ month: m, year: y });
                    setShowProjectionModal(true);
                  }}
                >
                  {projectionOptions.map((opt, i) => <option key={i} value={`${opt.month}-${opt.year}`}>{opt.label}</option>)}
                </select>
                <button 
                  onClick={() => setShowProjectionModal(true)} 
                  className="bg-zinc-900 hover:bg-black text-yellow-500 text-[10px] font-black px-6 py-3.5 rounded-xl uppercase transition-all shadow-lg whitespace-nowrap"
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
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0f0f0f] border-t border-zinc-800 safe-bottom">
        <div className="flex">
          <button
            onClick={() => setActiveTab('plan')}
            className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-colors active:scale-95 ${activeTab === 'plan' ? 'text-yellow-500' : 'text-zinc-500'}`}
          >
            <i className={`fas fa-chart-bar text-xl ${activeTab === 'plan' ? 'text-yellow-500' : ''}`}></i>
            <span className="text-[9px] font-black uppercase tracking-wide">Plano</span>
            {activeTab === 'plan' && <span className="absolute bottom-0 w-8 h-0.5 bg-yellow-500 rounded-full mb-1"></span>}
          </button>

          <button
            onClick={() => setActiveTab('teto')}
            className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-colors active:scale-95 ${activeTab === 'teto' ? 'text-yellow-500' : 'text-zinc-500'}`}
          >
            <i className={`fas fa-wallet text-xl ${activeTab === 'teto' ? 'text-yellow-500' : ''}`}></i>
            <span className="text-[9px] font-black uppercase tracking-wide">Gastos</span>
            {activeTab === 'teto' && <span className="absolute bottom-0 w-8 h-0.5 bg-yellow-500 rounded-full mb-1"></span>}
          </button>

          {!isAdmin && (
            <button
              onClick={() => setShowSettings(true)}
              className="flex-1 flex flex-col items-center justify-center py-3 gap-1 text-zinc-500 transition-colors active:scale-95"
            >
              <i className="fas fa-user-circle text-xl"></i>
              <span className="text-[9px] font-black uppercase tracking-wide">Perfil</span>
            </button>
          )}

          {isAdmin && (
            <button
              onClick={() => setShowSettings(true)}
              className="flex-1 flex flex-col items-center justify-center py-3 gap-1 text-zinc-500 transition-colors active:scale-95"
            >
              <i className="fas fa-user-circle text-xl"></i>
              <span className="text-[9px] font-black uppercase tracking-wide">Perfil</span>
            </button>
          )}
        </div>
      </nav>

      {/* Spacer so bottom tab bar doesn't cover content on mobile */}
      <div className="lg:hidden h-20"></div>
    </div>
  );
};

export default App;
