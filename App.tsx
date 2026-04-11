
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useUser, useClerk, SignIn, SignUp } from '@clerk/clerk-react';
import { CategoryType, FinanceItem, SummaryData, LinkType, PartialExpense } from './types';
import { getNext12Months, formatCurrency, MONTHS_BR } from './constants';
import BlockSection from './components/BlockSection';
import Diagnosis from './components/Diagnosis';
import TetoGastos from './components/TetoGastos';
import AICoach from './components/AICoach';
import OnboardingTutorial from './components/OnboardingTutorial';
import { useSupabase } from './lib/useSupabase';
import { getOrCreateHousehold, loadFinanceItems, saveFinanceItem, deleteFinanceItem, addPartialExpense, deletePartialExpense, updateHouseholdPlan } from './lib/db';
import { processInviteFromUrl } from './lib/invites';
import InvitePartner from './components/InvitePartner';
import CoachDashboard from './components/CoachDashboard';
import ClientSettings from './components/ClientSettings';

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
  const db = useSupabase();
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [showTutorial, setShowTutorial] = useState<boolean>(() => {
    return localStorage.getItem('tutorial_completed') !== 'true';
  });
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [dbLoading, setDbLoading] = useState(false);
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [coachViewHouseholdId, setCoachViewHouseholdId] = useState<string | null>(null);
  const [coachViewClientName, setCoachViewClientName] = useState<string>('');
  const itemIdMapRef = useRef<Record<string, string>>({}); // localId -> dbId

  const isAdmin = user ? ADMIN_IDS.includes(user.id) : false;

  const [showProjectionModal, setShowProjectionModal] = useState(false);
  const [pendingStartMonth, setPendingStartMonth] = useState<{month: number, year: number} | null>(null);
  const [formData, setFormData] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [activeTab, setActiveTab] = useState<'plan' | 'teto'>('plan');

  const [startMonth, setStartMonth] = useState<number>(() => {
    const saved = localStorage.getItem('finance_start_month');
    return saved ? parseInt(saved) : new Date().getMonth();
  });
  const [startYear, setStartYear] = useState<number>(() => {
    const saved = localStorage.getItem('finance_start_year');
    return saved ? parseInt(saved) : new Date().getFullYear();
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
  
  const [items, setItems] = useState<FinanceItem[]>(() => {
    const saved = localStorage.getItem('finance_data');
    if (saved) return JSON.parse(saved);

    return DEFAULT_FIXED_EXPENSES.map((desc, idx) => ({
      id: `default-fixed-${idx}`,
      description: desc,
      category: CategoryType.FIXED_EXPENSE,
      values: new Array(12).fill(0),
      paidStatus: new Array(12).fill(false)
    }));
  });

  // Carrega dados do Supabase quando o cliente estiver pronto
  useEffect(() => {
    if (!db || !user) return;

    async function loadData() {
      setDbLoading(true);
      try {
        // Processa convite da URL antes de criar/buscar household
        const inviteHouseholdId = await processInviteFromUrl(db!, user!.id);
        const hId = inviteHouseholdId ?? await getOrCreateHousehold(db!, user!.id);
        setHouseholdId(hId);

        const dbItems = await loadFinanceItems(db!, hId);
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

  // Fallback: salva no localStorage também (redundância)
  useEffect(() => { localStorage.setItem('finance_data', JSON.stringify(items)); }, [items]);
  useEffect(() => { localStorage.setItem('finance_start_month', startMonth.toString()); }, [startMonth]);
  useEffect(() => { localStorage.setItem('finance_start_year', startYear.toString()); }, [startYear]);

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
      id: Math.random().toString(36).substr(2, 9),
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

  const handleAddPartial = (itemId: string, expense: PartialExpense) => {
    const item = items.find(i => i.id === itemId);
    let targetMonth = currentActualMonth;
    let targetYear = currentActualYear;

    if (item?.linkedCardId) {
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

  // Coach vendo painel de um cliente específico
  if (isSignedIn && isAdmin && coachViewHouseholdId) {
    // Carrega o household do cliente selecionado
    // (reutiliza o mesmo painel mas com householdId diferente)
  }

  // Coach/assistente sem cliente selecionado → Dashboard
  if (isLoaded && isSignedIn && isAdmin && !coachViewHouseholdId) {
    return (
      <CoachDashboard
        onEnterClient={(hId, name) => {
          setCoachViewHouseholdId(hId);
          setCoachViewClientName(name);
        }}
      />
    );
  }

  if (!isLoaded) {
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
          <div className="text-center">
            <h1 className="text-6xl font-black italic bg-clip-text text-transparent bg-gradient-to-b from-yellow-100 to-yellow-600 uppercase tracking-tighter leading-none mb-4 drop-shadow-2xl">
              RICO nessa vida
            </h1>
            <p className="text-zinc-400 text-xs font-bold uppercase tracking-[0.2em] leading-relaxed">
              A forma mais simples de se manter organizado financeiramente.
            </p>
          </div>

          {authMode === 'login' ? (
            <SignIn routing="hash" />
          ) : (
            <SignUp routing="hash" />
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
    <div className="min-h-screen pb-20 bg-gray-50 text-gray-900">
      {showTutorial && <OnboardingTutorial onComplete={handleCompleteTutorial} />}

      {showSettings && db && householdId && (
        <ClientSettings
          db={db}
          householdId={householdId}
          onClose={() => setShowSettings(false)}
        />
      )}

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

      <header id="header" className="bg-[#0f0f0f] text-white py-4 px-8 shadow-2xl mb-8 sticky top-0 z-50 border-b-2 border-yellow-600/50">
        <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <span className="text-3xl font-black italic bg-clip-text text-transparent bg-gradient-to-b from-yellow-200 to-yellow-700 uppercase tracking-tighter">RICO nessa vida</span>
            {user && (
              <div className="hidden md:flex items-center gap-3 border-l border-zinc-800 pl-6">
                <img src={user.imageUrl} className="w-8 h-8 rounded-full border border-yellow-500/30 shadow-lg" alt="Avatar" />
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Bem-vindo, {user.firstName || user.emailAddresses[0]?.emailAddress.split('@')[0]}</span>
              </div>
            )}
          </div>
          <div className="flex gap-2 bg-zinc-900 p-1 rounded-xl border border-zinc-800">
            <button onClick={() => setActiveTab('plan')} className={`px-6 py-2 rounded-lg text-xs font-black uppercase transition-all ${activeTab === 'plan' ? 'bg-yellow-600 text-black shadow-lg shadow-yellow-600/20' : 'text-gray-400 hover:text-white'}`}>12 Meses</button>
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
            {dbLoading && (
              <div className="px-3 py-2 text-yellow-500" title="Sincronizando...">
                <i className="fas fa-circle-notch animate-spin text-xs"></i>
              </div>
            )}
            {!isAdmin && (
              <button
                onClick={() => setShowInvitePanel(p => !p)}
                className="px-3 py-2 text-zinc-500 hover:text-yellow-500 transition-colors"
                title="Convidar parceiro(a)"
              >
                <i className="fas fa-user-plus"></i>
              </button>
            )}
            {!isAdmin && (
              <button
                onClick={() => setShowSettings(true)}
                className="px-3 py-2 text-zinc-500 hover:text-yellow-500 transition-colors"
                title="Configurações"
              >
                <i className="fas fa-cog"></i>
              </button>
            )}
            <button onClick={() => signOut()} className="px-3 py-2 text-zinc-600 hover:text-red-500 transition-colors"><i className="fas fa-sign-out-alt"></i></button>
          </div>
        </div>
      </header>

      <main className={`${activeTab === 'plan' ? 'max-w-[1600px]' : 'w-full px-2'} mx-auto px-4 md:px-8`}>
        {activeTab === 'plan' ? (
          <>
            <div id="stets"><AICoach summary={monthlySummaries[0]} items={items} monthName={months[0].monthName} onAddPartial={handleAddPartial} /></div>
            <div id="diagnosis"><Diagnosis summary={monthlySummaries[0]} monthName={months[0].monthName} /></div>

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
                  onAddItem={handleAddItem} onUpdateValue={handleUpdateValue} onTogglePaid={handleTogglePaid} 
                  onRemoveItem={handleRemoveItem} onUpdateDescription={handleUpdateDescription} 
                  onReplicateValue={handleReplicateValue} onLinkCard={handleLinkCard}
                  onUpdateCardConfig={handleUpdateCardConfig}
                />
              ))}
            </div>

            <div id="summary-section" className="bg-zinc-900 border border-yellow-600/30 rounded-[40px] p-8 mt-12 mb-8 shadow-2xl overflow-hidden">
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
          <TetoGastos items={items} currentMonthIdx={currentActualMonth} currentYear={currentActualYear} onAddPartial={handleAddPartial} onRemovePartial={handleRemovePartial} />
        )}
      </main>
    </div>
  );
};

export default App;
