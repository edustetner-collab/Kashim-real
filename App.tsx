
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useUser, useClerk, useSignIn, useAuth, SignIn, SignUp, useReverification } from '@clerk/clerk-react';
import { CategoryType, FinanceItem, SummaryData, LinkType, PartialExpense, Goal } from './types';
import { getNext12Months, formatCurrency, MONTHS_BR } from './constants';
import BlockSection from './components/BlockSection';
import ConviteConectarBanco from './components/ConviteConectarBanco';
import ExpenseSheet, { DetectedExpense } from './components/ExpenseSheet';
import Diagnosis from './components/Diagnosis';
import TetoGastos from './components/TetoGastos';
import AICoach from './components/AICoach';
import StetsConvite from './components/StetsConvite';
import { useCapturaGasto } from './lib/useCapturaGasto';
import OnboardingManager from './components/onboarding/OnboardingManager';
import { useSupabase } from './lib/useSupabase';
import { getOrCreateHousehold, getHousehold, loadFinanceItems, loadFinanceItemsForCoach, saveFinanceItem, deleteFinanceItem, addPartialExpense, deletePartialExpense, renomearPartialExpense, loadGoals, loadTetoColumns, saveSnapshot } from './lib/db';
import { processInviteFromUrl, captureInviteFromUrl, hasPendingInvite, confirmMergeInvite, discardPendingInvite } from './lib/invites';

// Captura o token de convite (?invite=...) ANTES de qualquer render/redirect do
// Clerk. Fica em localStorage e sobrevive ao cadastro do cônjuge — ver
// lib/invites.ts. Roda no import do módulo (o mais cedo possível).
captureInviteFromUrl();
import InvitePartner from './components/InvitePartner';
import CoachDashboard from './components/CoachDashboard';
import StaffTwoFactorGate from './components/StaffTwoFactorGate';
import ClientSettings from './components/ClientSettings';
import SubscriptionGate from './components/SubscriptionGate';
import OnboardingWizard, { WizardResult } from './components/OnboardingWizard';
import Desempenho from './components/Desempenho';
import Metas from './components/Metas';
import Dividas from './components/Dividas';
import MondayQuote from './components/MondayQuote';
import AmbientBackground from './components/AmbientBackground';
import MoneyCountUp from './components/MoneyCountUp';
import { fireConfetti } from './lib/confetti';
import { useTilt } from './lib/useTilt';
import { computeAccess, AccessInfo } from './lib/access';
import { buildRaioXHtml, openRaioXWindow, RaioXSnapshot } from './lib/raioX';
import { Quote, getQuoteForUser, getMondayKey } from './lib/quotes';
import { refreshNotifications, scheduleTestNotification } from './lib/notifications';
import { initPush, pedirPermissaoPush, diagnosticoPush } from './lib/push';
import { PushNotifications } from '@capacitor/push-notifications';
import { getNotifPrefs } from './lib/notifPrefs';
import TermsGate from './components/TermsGate';
import { hasAcceptedTerms, recordTermsAcceptance } from './lib/terms';
import ExtratoBancario from './components/ExtratoBancario';
import CategorizePopup from './components/CategorizePopup';
import Suporte from './components/Suporte';
import SuporteAdmin from './components/SuporteAdmin';
import FechamentoMes from './components/FechamentoMes';
import { montarFechamento, aplicarFechamento, contarAcumulo, monthKeyOf, DecisaoFechamento } from './lib/fechamentoMes';
import { hasOpenFinanceAccess } from './lib/ofAccess';
import CoachChat from './components/CoachChat';
import { fillVariableValuesFromPartials } from './lib/fillFromPartials';
import { getSourceInfo } from './lib/paymentSource';

const ADMIN_IDS =(import.meta.env.VITE_ADMIN_USER_IDS ?? '').split(',').map((s: string) => s.trim()).filter(Boolean);
const isNativeApp = !!(window as any).Capacitor?.isNativePlatform?.();
// Fallback CSS p/ esconder login social no nativo (ver regra .native-app no index.html)
if (isNativeApp) document.documentElement.classList.add('native-app');
// A classe `native-ios` deixou de ser usada em 2026-09-09: quem reserva o
// espaco do notch e o nosso CSS, sempre. Ver o comentario em index.html.

const DEFAULT_FIXED_EXPENSES = [
  'Moradia', 'Condominio', 'Telefone fixo', 'Internet', 'Celular',
  'Compras mercado (média mensal)', 'Gás', 'Luz', 'Água', 'Convênio',
  'Gasolina/uber (media mensal)', 'Iptu (mensal)', 'Educação',
  'Unha e sobrancelha', 'Academia', 'Cabelo', 'Estética', 'Dízimo',
  'Diarista', 'Comida pet', 'Banho pet', 'Personal', 'Netflix', 'Spotify',
  'Emprestimo (parcela mensal)', 'Previdência', 'Parcela seguro carro',
  'Parcela de carro', 'Terapia', 'Emprestimo'
];

// Conjunto de itens em branco de um plano novo. Usado no boot e — crítico —
// ao entrar num cliente SEM dados, para nunca herdar os itens do cliente
// anterior (isolamento entre contas).
function makeDefaultItems(): FinanceItem[] {
  return DEFAULT_FIXED_EXPENSES.map((desc) => ({
    // UUID real (não "default-fixed-N"): força o caminho de UPSERT no banco, que
    // atualiza sempre a MESMA linha. Com ID local o app fazia INSERT e, sob
    // salvamentos concorrentes (rede lenta), criava a mesma conta várias vezes
    // → itens duplicados/triplicados (2026-07-11).
    id: crypto.randomUUID(),
    description: desc,
    category: CategoryType.FIXED_EXPENSE,
    values: new Array(12).fill(0),
    paidStatus: new Array(12).fill(false),
  }));
}

// Remove APENAS cópias 100% idênticas (mesmo nome, categoria, valores, status e
// lançamentos) — as que a corrida de salvamento gerava. NUNCA junta itens que
// diferem em qualquer coisa: dois lazeres "Lazer e Despesas Pessoais" com
// compras diferentes são coisas distintas e ambos são preservados.
// (Versão anterior agrupava só por nome+categoria e apagou dados legítimos.)
function dedupeItems(dbItems: FinanceItem[]): { deduped: FinanceItem[]; toDelete: string[] } {
  const signature = (i: FinanceItem) =>
    JSON.stringify({
      d: i.description,
      c: i.category,
      v: i.values,
      p: i.paidStatus,
      pe: i.partialExpenses ?? {},
      lc: i.linkedCardId ?? null,
    });

  const seen = new Set<string>();
  const deduped: FinanceItem[] = [];
  const toDelete: string[] = [];
  for (const item of dbItems) {
    if (!item.description.trim()) { deduped.push(item); continue; }
    const sig = signature(item);
    if (seen.has(sig)) {
      toDelete.push(item.id); // cópia byte-a-byte → segura de remover
    } else {
      seen.add(sig);
      deduped.push(item);
    }
  }
  return { deduped, toDelete };
}

const TOMBSTONE_KEY = 'kashim_deleted_items';
function getTombstones(): Set<string> {
  try {
    const raw = localStorage.getItem(TOMBSTONE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}
function addTombstone(...ids: string[]): void {
  try {
    const existing = getTombstones();
    for (const id of ids) if (id) existing.add(id);
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(Array.from(existing)));
  } catch {}
}

// Assinatura dos campos que a linha de finance_items realmente persiste (espelha
// financeItemToRow + sort_order). Usada para gravar SÓ os itens que mudaram de
// fato — crítico no Modo Casal: se o cliente reescrevesse a lista inteira a cada
// alteração, a gravação de um membro sobrescreveria a edição simultânea do outro
// em itens que ele nem tocou (partial_expenses NÃO entram aqui — são salvos por
// caminho próprio, append-only).
function itemPersistHash(item: FinanceItem, sortOrder: number): string {
  return JSON.stringify({
    d: item.description,
    c: item.category,
    v: item.values,
    p: item.paidStatus,
    lc: item.linkedCardId ?? null,
    lt: item.linkType ?? null,
    cd: item.closingDay ?? null,
    dd: item.dueDay ?? null,
    so: sortOrder,
  });
}
function seedItemHashes(items: FinanceItem[]): Record<string, string> {
  const h: Record<string, string> = {};
  items.forEach((it, i) => { h[it.id] = itemPersistHash(it, i); });
  return h;
}

/** Os 12 meses do plano a partir do mês inicial REAL, sem depender do estado. */
function janelaDeMeses(startMonth: number, startYear: number): Array<{ year: number; index: number }> {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(startYear, startMonth + i, 1);
    return { index: d.getMonth(), year: d.getFullYear() };
  });
}

/** "há 3 h" — saldo do banco é sempre da última leitura, nunca tempo real. */
function tempoDesde(iso: string | null): string {
  if (!iso) return '';
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 2) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

const App: React.FC = () => {
  const { isSignedIn, user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const deleteUserAccount = useReverification(async () => { await user?.delete(); });
  const { signIn, setActive: setSignInActive } = useSignIn();
  const { getToken } = useAuth();
  const db = useSupabase();
  // Cônjuge que chega pelo link de convite quase sempre NÃO tem conta ainda —
  // abre direto na tela de cadastro em vez da de login (antes ele caía no login
  // e precisava "descobrir" que tinha que criar conta). Mesma lógica para quem
  // chega da landing page de vendas (/vendas) via ?signup=1 ou ?cadastro=1.
  const wantsSignup = (() => {
    try {
      const p = new URLSearchParams(window.location.search);
      return p.get('signup') === '1' || p.get('cadastro') === '1';
    } catch { return false; }
  })();
  const [authMode, setAuthMode] = useState<'login' | 'register'>(
    hasPendingInvite() || wantsSignup ? 'register' : 'login'
  );
  const [clerkTimeout, setClerkTimeout] = useState(false);
  const isNativeApp = !!(window as any).Capacitor?.isNativePlatform?.();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [currentWeekQuote, setCurrentWeekQuote] = useState<Quote | null>(null);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [dbLoading, setDbLoading] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeAuthToken, setMergeAuthToken] = useState<string | null>(null);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSuporte, setShowSuporte] = useState(false);
  const [showSuporteAdmin, setShowSuporteAdmin] = useState(false);
  /** Contagem para o sino do admin. Só pede a contagem, não a lista. */
  const [chamadosAbertos, setChamadosAbertos] = useState(0);
  const [coachViewHouseholdId, setCoachViewHouseholdId] = useState<string | null>(null);
  const [coachViewClientName, setCoachViewClientName] = useState<string>('');
  // Registros da consultoria (raio-X imutável) do cliente em visão de coach
  const [consultRecords, setConsultRecords] = useState<Array<{ id: string; created_at: string; content_hash: string; email_sent_to: string | null; snapshot: RaioXSnapshot }> | null>(null);
  const [showRecordsModal, setShowRecordsModal] = useState(false);
  const [registeringConsult, setRegisteringConsult] = useState(false);
  // Vínculo com o sistema de agendamentos: null=carregando, false=sem vínculo, objeto=vinculado
  const [agendLink, setAgendLink] = useState<{ id: string; name: string } | false | null>(null);
  const [agendAllClients, setAgendAllClients] = useState<{ id: string; name: string; phoneDigits: string; startMonthYear: string }[]>([]);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');
  const [savingLink, setSavingLink] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [showSubscriptionGate, setShowSubscriptionGate] = useState(false);
  const [accessInfo, setAccessInfo] = useState<AccessInfo | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  // null = ainda verificando ou indeterminado (falha de rede) → não bloqueia
  const [termsAccepted, setTermsAccepted] = useState<boolean | null>(null);
  const itemIdMapRef = useRef<Record<string, string>>({}); // localId -> dbId
  // Hash dos campos já persistidos por item (id -> hash). Semeado ao carregar do
  // banco; o loop de gravação pula itens cujo hash não mudou. Ver itemPersistHash.
  const savedItemHashRef = useRef<Record<string, string>>({});
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
  // `ofTx` viaja junto quando o lançamento nasceu de uma transação do Open
  // Finance: é ele que permite marcar a transação como categorizada e alimentar
  // a memória do estabelecimento depois que o ExpenseSheet confirma.
  const [pendingExpense, setPendingExpense] = useState<
    (DetectedExpense & {
      source: 'ai' | 'manual';
      ofTx?: { transactionId: string; merchantKey: string };
      knownPayMethod?: 'debit' | 'credit';
      knownCardLast4?: string | null;
      irDiretoParaLinha?: boolean;
      parcelaDoBanco?: { current: number; total: number } | null;
    }) | null
  >(null);
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

  // Checa assistentes cadastradas em admin_users. Vai pelo servidor porque a
  // tabela é a lista de quem tem poder de staff e está revogada para o cliente
  // (lock-admin-users.sql) — consultar direto rendia 42501 em toda sessão.
  useEffect(() => {
    if (!user || isAdminByEnv) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken({ template: 'supabase' });
        if (!token || cancelled) return;
        const res = await fetch('/api/check-staff', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const { isStaff } = await res.json() as { isStaff: boolean };
        if (isStaff && !cancelled) setIsAdminByDb(true);
      } catch { /* sem staff: segue como usuário comum */ }
    })();
    return () => { cancelled = true; };
  }, [user, isAdminByEnv, getToken]);

  // Se o check de admin no banco confirmar depois do gate já ter sido ativado,
  // fecha o gate imediatamente (race condition entre load e admin check).
  useEffect(() => {
    if (isAdmin && showSubscriptionGate) setShowSubscriptionGate(false);
  }, [isAdmin, showSubscriptionGate]);

  const [simulando, setSimulando] = useState(false);
  const simulandoRef = useRef(false);
  simulandoRef.current = simulando;
  const backupSimulacaoRef = useRef<{ items: FinanceItem[]; startMonth: number; startYear: number } | null>(null);
  const [aplicandoSimulacao, setAplicandoSimulacao] = useState(false);

  const [showProjectionModal, setShowProjectionModal] = useState(false);
  const [pendingStartMonth, setPendingStartMonth] = useState<{month: number, year: number} | null>(null);
  const [formData, setFormData] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [activeTab, setActiveTab] = useState<'plan' | 'teto' | 'metas' | 'desempenho' | 'dividas' | 'coach'>('plan');

  const [showExtrato, setShowExtrato] = useState(false);
  const [ofInitialCardLast4, setOfInitialCardLast4] = useState<string | undefined>(undefined);
  /** Pop-up "X transações a categorizar" — só para quem tem Open Finance. */
  const [categorizeCount, setCategorizeCount] = useState(0);
  /** Pergunta que abre o chat já digitada, vinda de um atalho contextual. */
  const [stetsPerguntaInicial, setStetsPerguntaInicial] = useState('');
  /** O que o Kashim lançou sozinho por reconhecer o comerciante. */
  const [autoCategorizadas, setAutoCategorizadas] = useState<Array<{ id: string; transactionId: string; descricao: string; valor: number; categoria: string; linha?: string }>>([]);
  /**
   * Pendentes que o app vai lançar SOZINHO quando o Extrato abrir (memória do
   * estabelecimento). Ficam fora da contagem que a pessoa vê: ela via "2
   * pendentes", abria e encontrava 1, sem explicação (Mariane, 2026-09-19).
   */
  const [pendentesAutomaticas, setPendentesAutomaticas] = useState(0);
  /**
   * Quem esta selecionado na barra de baixo.
   *
   * A folha de lancar e o Extrato sao camadas por cima da aba — se as duas
   * coisas acendem ao mesmo tempo, a barra mostra dois destaques e o cliente
   * nao sabe onde esta (Eduardo, 2026-09-20). Trocar de aba FECHA a camada.
   */
  /**
   * MIGRACAO PARA O OPEN FINANCE — recomecar o plano no mes atual.
   *
   * Cliente antigo tem plano comecando meses atras. Ao conectar o banco, as
   * faturas reais entram TAMBEM nos meses passados, que ele nunca planejou nem
   * categorizou: foi o "R$145 mil" do Michael, que estava certo e era
   * impossivel de interpretar (Eduardo, 2026-09-20).
   *
   * Reprojetar para o mes atual resolve, porque sem meses passados na janela
   * nao ha onde a fatura antiga aparecer. Mas reprojetar APAGA esses meses do
   * painel — por isso a decisao e do cliente, num toque, com o historico indo
   * para o e-mail antes.
   */
  const [ofMigracaoAberta, setOfMigracaoAberta] = useState(false);
  /** Onde o Plano estava quando um toque na linha levou para Gastos — o "voltar" devolve para lá. */
  const [voltarAoPlanoY, setVoltarAoPlanoY] = useState<number | null>(null);
  /** Evita lançar duas vezes se a recontagem rodar em paralelo. */
  const lancandoAutoRef = useRef(false);
  const [ofMigrando, setOfMigrando] = useState(false);
  /** Relevo do item selecionado na barra de baixo (o mesmo do botão central). */
  const ABA_ATIVA: React.CSSProperties = {
    background: 'linear-gradient(180deg,#c5f23a 0%,#a2d800 50%,#8cc400 100%)',
    boxShadow: '0 4px 12px rgba(130,192,0,0.4), inset 0 1px 0 rgba(255,255,255,0.45)',
  };
  /** Abre a conta aberta do "Sai da conta": de onde vem cada parte do número. */
  const [saiDaContaAberto, setSaiDaContaAberto] = useState(false);
  const [autoAvisoFechado, setAutoAvisoFechado] = useState(false);
  /**
   * O que o cliente já conferiu no resumo do lançamento automático.
   *
   * Sem guardar, o aviso voltava a cada abertura do app — o Eduardo concordou
   * quatro vezes com os mesmos dois gastos (2026-09-20). Fica no aparelho: é
   * preferência de leitura, não dado financeiro.
   */
  const [autoConferidas, setAutoConferidas] = useState<Set<string>>(new Set());
  const chaveAutoConferidas = householdId ? `kashim_auto_ok_${householdId}` : '';
  useEffect(() => {
    if (!chaveAutoConferidas) return;
    try {
      const salvo = localStorage.getItem(chaveAutoConferidas);
      setAutoConferidas(new Set(salvo ? JSON.parse(salvo) as string[] : []));
    } catch { setAutoConferidas(new Set()); }
  }, [chaveAutoConferidas]);
  const marcarConferidas = (ids: string[]) => {
    /**
     * Grava no SERVIDOR: o localStorage abaixo é só o eco imediato na tela.
     * Guardado só no aparelho, o mesmo aviso reaparecia na web depois de
     * conferido no celular (Eduardo, 2026-09-23).
     */
    const transacoes = autoCategorizadas
      .filter((t) => ids.includes(t.id) && t.transactionId)
      .map((t) => t.transactionId);
    if (transacoes.length > 0 && householdId) {
      getToken({ template: 'supabase' }).then((token) => fetch('/api/of-transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
        body: JSON.stringify({ householdId, action: 'resumo_visto', transactionIds: transacoes }),
      })).catch(() => { /* o eco local já tirou da tela */ });
    }
    setAutoConferidas(prev => {
      const proximo = new Set(prev);
      ids.forEach(id => proximo.add(id));
      if (chaveAutoConferidas) {
        try { localStorage.setItem(chaveAutoConferidas, JSON.stringify([...proximo])); } catch { /* sem localStorage, o aviso volta — não quebra nada */ }
      }
      return proximo;
    });
  };

  /**
   * Bolinha vermelha com o número no ícone do app.
   *
   * É o que faz a pessoa lembrar sozinha que há algo a fazer, sem depender de
   * abrir o app para descobrir. Some sozinha quando a fila zera.
   *
   * `setAppBadge` não existe em todo navegador (Safari desktop, Firefox) e pode
   * lançar mesmo existindo — por isso o try/catch. Quando não há suporte, não
   * acontece nada e o app segue igual.
   */
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (!nav.setAppBadge) return;
    try {
      if (categorizeCount > 0) void nav.setAppBadge(categorizeCount)?.catch(() => {});
      else void nav.clearAppBadge?.()?.catch(() => {});
    } catch { /* badge é acessório */ }
  }, [categorizeCount]);
  const [showCategorizePopup, setShowCategorizePopup] = useState(false);
  const categorizeCheckedRef = useRef(false);
  /**
   * As transações pendentes CRUAS, não só a contagem.
   *
   * É delas que sai o "a categorizar" de cada fatura. O número tem de ser o
   * somatório do que está de fato na fila — se a tela diz R$ 105, tem de haver
   * um lançamento de R$ 105 para o cliente tocar (Eduardo, 2026-09-10).
   */
  const [ofPendentes, setOfPendentes] = useState<Array<{
    connectionId: string | null; cardLast4: string | null;
    billDueDate: string | null; transactionDate: string; amount: number;
  }>>([]);
  /** Cartões de cada conexão — resolve número virtual no cartão real. */
  const [ofCartoesPorConexao, setOfCartoesPorConexao] = useState<Record<string, string[]>>({});
  /** Saldo somado das contas conectadas, como o banco informou na última leitura. */
  const [saldoNoBanco, setSaldoNoBanco] = useState<{ total: number; contas: number; lido: string | null } | null>(null);
  const [explicandoSaldo, setExplicandoSaldo] = useState(false);
  /**
   * Meses cuja fatura o banco JA PUBLICOU, por cartao ("7212" -> {"2026-08"}).
   *
   * Entre o fechamento e a publicacao, o valor da linha e estimativa e costuma
   * vir alto: entram compras que ja pertencem a fatura seguinte. Foi a Renata
   * vendo R$11.010 onde o Itau cobrava R$8.788 — e estava tudo certo, so nao
   * estava publicado (2026-09-17). Marcar isso na tela evita a mesma ligacao
   * com cada cliente novo.
   */
  const [faturasPublicadas, setFaturasPublicadas] = useState<Record<string, string[]>>({});
  /** Pop-up do diagnóstico no CELULAR (na web fica inline). */
  const [showDiagnosis, setShowDiagnosis] = useState(false);
  /** Transações do Extrato já lançadas nesta sessão — sai da lista sem recarregar. */
  const [ofCategorized, setOfCategorized] = useState<string[]>([]);
  /**
   * Existe pelo menos um banco conectado?
   *
   * Decide qual versão dos tours o usuário lê. Ter ACESSO ao Open Finance não
   * basta: quem está na lista mas ainda lança à mão precisa das instruções de
   * lançamento manual, que para ele continuam sendo as certas.
   */
  const [temBancoConectado, setTemBancoConectado] = useState(false);
  /**
   * O plano ABERTO na tela está no modo Open Finance.
   *
   * Duas condições, e as duas são obrigatórias: quem está logado tem acesso, e
   * este household tem banco conectado. Usar só o acesso de quem está logado
   * foi o que fez a linha do cartão de uma cliente sem banco aparecer como
   * "Categorizada" quando o Eduardo abriu o plano dela (2026-09-10) — e,
   * sem portão nenhum na linha, para todos os clientes também.
   */
  // Se o household já tem banco conectado, todos os membros (inclusive o cônjuge
  // no Modo Casal) enxergam o plano em modo OF. Quem pode CONECTAR um banco novo
  // ainda é controlado por `hasOpenFinanceAccess(user)` no prop `hasOpenFinance`.
  const planoEmModoOF = temBancoConectado;

  // Trocou de plano (coach abrindo cliente): o que era do plano anterior não
  // pode vazar para este enquanto a busca de conexões não volta.
  useEffect(() => {
    setTemBancoConectado(false);
    setOfCartoesPorConexao({});
    setOfPendentes([]);
  }, [householdId]);
  /** Item cujo card deve receber o foco ao abrir Gastos (vindo do Plano). */
  const [focusSpendingItemId, setFocusSpendingItemId] = useState<string | null>(null);
  /** Filtro inicial do Gastos quando o usuário navega de uma linha do Plano. */
  const [tetoInitialFilter, setTetoInitialFilter] = useState<{ linkedItemId: string; sourceKey: string } | null>(null);
  /** Mês em que o Gastos deve abrir — vem do clique no selo do Plano. */
  const [tetoInitialMonthKey, setTetoInitialMonthKey] = useState<string | null>(null);
  const [ofAuthToken, setOfAuthToken] = useState<string | null>(null);
  const [goals, setGoals] = useState<Goal[]>(() => {
    try { return JSON.parse(localStorage.getItem('kashim_goals') || '[]'); } catch { return []; }
  });
  const [mobileMonthIdx, setMobileMonthIdx] = useState(0);
  const acumTilt = useTilt(6); // decorative 3D tilt for the Acumulado hero card

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

  const [items, setItems] = useState<FinanceItem[]>(() => makeDefaultItems());

  // Carrega dados do Supabase quando o cliente estiver pronto (não roda para admins)
  useEffect(() => {
    if (!db || !user || isAdminByEnv) return;

    async function loadData() {
      setDbLoading(true);
      try {
        // Processa convite da URL antes de criar/buscar household (aceite server-side)
        const inviteAuthToken = await getToken({ template: 'supabase' });
        const inviteHouseholdId = await processInviteFromUrl(inviteAuthToken);
        if (inviteHouseholdId === 'NEEDS_MERGE') {
          // Usuário tem dados próprios e precisa confirmar a unificação antes de
          // continuar. Pausa o carregamento e mostra o modal de merge.
          setMergeAuthToken(inviteAuthToken);
          setShowMergeModal(true);
          setDbLoading(false);
          return;
        }
        if (inviteHouseholdId && user) {
          // Quem entrou via convite já está no household do parceiro — não deve
          // ver o wizard (que foi pensado para onboarding do zero).
          localStorage.setItem(`onboarding_done_${user.id}`, 'true');
        }
        const hId = inviteHouseholdId ?? await getOrCreateHousehold(inviteAuthToken);
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
        }).then(r => r.ok ? r.json() : null).catch(() => null) as {
          hasCoach: boolean;
          expired: boolean;
          coachingEndsAt?: string | null;
          isCoachClient?: boolean;
          isAdminVerified?: boolean;
        } | null;
        let hasCoach = coachAccessRes?.hasCoach ?? false;
        const coachingEndsAt = coachAccessRes?.coachingEndsAt ?? null;
        // isCoachClient: teve ou tem coach (qualquer status) → grace period estendido
        let isCoachClient = coachAccessRes?.isCoachClient ?? hasCoach;
        // Admin confirmado pelo servidor (não depende de VITE_ do frontend)
        const serverConfirmedAdmin = coachAccessRes?.isAdminVerified ?? false;
        if (serverConfirmedAdmin && !isAdminByEnv) setIsAdminByDb(true);

        // Rede/API caiu (coachAccessRes === null): NUNCA assume que a pessoa não
        // tem coach — isso mandava cliente da consultoria direto para o gate de
        // pagamento. Consulta coach_access pelo cliente Supabase (o RLS libera o
        // próprio household — é a mesma query que o ClientSettings usa para
        // mostrar "Consultor com acesso ativo").
        if (!coachAccessRes) {
          try {
            const { data: ownCoachRows } = await db!
              .from('coach_access')
              .select('status')
              .eq('household_id', hId);
            if (ownCoachRows && ownCoachRows.length > 0) {
              isCoachClient = true;
              if (ownCoachRows.some((r: any) => r.status === 'approved')) hasCoach = true;
            } else {
              // Nem a API nem o fallback responderam de forma conclusiva.
              // Trata como cliente de consultoria: dá o prazo de 5 meses em vez
              // dos 30 dias do cadastro espontâneo. ATENÇÃO: desde 2026-08-12
              // isto NÃO garante acesso — se o prazo já venceu, bloqueia. O que
              // impede falha de rede de virar bloqueio é `first_access_at`
              // ausente cair em "agora" logo abaixo, nunca em `created_at`.
              isCoachClient = true;
            }
          } catch {
            // Erro de rede não decide nada sozinho: cai no prazo de 5 meses,
            // que é generoso. Quem bloqueia é a data vencida, não a falha.
            isCoachClient = true;
          }
        }

        // Regra de acesso:
        // - Registro 'approved' em coach_access → acesso ilimitado (o coach
        //   encerra revogando o acesso, não por data — ver check-coach-access)
        // - Já foi cliente do coach (revogado) → 5 meses de grace
        // - Espontâneo → 30 dias
        // NÃO usar `&& !coachExpired` aqui: coaching_ends_at é gravado uma vez na
        // criação e nunca atualizado, então ficava no passado para todo cliente
        // antigo e derrubava o acesso de quem está com a consultoria ativa.
        // Carimba o primeiro acesso na primeira vez que o cliente abre o app.
        // É o marco que passa a valer para o grace de 5 meses.
        const firstAccessAt = (household as any)?.first_access_at ?? null;
        if (!firstAccessAt && hId) {
          const agora = new Date().toISOString();
          db!.from('households').update({ first_access_at: agora }).eq('id', hId)
            .then(() => {}, () => {}); // falha aqui não pode travar o carregamento
        }

        const access = computeAccess({
          createdAt: (household as any)?.created_at,
          firstAccessAt: firstAccessAt ?? new Date().toISOString(),
          accessUntil: (household as any)?.access_until ?? null,
          subscriptionStatus: status,
          subscriptionExpiresAt: (household as any)?.subscription_expires_at,
          hasActiveCoach: hasCoach,
          isCoachClient,
          coachingEndsAt,
        });
        setAccessInfo(access);
        // Diagnóstico de acesso — abrir o console (F12) e mandar print se o gate
        // aparecer indevidamente. Mostra exatamente o que o servidor respondeu.
        console.log('[kashim:acesso]', {
          householdId: hId,
          apiRespondeu: !!coachAccessRes,
          hasCoach,
          isCoachClient,
          coachingEndsAt,
          createdAt: (household as any)?.created_at,
          debug: (coachAccessRes as any)?.debug,
          resultado: access,
        });
        // Nunca bloqueia: admin (env OU banco OU confirmado pelo servidor neste
        // mesmo request), coach visualizando cliente, ou coach client com acesso válido.
        // Para demais usuários, bloqueia ao expirar (decisão Eduardo 16/07).
        // ATENÇÃO: usa serverConfirmedAdmin (variável local) e NÃO isAdmin (state),
        // pois setIsAdminByDb é async — isAdmin ainda é false neste ponto do loop.
        const effectiveAdmin = isAdmin || serverConfirmedAdmin;
        if (!access.hasAccess && !effectiveAdmin && !coachViewHouseholdId) {
          setShowSubscriptionGate(true);
        }

        if (dbItems.length > 0) {
          // Colapsa duplicatas (inclusive as COM valor, geradas por bugs de
          // salvamento concorrente) numa linha só por conta, e apaga as demais.
          const { deduped, toDelete } = dedupeItems(dbItems);
          if (toDelete.length > 0) {
            toDelete.forEach(id => deleteFinanceItem(db!, id).catch(() => {}));
          }
          const tombstones = getTombstones();
          const liveItems = deduped.filter(item => {
            if (tombstones.has(item.id)) {
              deleteFinanceItem(db!, item.id).catch(() => {});
              return false;
            }
            return true;
          });
          /**
           * A janela de meses vem do BANCO, não do estado.
           *
           * `months` ainda reflete o mês inicial guardado no navegador quando o
           * load roda — `setStartMonth` acima é assíncrono. Com a janela errada,
           * o preenchimento escrevia o gasto de setembro na coluna de novembro,
           * e o valor fantasma era salvo (Eduardo, 2026-09-23).
           */
          const janelaDoPlano = janelaDeMeses(loadedStartMonth, loadedStartYear);
          const fixedItems = fillVariableValuesFromPartials(liveItems, janelaDoPlano);
          savedItemHashRef.current = seedItemHashes(fixedItems);
          setItems(fixedItems);
        }

        // Libera a gravação assim que o load termina com sucesso — MESMO com o
        // banco vazio. Sem isso, usuário novo (sem linhas ainda) nunca conseguia
        // persistir o primeiro lançamento (perda de dados crítica).
        dbItemsLoadedRef.current = true;

        // Carrega metas
        loadGoals(db!, hId).then(g => {
          if (g.length > 0) { setGoals(g); localStorage.setItem('kashim_goals', JSON.stringify(g)); }
        }).catch(() => {});

        // Wizard de coleta de dados: SÓ para quem se cadastrou sozinho (sem
        // coach) e ainda não tem dados. Cliente de coach NUNCA é forçado ao
        // wizard — quem monta o plano dele é o consultor. Sem a guarda
        // `!hasCoach`, o cliente ficava preso numa tela de preencher plano que
        // o coach já preencheu (bug em produção 2026-07-11).
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

  // (A correcao de valores zerados agora acontece no load, via
  // fillVariableValuesFromPartials — ver lib/fillFromPartials.ts.)

  // Keep refs in sync with state so we can capture snapshots synchronously
  useEffect(() => { currentHouseholdIdRef.current = householdId; }, [householdId]);

  // Consentimento LGPD: clientes de link mágico nunca passam pela tela de
  // cadastro, então o aceite precisa ser pedido (e registrado) aqui.
  useEffect(() => {
    if (!db || !user || isAdmin) return;
    hasAcceptedTerms(db, user.id).then(setTermsAccepted);
  }, [db, user, isAdmin]);

  const handleAcceptTerms = async () => {
    if (!db || !user) return;
    await recordTermsAcceptance(db, user.id);
    setTermsAccepted(true);
  };

  // Só bloqueia quando temos certeza de que NÃO aceitou (false).
  // null (verificando/erro de rede) nunca tranca o usuário fora dos dados.
  const needsTermsAcceptance = termsAccepted === false && !!user && !isAdmin && !coachViewHouseholdId;

  // App nativo: (re)agenda as notificações locais (frase semanal + lembretes de
  // contas a vencer). Debounce porque `items` muda a cada edição — não faz
  // sentido martelar o bridge nativo a cada tecla. Espera o aceite dos termos:
  // o prompt de permissão do sistema não pode aparecer por cima do consentimento.
  const [notifPrefsVersion, setNotifPrefsVersion] = useState(0);
  // Gatilho de diagnóstico: abrir o app com ?testenotif=1 dispara uma
  // notificação de teste em ~12s e mostra o motivo na tela. Roda mesmo p/ admin
  // (que normalmente não agenda), para o coach testar no próprio aparelho.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('testenotif') !== '1') return;
    scheduleTestNotification().then(r => {
      alert(`Teste de notificação:\n\n${r.reason}`);
    });
  }, []);
  /**
   * `?testepush=1` — diagnóstico do push, e depois tenta registrar de verdade.
   *
   * O registro normal é silencioso dos dois lados: falha calada (nada pode
   * impedir o app de abrir) e sucesso invisível. Sem isto, `push_devices` vazia
   * não dizia se o plugin faltou, a permissão foi negada, o token não chegou ou
   * o servidor recusou.
   */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('testepush') !== '1') return;
    if (!householdId || !user || !hasOpenFinanceAccess(user)) return;
    diagnosticoPush().then(async (txt) => {
      let extra = '';
      try {
        const jwt = await getToken({ template: 'supabase' });
        // Ouvinte pronto ANTES do register: `addListener` é assíncrono e, sem
        // esperar, o token chega antes dele existir e some sem deixar rastro.
        const tok = await new Promise<string | null>((resolve) => {
          const t = setTimeout(() => resolve(null), 15000);
          void (async () => {
            await PushNotifications.addListener('registration', (x) => { clearTimeout(t); resolve(x?.value ?? null); });
            await PushNotifications.register();
          })().catch(() => { clearTimeout(t); resolve(null); });
        });
        if (jwt && tok) {
          const r = await fetch('/api/push-register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
            body: JSON.stringify({ householdId, token: tok, platform: 'ios' }),
          });
          const j = await r.json().catch(() => ({}));
          extra = `\n\nservidor: ${r.status} ${JSON.stringify(j)}`;
        }
      } catch (e) {
        extra = `\n\nservidor: falhou (${e instanceof Error ? e.message : 'erro'})`;
      }
      alert(`Diagnóstico de push:\n\n${txt}${extra}`);
    });
  }, [householdId, user, getToken]);
  useEffect(() => {
    if (!householdId || coachViewHouseholdId || needsTermsAcceptance || !user) return;
    const t = setTimeout(() => {
      refreshNotifications({ userId: user.id, householdId, items, months });
    }, 2500);
    return () => clearTimeout(t);
  }, [householdId, coachViewHouseholdId, needsTermsAcceptance, items, months, user, notifPrefsVersion]);

  /**
   * Push de servidor: liga e guarda o endereço deste aparelho.
   *
   * Fica ao lado do agendamento das notificações locais porque são coisas
   * diferentes com o mesmo destino. A local é agendada aqui e dispara sozinha; o
   * push depende de o servidor saber para onde mandar, e é esse endereço
   * (`onesignal_id`) que o `push-register` grava.
   *
   * Não pede permissão nenhuma aqui — só registra quem JÁ aceitou. O pedido tem
   * hora certa e vive em `pedirPermissaoPush()`, chamado quando o cliente
   * conecta o banco: no iOS a recusa é definitiva, e perguntar antes de o aviso
   * significar algo é o jeito mais rápido de perder o canal para sempre.
   */
  const registrarAparelho = useCallback((tokenApns: string, platform: string) => {
    (async () => {
      try {
        const jwt = await getToken({ template: 'supabase' });
        if (!jwt) return;
        await fetch('/api/push-register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
          body: JSON.stringify({ householdId, token: tokenApns, platform }),
        });
      } catch { /* push é acessório */ }
    })();
  }, [householdId, getToken]);

  useEffect(() => {
    // Push é do Open Finance: cliente comum não pode ter o aparelho registrado
    // no OneSignal por abrir o app.
    if (!householdId || coachViewHouseholdId || !user || !hasOpenFinanceAccess(user)) return;
    initPush(registrarAparelho);
  }, [householdId, coachViewHouseholdId, user, registrarAparelho]);

  /**
   * Pede o push para quem já tinha banco conectado antes do push existir.
   *
   * O pedido acontecia num único ponto: logo depois de conectar um banco, no
   * Extrato. Quem conectou antes de 2026-09-10 nunca passou por ali e nunca
   * passaria — `initPush` só reativa quem já aceitou, não pede nada. Resultado:
   * zero aparelhos registrados e nenhum push saindo, mesmo com servidor e
   * credenciais corretos.
   *
   * A hora escolhida é a fila de categorizar aparecer: chegou transação nova,
   * então "quer ser avisado quando isso acontecer?" responde a uma pergunta que
   * a pessoa acabou de ter. No iOS o "não" é definitivo, então pedir em momento
   * vazio queima o canal para sempre.
   */
  useEffect(() => {
    if (!showCategorizePopup || !householdId || coachViewHouseholdId) return;
    if (!user || !hasOpenFinanceAccess(user)) return;
    pedirPermissaoPush(registrarAparelho).catch(() => {});
  }, [showCategorizePopup, householdId, coachViewHouseholdId, user, registrarAparelho]);

  // Heartbeat: marca "mexeu no app agora" (households.last_active_at). Base do
  // futuro push de reengajamento. Não conta a visualização do coach como
  // atividade do cliente. Fire-and-forget: falha nunca atrapalha o app.
  useEffect(() => {
    if (!householdId || coachViewHouseholdId || !user) return;
    (async () => {
      try {
        const token = await getToken({ template: 'supabase' });
        if (!token) return;
        await fetch('/api/heartbeat', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch { /* acessório */ }
    })();
  }, [householdId, coachViewHouseholdId, user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!householdId) return;
    const quote = getQuoteForUser(householdId);
    setCurrentWeekQuote(quote);
    // Auto-show modal only on Mondays and if not yet seen this week
    if (new Date().getDay() !== 1) return;
    const seenKey = `kashim_quote_shown_${householdId}_${getMondayKey()}`;
    if (localStorage.getItem(seenKey)) return;
    setShowQuoteModal(true);
  }, [householdId]);
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
        // CRÍTICO p/ isolamento entre contas: zera o mapa local→DB de IDs e a
        // fila de exclusões do cliente ANTERIOR. Sem isto, os itens padrão
        // (mesmos IDs locais "default-fixed-N") do novo cliente eram mapeados
        // para as linhas do banco do cliente anterior → dados de um vazavam
        // para o outro (contaminação, 2026-07-11).
        itemIdMapRef.current = {};
        // Registros da consultoria são por cliente — zera ao trocar
        setConsultRecords(null);
        setShowRecordsModal(false);
        // Vínculo com agendamentos — reseta ao trocar de cliente (carregado em useEffect separado)
        setAgendLink(null);
        setAgendAllClients([]);
        // Limpa SÓ os tombstones de IDs locais ("default-fixed-N" se repete
        // entre clientes e bloquearia o save do novo). Tombstones de UUID são
        // únicos globalmente e ficam — remover permitia um ciclo de salvamento
        // atrasado ressuscitar itens excluídos do perfil anterior (2026-07-16).
        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        for (const tid of Array.from(pendingDeletesRef.current)) {
          if (!uuidRe.test(tid)) pendingDeletesRef.current.delete(tid);
        }
        setHouseholdId(coachViewHouseholdId!);
        // Usa service key (via API) para carregar finance_items + partial_expenses
        // porque o RLS do Supabase bloqueia partial_expenses para o JWT do coach.
        const authToken = await getToken({ template: 'supabase' });
        const [household, dbItems] = await Promise.all([
          getHousehold(db!, coachViewHouseholdId!),
          loadFinanceItemsForCoach(authToken!, coachViewHouseholdId!),
        ]);
        if (household?.start_month != null) setStartMonth(household.start_month);
        if (household?.start_year != null) setStartYear(household.start_year);
        // Salta mobileMonthIdx para o mês atual do calendário (igual ao loadData do usuário regular)
        const clientStartMonth = household?.start_month ?? new Date().getMonth();
        const clientStartYear = household?.start_year ?? new Date().getFullYear();
        const clientTempMonths = Array.from({ length: 12 }, (_, i) => {
          const d = new Date(clientStartYear, clientStartMonth + i, 1);
          return { index: d.getMonth(), year: d.getFullYear() };
        });
        const clientCalIdx = clientTempMonths.findIndex(m => m.index === new Date().getMonth() && m.year === new Date().getFullYear());
        if (clientCalIdx >= 0) setMobileMonthIdx(clientCalIdx);
        // SEMPRE substitui os itens — se o cliente não tem dados, volta ao
        // conjunto em branco em vez de manter os do cliente anterior na tela
        // (que aí seriam salvos na conta errada). E colapsa duplicatas já
        // gravadas por bugs anteriores.
        if (dbItems.length > 0) {
          const { deduped, toDelete } = dedupeItems(dbItems);
          toDelete.forEach(id => deleteFinanceItem(db!, id).catch(() => {}));
          const dedupedFixed = fillVariableValuesFromPartials(deduped, janelaDeMeses(clientStartMonth, clientStartYear));
          savedItemHashRef.current = seedItemHashes(dedupedFixed);
          setItems(dedupedFixed);
        } else {
          // Cliente sem dados: itens padrão em branco NÃO estão no banco ainda —
          // hash vazio p/ que sejam criados na 1ª gravação.
          savedItemHashRef.current = {};
          setItems(makeDefaultItems());
        }
        // Libera o salvamento nesta sessão. O admin pula o loadData normal
        // (onde esta trava era ligada), então sem isto TUDO que o coach
        // preenche na conta do cliente ficava só na tela e NUNCA era salvo.
        dbItemsLoadedRef.current = true;
      } catch (e) {
        console.error('Erro ao carregar dados do cliente:', e);
      } finally {
        setDbLoading(false);
      }
    }

    loadClientData();
  }, [db, coachViewHouseholdId]);

  // Fecha overlay do Extrato ao navegar para qualquer outra aba
  useEffect(() => {
    setShowExtrato(false);
    setOfInitialCardLast4(undefined);
    // O mês pedido só vale para a visita que veio do Plano. Saindo do Gastos ele
    // é descartado, senão a próxima abertura herdaria um mês que ninguém pediu.
    if (activeTab !== 'teto') setTetoInitialMonthKey(null);
  }, [activeTab]);

  // Quando coach sai da visão de cliente, restaura os próprios dados
  useEffect(() => {
    if (coachViewHouseholdId) return; // só roda ao sair
    // Limpa SEMPRE ao sair, mesmo sem snapshot (super-admin não tem dados próprios
    // para restaurar, mas o ref precisa ser zerado para que ao re-entrar o mesmo
    // cliente os dados sejam recarregados do banco — sem isso o coach vê dados antigos)
    coachViewLoadedRef.current = null;
    const snap = ownDataSnapshotRef.current;
    if (!snap) return;
    ownDataSnapshotRef.current = null;
    setHouseholdId(snap.householdId);
    savedItemHashRef.current = seedItemHashes(snap.items);
    setItems(snap.items);
    setStartMonth(snap.startMonth);
    setStartYear(snap.startYear);
  }, [coachViewHouseholdId]);

  // Carrega o vínculo com o sistema de agendamentos ao abrir o painel de um cliente
  useEffect(() => {
    if (!coachViewHouseholdId || !isAdmin) return;
    let cancelled = false;
    getToken({ template: 'supabase' }).then(token =>
      fetch(`/api/agendamentos-link?householdId=${coachViewHouseholdId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).then(r => r.ok ? r.json() : null).then(data => {
      if (cancelled || !data) { if (!cancelled) setAgendLink(false); return; }
      setAgendAllClients(data.clients ?? []);
      if (data.currentLinkId) {
        const found = (data.clients ?? []).find((c: any) => c.id === data.currentLinkId);
        setAgendLink(found ? { id: found.id, name: found.name } : false);
      } else {
        setAgendLink(false);
      }
    }).catch(() => { if (!cancelled) setAgendLink(false); });
    return () => { cancelled = true; };
  }, [coachViewHouseholdId, isAdmin]);

  // Salva item no Supabase sempre que items mudar (debounced)
  const saveTimeoutRef = useRef<any>(null);
  const savingRef = useRef(false);
  useEffect(() => {
    if (!db || !householdId || dbLoading || !dbItemsLoadedRef.current) return;
    if (simulando) return; // rascunho não vai para o banco

    clearTimeout(saveTimeoutRef.current);
    const run = () => {
      // Nunca deixa dois ciclos de salvamento rodarem juntos: sob rede lenta,
      // ciclos sobrepostos inseriam a mesma conta várias vezes (duplicação).
      // Se um já está rodando, tenta de novo em 600ms com o estado mais recente.
      if (savingRef.current) { saveTimeoutRef.current = setTimeout(run, 600); return; }
      savingRef.current = true;
      (async () => {
        try {
          for (let i = 0; i < items.length; i++) {
            // Aborta se o usuário trocou de perfil no meio do ciclo — sem isto,
            // um loop em voo continuava gravando o snapshot do perfil ANTERIOR
            // (inclusive itens recém-excluídos) depois da troca (2026-07-16).
            if (currentHouseholdIdRef.current !== householdId) break;
            const item = items[i];
            const dbId = itemIdMapRef.current[item.id] ?? item.id;
            if (pendingDeletesRef.current.has(item.id) || pendingDeletesRef.current.has(dbId)) continue;
            // Só grava se ESTE item mudou de fato. Sem isto, o loop reescrevia a
            // lista inteira e, numa conta de casal, a gravação de um membro
            // sobrescrevia a edição simultânea do outro em itens intocados.
            const hash = itemPersistHash(item, i);
            if (savedItemHashRef.current[item.id] === hash) continue;
            try {
              const savedId = await saveFinanceItem(db!, householdId, item, i);
              if (savedId !== item.id) {
                itemIdMapRef.current[item.id] = savedId;
              }
              savedItemHashRef.current[item.id] = hash;
            } catch (e) {
              console.error('Erro ao salvar item', item.id, e);
            }
          }
        } finally {
          savingRef.current = false;
        }
      })();
    };
    saveTimeoutRef.current = setTimeout(run, 1500);
  }, [items, db, householdId, simulando]);

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

  // Oferta de IA do tour: leva o usuário ao Stets (aba Plano) com o prompt pronto
  const handleTourAiPrompt = (prompt: string) => {
    setActiveTab('plan');
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('kashim:stets-prefill', { detail: { prompt } }));
      document.getElementById('stets')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 450);
  };

  const resetFactory = () => {
    if (confirm("⚠️ RESET DE FÁBRICA: Isso apagará todos os seus lançamentos e configurações para que você possa ver o tutorial novamente. Deseja continuar?")) {
      localStorage.clear();
      window.location.reload();
    }
  };

  // Backup do plano em CSV (Excel abre nativo — antes era .json cru, ilegível
  // pro coach). Uma linha por item, uma coluna por mês do plano + total.
  // Separador ';' e decimal com vírgula = padrão do Excel pt-BR; BOM p/ acentos.
  const exportBackup = () => {
    const catLabel = (c: CategoryType): string => {
      if (c === CategoryType.INCOME) return 'Renda';
      if (c === CategoryType.FIXED_EXPENSE) return 'Contas Fixas';
      if (c === CategoryType.VARIABLE_EXPENSE) return 'Contas Variáveis';
      if (c === CategoryType.CREDIT_CARD) return 'Cartão de Crédito';
      if (c === CategoryType.PERSONAL_LEISURE) return 'Lazer e Gastos Pessoais';
      return String(c);
    };
    const br = (n: number) => (n || 0).toFixed(2).replace('.', ',');
    const q = (s: string) => `"${(s || '').replace(/"/g, "'")}"`;
    const monthCols = months.map(m => `${m.monthName}/${m.year}`);
    const header = [q('Categoria'), q('Descrição'), ...monthCols.map(q), q('Total (12m)')].join(';');
    const rows = items.map(it => {
      const vals = Array.from({ length: 12 }, (_, i) => it.values[i] || 0);
      const total = vals.reduce((a, b) => a + b, 0);
      // Texto entre aspas; números sem aspas p/ o Excel somar.
      return [q(catLabel(it.category)), q(it.description || ''), ...vals.map(br), br(total)].join(';');
    });
    const csv = '﻿' + [header, ...rows].join('\r\n'); // BOM p/ acentos no Excel
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_kashim_${startMonth + 1}_${startYear}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /**
   * MODO SIMULAÇÃO — rascunho do plano na reunião.
   *
   * Enquanto ligado, NADA vai para o banco: nem valores, nem lançamentos, nem
   * exclusões, e o efeito da fatura do Open Finance para de escrever por cima.
   * O cliente com o app aberto não vê nada, porque nada foi gravado. No fim, o
   * coach aplica tudo de uma vez ou descarta e o plano volta como estava
   * (Eduardo, 2026-09-17: precisa mexer em vários números na frente do cliente
   * antes de decidir).
   */
  const iniciarSimulacao = () => {
    if (simulando) return;
    backupSimulacaoRef.current = {
      items: items.map(i => ({ ...i, values: [...i.values], paidStatus: [...i.paidStatus] })),
      startMonth,
      startYear,
    };
    setSimulando(true);
  };

  const descartarSimulacao = () => {
    const bkp = backupSimulacaoRef.current;
    setSimulando(false);
    backupSimulacaoRef.current = null;
    if (!bkp) return;
    // Nada foi gravado, então a cópia da memória é igual ao que está no banco.
    setItems(bkp.items);
    setStartMonth(bkp.startMonth);
    setStartYear(bkp.startYear);
  };

  const aplicarSimulacao = async () => {
    if (aplicandoSimulacao) return;
    const bkp = backupSimulacaoRef.current;
    setAplicandoSimulacao(true);
    try {
      if (db && householdId) {
        while (savingRef.current) await new Promise(r => setTimeout(r, 200));
        savingRef.current = true;
        try {
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (pendingDeletesRef.current.has(item.id)) continue;
            const savedId = await saveFinanceItem(db, householdId, { ...item, id: itemIdMapRef.current[item.id] ?? item.id }, i);
            if (savedId !== item.id) itemIdMapRef.current[item.id] = savedId;
            savedItemHashRef.current[item.id] = itemPersistHash(item, i);
          }
        } finally {
          savingRef.current = false;
        }
        // O início do plano só vai junto se a simulação o tiver mudado.
        if (bkp && (bkp.startMonth !== startMonth || bkp.startYear !== startYear)) {
          const token = await getToken({ template: 'supabase' });
          const res = await fetch('/api/update-start-month', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ householdId, startMonth, startYear }),
          });
          if (!res.ok) throw new Error(await res.text());
        }
      }
      backupSimulacaoRef.current = null;
      setSimulando(false);
    } catch (e: any) {
      alert('Não consegui salvar a simulação inteira. A simulação continua aberta — tente aplicar de novo. Detalhe: ' + (e?.message ?? 'erro'));
    } finally {
      setAplicandoSimulacao(false);
    }
  };

  const [reprojetando, setReprojetando] = useState(false);
  const handleReproject = async (newStartMonth: number, newStartYear: number) => {
    if (reprojetando) return;
    exportBackup();
    const oldMonths = [...months];
    const newProjectionMonths = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(newStartYear, newStartMonth + i, 1);
      newProjectionMonths.push({ monthName: MONTHS_BR[d.getMonth()], year: d.getFullYear(), index: d.getMonth() });
    }

    /**
     * Só o que se REPETE todo mês ganha valor nos meses novos: renda, contas
     * fixas e lazer. Cartão NÃO: fatura é valor do mês, não recorrência — a
     * última fatura era copiada até o fim do plano, em todos os cartões
     * (Eduardo, 2026-09-17, reprojetando na frente de uma cliente). Parcelado
     * também não, porque termina. Variável nunca se repetiu.
     */
    const repeteNosMesesNovos = (item: FinanceItem) =>
      item.linkType !== LinkType.INSTALLMENT && (
        item.category === CategoryType.INCOME ||
        item.category === CategoryType.FIXED_EXPENSE ||
        item.category === CategoryType.PERSONAL_LEISURE);

    const novosItens = items.map(item => {
      const newValues = new Array(12).fill(0);
      const newPaidStatus = new Array(12).fill(false);
      const newPartialExpenses: Record<string, PartialExpense[]> = {};

      newProjectionMonths.forEach((newM, newIdx) => {
        const oldIdx = oldMonths.findIndex(oldM => oldM.index === newM.index && oldM.year === newM.year);
        if (oldIdx !== -1) {
          newValues[newIdx] = item.values[oldIdx] ?? 0;
          newPaidStatus[newIdx] = item.paidStatus[oldIdx] ?? false;
          const oldMonthKey = `${oldMonths[oldIdx].year}-${oldMonths[oldIdx].index}`;
          if (item.partialExpenses && item.partialExpenses[oldMonthKey]) {
            newPartialExpenses[`${newM.year}-${newM.index}`] = item.partialExpenses[oldMonthKey];
          }
        } else if (repeteNosMesesNovos(item)) {
          // Mês que NÃO existia no plano antigo herda o valor do último mês do
          // plano antigo. Mês que existia fica como estava, inclusive zerado:
          // antes todo zero depois de um valor era preenchido, e uma conta que
          // tinha terminado voltava a existir.
          newValues[newIdx] = item.values[oldMonths.length - 1] ?? 0;
        }
      });

      return { ...item, values: newValues, paidStatus: newPaidStatus, partialExpenses: newPartialExpenses };
    });

    // Em simulação, reprojetar é só na tela: grava tudo junto no "Aplicar".
    if (simulandoRef.current) {
      setItems(novosItens);
      setStartMonth(newStartMonth);
      setStartYear(newStartYear);
      setShowProjectionModal(false);
      return;
    }

    setReprojetando(true);

    /**
     * Grava TODAS as linhas antes de mudar o início do plano no servidor.
     *
     * Os valores ficam num vetor de 12 posições, e a posição 0 é o mês de
     * início. Antes o início era gravado na hora e as linhas iam depois, uma a
     * uma, pelo salvamento automático. Se o app fechava, recarregava ou o coach
     * trocava de cliente no meio, as linhas que não chegaram a gravar voltavam
     * com o vetor ANTIGO sob o início NOVO — tudo uma casa para frente: a
     * fatura de agosto aparecia em setembro. As linhas de cartão ficam no fim
     * da lista e eram as últimas a gravar, as que mais se perdiam.
     */
    if (householdId && db) {
      // Segura o salvamento automático enquanto esta gravação roda: os dois
      // juntos podiam inserir a mesma linha duas vezes.
      while (savingRef.current) await new Promise(r => setTimeout(r, 200));
      savingRef.current = true;
      try {
        for (let i = 0; i < novosItens.length; i++) {
          const item = novosItens[i];
          if (pendingDeletesRef.current.has(item.id)) continue;
          const savedId = await saveFinanceItem(db, householdId, { ...item, id: itemIdMapRef.current[item.id] ?? item.id }, i);
          if (savedId !== item.id) itemIdMapRef.current[item.id] = savedId;
          savedItemHashRef.current[item.id] = itemPersistHash(item, i);
        }
        const token = await getToken({ template: 'supabase' });
        const res = await fetch('/api/update-start-month', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ householdId, startMonth: newStartMonth, startYear: newStartYear }),
        });
        if (!res.ok) throw new Error(await res.text());
      } catch (e: any) {
        savingRef.current = false;
        setReprojetando(false);
        setShowProjectionModal(false);
        alert('A reprojeção não terminou de salvar. Recarregue a página ANTES de mexer no plano e confira os valores. Detalhe: ' + (e?.message ?? 'erro'));
        return;
      }
    }

    // Tela muda só depois de o banco estar coerente: valores e início juntos.
    setItems(novosItens);
    setStartMonth(newStartMonth);
    setStartYear(newStartYear);
    savingRef.current = false;
    setReprojetando(false);
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

  // Convite de conexão logo apos o wizard — cenario A (docs/LANCAMENTO.md, D4).
  const [showConviteBanco, setShowConviteBanco] = useState(false);

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
        // Update fixed expense by description (mercado/transporte become VARIABLE_EXPENSE below)
        const expVal = result.expenses[item.description];
        if (expVal !== undefined && expVal > 0 &&
            item.description !== 'Compras mercado (média mensal)' &&
            item.description !== 'Gasolina/uber (media mensal)') {
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

      // Mercado e transporte são gastos variáveis — evita dupla contagem com FIXED_EXPENSE
      const mercadoVal = result.expenses['Compras mercado (média mensal)'] || 0;
      const transporteVal = result.expenses['Gasolina/uber (media mensal)'] || 0;
      if (mercadoVal > 0) {
        const mercado: FinanceItem = { id: crypto.randomUUID(), description: 'Mercado', category: CategoryType.VARIABLE_EXPENSE, values: new Array(12).fill(mercadoVal), paidStatus: new Array(12).fill(false) };
        allUpdated.push(mercado);
        next.push(mercado);
      }
      if (transporteVal > 0) {
        const transporte: FinanceItem = { id: crypto.randomUUID(), description: 'Gasolina / Transporte', category: CategoryType.VARIABLE_EXPENSE, values: new Array(12).fill(transporteVal), paidStatus: new Array(12).fill(false) };
        allUpdated.push(transporte);
        next.push(transporte);
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
    // O 4o argumento (ordem da linha) faltava: os itens do wizard eram gravados
    // sem posicao. Passou despercebido porque `npm run build` nao checa tipos.
    if (db && householdId) {
      for (const item of allUpdated) {
        const ordem = Math.max(0, allUpdated.indexOf(item));
        await saveFinanceItem(db, householdId, item, ordem).catch(console.error);
      }
    }

    localStorage.setItem(`onboarding_done_${user!.id}`, 'true');
    setShowOnboarding(false);

    // Duas saidas, nunca troca pura: quem tem Open Finance recebe o convite de
    // conectar; quem nao tem termina exatamente como sempre terminou.
    if (hasOpenFinanceAccess(user)) setShowConviteBanco(true);
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

  /**
   * Preenche a linha "Faturas de Cartao" com o valor real vindo do Open Finance.
   *
   * Roda uma vez por carregamento, depois que itens e meses ja existem. So
   * escreve onde ha dado real; mes sem fatura conhecida fica como esta, para
   * nao apagar a projecao que o coach digitou.
   *
   * Nao ha risco de dupla contagem: o custo do mes ja faz
   * `Math.max(0, fatura - rastreado)` — o que foi categorizado nas despesas e
   * descontado da fatura automaticamente.
   */
  /** Itens como estão AGORA — o `items` de dentro de um efeito é fotografia. */
  const itemsAgoraRef = useRef<FinanceItem[]>(items);
  itemsAgoraRef.current = items;
  /** Cartões cuja linha já foi criada nesta sessão — ver o comentário no uso. */
  const cartoesCriadosRef = useRef<Set<string>>(new Set());
  /** Linhas de cartão já casadas nesta passada: dois cartões do mesmo banco não
   *  podem cair na mesma linha, senão o segundo sobrescreve o primeiro. */
  const linhasUsadas = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!hasOpenFinanceAccess(user) || !householdId || items.length === 0 || months.length === 0) return;
    /**
     * Nada antes de os itens REAIS chegarem do banco.
     *
     * `items` começa com a lista padrão (`makeDefaultItems`), que não tem a
     * linha do cartão do cliente. Rodando nessa janela, a busca por "Itaú
     * ••7212" não acha nada e o efeito CRIA outra — foi assim que nasceu uma
     * segunda linha idêntica, com os mesmos 12 meses (Eduardo, 2026-09-20,
     * 17:46, ao lado da original de abril).
     */
    if (dbLoading || !dbItemsLoadedRef.current) return;
    // Em simulação a fatura do banco não escreve por cima do que o coach está
    // testando; ela volta a mandar assim que a simulação termina.
    if (simulando) return;
    let cancelado = false;

    (async () => {
      try {
        const token = await getToken({ template: 'supabase' });
        if (!token) return;
        const res = await fetch(`/api/of-connect?householdId=${householdId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const d = await res.json() as {
          connections?: Array<{
            id: string;
            bankName: string;
            cardLast4: string | null;
            cards?: Array<{ last4: string }>;
            billTotals?: Record<string, unknown>;
            saldoAtual?: number | null;
            saldoEm?: string | null;
            accountImportEnabled?: boolean;
            consentStatus?: string | null;
          }>;
        };
        if (cancelado) return;
        const temConexoes = (d.connections ?? []).length > 0;
        setTemBancoConectado(temConexoes);

        // Wizard concluído mas banco ainda não conectado → mostra o convite de novo.
        // Cobre quem fechou o convite na primeira vez sem conectar.
        if (!temConexoes && localStorage.getItem(`onboarding_done_${user!.id}`) === 'true') {
          setShowConviteBanco(true);
        }
        // Compra em cartão virtual chega com um número que não é de cartão
        // nenhum do cliente; este mapa devolve ela ao cartão real da conexão.
        /**
         * Saldo REAL das contas, só das conexões vivas que importam conta.
         * É a linha "No banco hoje" — o número que o cliente compara com o app.
         */
        const comSaldo = (d.connections ?? []).filter((c) => typeof c.saldoAtual === 'number'
          && c.consentStatus !== 'revoked' && c.accountImportEnabled !== false);
        setSaldoNoBanco(comSaldo.length === 0 ? null : {
          total: comSaldo.reduce((soma, c) => soma + Number(c.saldoAtual ?? 0), 0),
          contas: comSaldo.length,
          lido: comSaldo.map((c) => String(c.saldoEm ?? '')).filter(Boolean).sort().slice(-1)[0] ?? null,
        });

        setOfCartoesPorConexao(Object.fromEntries(
          (d.connections ?? []).map((c) => [c.id, (c.cards ?? []).map((x) => x.last4)]),
        ));

        const MES = /^\d{4}-\d{2}$/;

        // O bloco de conferencia (`_conf:<4 digitos>`) ja lista os meses com
        // total declarado pelo banco. E so ler o que a sincronizacao anotou.
        const publicadas: Record<string, string[]> = {};
        for (const conn of d.connections ?? []) {
          for (const [chave, valor] of Object.entries(conn.billTotals ?? {})) {
            if (!chave.startsWith('_conf:') || !valor || typeof valor !== 'object') continue;
            const last4 = chave.slice(6);
            const geral = (valor as { _geral?: { meses_com_total_declarado?: string[] } })._geral;
            const meses = (geral?.meses_com_total_declarado ?? [])
              .map(linha => String(linha).split(':')[0].trim())
              .filter(m => MES.test(m));
            if (meses.length > 0) publicadas[last4] = meses;
          }
        }
        setFaturasPublicadas(publicadas);

        for (const conn of d.connections ?? []) {
          const bruto = conn.billTotals ?? {};
          if (Object.keys(bruto).length === 0) continue;

          /**
           * Uma fatura por CARTÃO.
           *
           * O formato novo é {"7212": {"2026-09": 7863.04}, "6256": {…}} porque
           * uma conexão pode ter vários cartões, cada um com sua fatura. O
           * antigo era plano ({"2026-09": …}) e valia para a conexão inteira —
           * o que fazia o último cartão a sincronizar apagar o anterior.
           * Aceitamos os dois: conexão que ainda não ressincronizou continua
           * lendo o formato plano.
           */
          const ehPlanoAntigo = Object.keys(bruto).every((k) => MES.test(k));
          const porCartao: Array<[string | null, Record<string, unknown>]> = ehPlanoAntigo
            ? [[conn.cardLast4, bruto as Record<string, unknown>]]
            : Object.entries(bruto)
                .filter(([, v]) => v && typeof v === 'object')
                .map(([last4, v]) => [last4, v as Record<string, unknown>]);

          for (const [last4, totals] of porCartao) {
            // Valores da fatura na ordem dos meses do plano.
            const valoresPorMes = months.map((m) => {
              const chave = `${m.year}-${String(m.index + 1).padStart(2, '0')}`;
              const v = totals[chave];
              return typeof v === 'number' && v > 0 ? v : 0;
            });
            if (valoresPorMes.every((v) => v === 0)) continue;

            const apelido = last4
              ? `${conn.bankName} ••${last4}`
              : `${conn.bankName} · Fatura`;

            // Item daquele cartao especifico. Sem os 4 digitos no nome, nao
            // reaproveitamos qualquer linha de cartao: dois cartoes cairiam na
            // mesma e um sobrescreveria o outro.
            /**
             * Achar a linha que o COACH já criou, em vez de criar outra.
             *
             * Ele monta o planejamento antes de o cliente conectar e já lança a
             * fatura à mão, com o nome do banco ("Itaú", ou "Itaú Master" e
             * "Itaú Visa" quando há dois). Não pede os 4 dígitos ao cliente —
             * seria invasivo. Se o casamento falha, nasce uma segunda linha e a
             * fatura aparece dobrada: foi o que produziu "Latam" ao lado de
             * "Itaú ••7212" em 2026-09-10.
             *
             * A cascata vai do sinal mais forte ao mais fraco, e só cria linha
             * nova quando não há nenhuma candidata livre:
             *   1. os 4 dígitos no nome — casamento definitivo
             *   2. o nome do banco, numa linha ainda não usada nesta passada
             *   3. uma única linha de cartão órfã para um único cartão sem dono
             *
             * Casando por 2 ou 3, os dígitos são carimbados no nome ("Itaú
             * Master" → "Itaú Master ••7212"), preservando o nome que o coach
             * escolheu e tornando o casamento definitivo dali em diante.
             *
             * Duas linhas órfãs para dois cartões NÃO casam: não há como saber
             * qual é qual, e duas linhas certas para o cliente juntar é melhor
             * que um casamento errado que ninguém percebe.
             */
            const cartoes = items.filter((i) => i.category === CategoryType.CREDIT_CARD);
            const temDigitos = (d: string) => /••\d{4}/.test(d);
            const primeiroNome = conn.bankName.toLowerCase().split(' ')[0];

            let alvo = last4
              ? cartoes.find((i) => (i.description ?? '').includes(last4))
              : undefined;

            if (!alvo) {
              const doBanco = cartoes.filter((i) =>
                !temDigitos(i.description ?? '')
                && (i.description ?? '').toLowerCase().includes(primeiroNome)
                && !linhasUsadas.current.has(i.id));
              alvo = doBanco[0];
            }

            if (!alvo && last4) {
              const orfas = cartoes.filter((i) =>
                !temDigitos(i.description ?? '') && !linhasUsadas.current.has(i.id));
              const cartoesDaConexao = (conn.cards ?? []).length || 1;
              if (orfas.length === 1 && cartoesDaConexao === 1) alvo = orfas[0];
            }

            if (alvo) {
              linhasUsadas.current.add(alvo.id);
              // Carimba os dígitos para o casamento virar definitivo.
              if (last4 && !temDigitos(alvo.description ?? '')) {
                handleUpdateDescription(alvo.id, `${alvo.description} ••${last4}`.trim());
              }
            }

            if (!alvo) {
              /**
               * Uma linha por cartão, mesmo se o efeito rodar duas vezes.
               *
               * `items` aqui é a cópia do render; entre criar a linha e ela
               * aparecer em `items` existe uma janela, e o efeito rodando de
               * novo nessa janela não encontra o que acabou de criar. Em
               * 2026-09-10 o Eduardo terminou com TRÊS linhas "Itaú ••7212",
               * duas delas criadas com 0,4 milissegundo de diferença.
               *
               * O ref sobrevive ao render e fecha a janela. Nome de cartão que
               * o cliente apagar de propósito não volta nesta sessão — volta no
               * próximo carregamento, que é o comportamento esperado.
               */
              const chaveCartao = `${conn.bankName}|${last4 ?? ''}`;
              if (cartoesCriadosRef.current.has(chaveCartao)) continue;
              /**
               * Confere na lista mais recente, não na cópia deste render.
               *
               * Entre o carregamento e este ponto a linha pode já existir —
               * criada pelo banco, por outra aba ou pelo próprio efeito. O
               * `items` daqui é uma fotografia; `itemsAgoraRef` é o estado.
               */
              const jaExiste = last4
                ? itemsAgoraRef.current.some(i =>
                    i.category === CategoryType.CREDIT_CARD && (i.description ?? '').includes(last4))
                : false;
              if (jaExiste) continue;
              cartoesCriadosRef.current.add(chaveCartao);
              // Cartao identificado e sem linha no plano: cria ja preenchida.
              handleAddItem(CategoryType.CREDIT_CARD, {
                description: apelido,
                values: valoresPorMes,
              });
              continue;
            }

            // Existe: atualiza so os meses que mudaram. Mes sem fatura conhecida
            // fica como esta, para nao apagar a projecao digitada pelo coach.
            valoresPorMes.forEach((real, idx) => {
              if (real <= 0) return;
              if (Math.abs((alvo.values[idx] ?? 0) - real) < 0.01) return;
              handleUpdateValue(alvo.id, idx, String(real));
            });
          }
        }
      } catch { /* fatura e acessoria: falha nao pode travar o app */ }
    })();

    return () => { cancelado = true; };
  }, [householdId, items.length, months.length, user, simulando, dbLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pop-up "X transações a categorizar" — só para quem tem Open Finance
  // liberado (hoje: só o Eduardo). Para todos os demais este efeito sai na
  // primeira linha e nenhuma chamada acontece. Roda uma vez por sessão do app,
  // reaproveitando o MESMO endpoint do Extrato (status=pending) — assim o pop-up
  // pega carona no que a migração fizer com as transações, sem lógica paralela.
  useEffect(() => {
    if (!hasOpenFinanceAccess(user) || !householdId) return;
    if (categorizeCheckedRef.current) return;
    if (coachViewHouseholdId || needsTermsAcceptance) return; // não interrompe coach nem aceite de termos
    categorizeCheckedRef.current = true;
    let cancelado = false;

    (async () => {
      try {
        const token = await getToken({ template: 'supabase' });
        if (!token) return;
        const params = new URLSearchParams({ householdId, status: 'pending', limit: '200' });
        const r = await fetch(`/api/of-transactions?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok || cancelado) return;
        const json = await r.json() as { transactions?: Array<Record<string, unknown>> };
        const lista = json.transactions ?? [];
        if (cancelado) return;
        setOfPendentes(lista.map((t) => ({
          connectionId: (t.connectionId as string) ?? null,
          cardLast4: (t.cardLast4 as string) ?? null,
          billDueDate: (t.billDueDate as string) ?? null,
          transactionDate: String(t.transactionDate ?? ''),
          amount: Number(t.amount ?? 0),
        })));
        const precisamDeVoce = lista.filter((t) => t.suggestionConfidence !== 'memory').length;
        setPendentesAutomaticas(lista.length - precisamDeVoce);
        if (lista.length > 0) {
          setCategorizeCount(precisamDeVoce);
          setShowCategorizePopup(true);
        }
        /**
         * Carrega também o que o Kashim lançou sozinho nos últimos dias.
         *
         * Sem isto, o resumo "o Kashim lançou X por você" só nascia DEPOIS de
         * abrir e fechar o Extrato — quem abria o app e ia para o Plano não via
         * nada, e a fila tinha encolhido sem explicação (Eduardo, 2026-09-19).
         */
        void recontarPendentes();
      } catch { /* aviso é acessório: falha nunca trava o app */ }
    })();

    return () => { cancelado = true; };
  }, [householdId, coachViewHouseholdId, needsTermsAcceptance, user]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Oferece a migracao quando o plano comeca ANTES do mes atual e o banco ja
   * esta conectado. Recusa fica guardada no aparelho: perguntar de novo a cada
   * abertura seria assedio.
   */
  useEffect(() => {
    if (!planoEmModoOF || !householdId || coachViewHouseholdId || dbLoading) return;
    if (months.length === 0 || items.length === 0) return;
    const inicio = months[0];
    const comecaAntes = (inicio.year * 12 + inicio.index) < (currentActualYear * 12 + currentActualMonth);
    if (!comecaAntes) return;
    try {
      if (localStorage.getItem(`kashim_of_migracao_${householdId}`) === 'recusada') return;
    } catch { /* sem localStorage, pergunta de novo */ }
    setOfMigracaoAberta(true);
  }, [planoEmModoOF, householdId, coachViewHouseholdId, dbLoading, months, items.length, currentActualMonth, currentActualYear]);

  /** Manda o resumo dos meses que vao sair, e so entao reprojeta. */
  const migrarParaOF = async () => {
    if (ofMigrando) return;
    setOfMigrando(true);
    try {
      const corteAbs = currentActualYear * 12 + currentActualMonth;
      const anteriores = months
        .map((m, i) => ({ m, i }))
        .filter(({ m }) => (m.year * 12 + m.index) < corteAbs)
        .map(({ m, i }) => ({
          mes: `${m.monthName} ${m.year}`,
          entradas: monthlySummaries[i]?.totalIncome ?? 0,
          custos: monthlySummaries[i]?.totalCost ?? 0,
          sobra: monthlySummaries[i]?.balance ?? 0,
        }));
      if (anteriores.length > 0 && householdId) {
        try {
          const token = await getToken({ template: 'supabase' });
          await fetch('/api/historico-antes-do-of', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ householdId, meses: anteriores }),
          });
        } catch { /* e-mail e acessorio: a reprojecao nao pode depender dele */ }
      }
      await handleReproject(currentActualMonth, currentActualYear);
      setOfMigracaoAberta(false);
    } finally {
      setOfMigrando(false);
    }
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

  // Exclui no banco com retry. Os tombstones em pendingDeletesRef são
  // PERMANENTES na sessão — NUNCA remova ao fim do delete: um ciclo de
  // salvamento em voo com snapshot antigo dos items re-upsertava a linha
  // logo após o DELETE (ressurreição de excluídos, bug real 2026-07-16).
  const deleteItemWithRetry = (dbId: string, attempt: number) => {
    if (!db) { if (attempt < 10) setTimeout(() => deleteItemWithRetry(dbId, attempt + 1), 1000 * attempt); return; }
    deleteFinanceItem(db, dbId).catch(() => {
      if (attempt < 5) setTimeout(() => deleteItemWithRetry(dbId, attempt + 1), 1500 * attempt);
    });
  };

  const handleRemoveItem = (id: string) => {
    const dbId = itemIdMapRef.current[id] ?? id;
    // Em simulação a linha some só da tela; "Descartar" traz de volta.
    if (simulandoRef.current) {
      setItems(prev => prev.filter(item => item.id !== id));
      return;
    }
    pendingDeletesRef.current.add(id);
    pendingDeletesRef.current.add(dbId);
    addTombstone(id, dbId);
    setItems(prev => prev.filter(item => item.id !== id));
    deleteItemWithRetry(dbId, 1);
  };

  const handleUpdateCardConfig = (id: string, field: 'closingDay' | 'dueDay', value: number) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  /**
   * Contagem de chamados em aberto, para o sino. Pede só o número — a lista
   * (que traz mensagem e print) só é carregada quando o painel abre.
   */
  const carregarChamadosAbertos = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const token = await getToken({ template: 'supabase' });
      const res = await fetch('/api/support-admin?count=1', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const body = await res.json();
      setChamadosAbertos(body.abertos ?? 0);
    } catch { /* sino é acessório: falha em silêncio */ }
  }, [isAdmin, getToken]);

  useEffect(() => { carregarChamadosAbertos(); }, [carregarChamadosAbertos]);

  /**
   * Tooltip da Compilação. Não usa o `title` do navegador: ele é lento, sem
   * estilo e não cabe uma explicação de duas linhas. Renderiza `fixed` fora da
   * tabela porque a Compilação rola na horizontal e cortaria um absolute.
   */
  /**
   * O cabeçalho do tooltip é uma lista de pares: rótulo em azul, valor em
   * branco ao lado. Assim "Sua conta fixa completa: R$ 7.175,53" e "No cartão:
   * R$ 2.752,77" ficam em linhas próprias, cada uma legível — antes era um
   * título só, longo, que quebrava em quatro linhas e cortava o valor.
   */
  type TipLinha = { rotulo: string; valor?: string };
  const [tip, setTip] = useState<{ linhas: TipLinha[]; texto: string; x: number; y: number } | null>(null);
  const fecharTip = useCallback(() => setTip(null), []);
  const abrirTip = (e: React.MouseEvent, linhas: TipLinha[], texto: string) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ linhas, texto, x: r.left + r.width / 2, y: r.bottom + 8 });
  };

  /**
   * Rede de segurança do tooltip: qualquer coisa que tire o número de baixo do
   * mouse fecha o balão.
   *
   * `onMouseLeave` sozinho não basta — se a página rola, o usuário troca de
   * aba, ou a janela muda de tamanho, o elemento sai sem disparar o evento e o
   * balão fica preso na tela. Era o que acontecia.
   */
  useEffect(() => {
    if (!tip) return;
    const fecha = () => setTip(null);
    window.addEventListener('scroll', fecha, true); // captura: pega o scroll da tabela também
    window.addEventListener('resize', fecha);
    window.addEventListener('blur', fecha);
    document.addEventListener('visibilitychange', fecha);
    return () => {
      window.removeEventListener('scroll', fecha, true);
      window.removeEventListener('resize', fecha);
      window.removeEventListener('blur', fecha);
      document.removeEventListener('visibilitychange', fecha);
    };
  }, [tip]);

  // Trocar de aba desmonta a tabela sem passar pelo onMouseLeave.
  useEffect(() => { setTip(null); }, [activeTab]);

  /**
   * Célula de valor da Compilação, com espaço FIXO reservado para o ícone
   * embaixo do número — com ou sem tooltip.
   *
   * É uma FUNÇÃO de render, não um componente. Como componente declarado dentro
   * do App, cada render criava um tipo novo: o React desmontava e remontava o
   * elemento, o `onMouseLeave` do antigo nunca disparava e o balão ficava preso
   * na tela mesmo com o mouse longe dali. Chamada como função, o JSX pertence
   * ao render do App e o elemento não é recriado.
   *
   * O espaço reservado embaixo existe porque, sem ele, o ícone entrava no fluxo
   * do texto e num número largo (R$ 10.061,77) quebrava linha, empurrando o
   * valor para cima e torcendo a linha da tabela.
   */
  const celulaValor = (
    texto: string,
    t?: { linhas: TipLinha[]; corpo: string },
    sublinhado = 'border-zinc-600',
  ) => (
    <span className="inline-flex flex-col items-center leading-none">
      <span
        className={t ? `cursor-help border-b border-dashed ${sublinhado} pb-0.5` : undefined}
        onMouseEnter={t ? e => abrirTip(e, t.linhas, t.corpo) : undefined}
        onMouseLeave={t ? fecharTip : undefined}
      >
        {texto}
      </span>
      <span className="h-3.5 mt-1 flex items-center justify-center" aria-hidden="true">
        {t && <i className="fas fa-circle-info text-[9px] text-sky-400/70" />}
      </span>
    </span>
  );

  // ── Fechamento do mês ──────────────────────────────────────────────────────
  // Na virada, perguntar o que ficou sem pagar em vez de adivinhar. Desenho
  // validado com o Eduardo em 2026-08-27 (ver lib/fechamentoMes.ts).
  const [fechamentoAdiado, setFechamentoAdiado] = useState(0);

  /** Índice, dentro de `months`, do mês anterior ao corrente real. */
  const idxMesAFechar = useMemo(() => {
    const atual = months.findIndex(mm => mm.index === currentActualMonth && mm.year === currentActualYear);
    return atual > 0 ? atual - 1 : -1;
  }, [months, currentActualMonth, currentActualYear]);

  /** Chave de controle: por household e por mês, sobrevive ao refresh. */
  const fechamentoKey = useMemo(() => {
    if (idxMesAFechar < 0 || !householdId) return null;
    const mm = months[idxMesAFechar];
    return `kashim_fechou_${householdId}_${mm.year}-${mm.index}`;
  }, [idxMesAFechar, householdId, months]);

  const fechamento = useMemo(() => {
    if (!fechamentoKey || idxMesAFechar < 0) return null;
    // Modo coach fica de fora: quem abre dez clientes veria dez pop-ups.
    if (coachViewClientName) return null;
    if (dbLoading || items.length === 0) return null;
    try { if (localStorage.getItem(fechamentoKey) === 'done') return null; } catch { /* segue */ }
    // Três recusas: para de abrir pop-up (a regra de não ser excessivo).
    if (fechamentoAdiado >= 3) return null;

    const mm = months[idxMesAFechar];
    const mk = monthKeyOf(mm.year, mm.index);
    const resumo = montarFechamento(items, idxMesAFechar, mk);
    if (resumo.vazio) return null;

    const acumulo: Record<string, number> = {};
    for (const c of [...resumo.semLancamento, ...resumo.divergentes]) {
      const item = items.find(i => i.id === c.itemId);
      if (item) acumulo[c.itemId] = contarAcumulo(item, idxMesAFechar, months);
    }
    return { mesNome: mm.monthName, resumo, acumulo };
  }, [fechamentoKey, idxMesAFechar, items, months, coachViewClientName, dbLoading, fechamentoAdiado]);

  const handleConcluirFechamento = (decisoes: DecisaoFechamento[]) => {
    setItems(prev => aplicarFechamento(prev, decisoes, idxMesAFechar));
    try { if (fechamentoKey) localStorage.setItem(fechamentoKey, 'done'); } catch { /* segue */ }
  };

  const handleAdiarFechamento = () => setFechamentoAdiado(n => n + 1);

  /** "Sim, negociei" → cadastra o acordo como VARIÁVEL, não como conta fixa:
   *  assim o acordo consome a sobra sem inflar o pilar de conta fixa sobre o
   *  salário, e o diagnóstico continua medindo a estrutura de vida do cliente. */
  const handleCadastrarAcordo = (descricao: string, valor: number) => {
    setItems(prev => [...prev, {
      id: crypto.randomUUID(),
      description: descricao,
      category: CategoryType.VARIABLE_EXPENSE,
      values: new Array(12).fill(0),
      paidStatus: new Array(12).fill(false),
    }]);
    // A confirmação para o cliente é dada pela própria tela do fechamento —
    // não existe toast global no App e criar um só para isto seria exagero.
  };

  // Ferramenta do coach (só web): remove de uma vez todas as contas fixas
  // Snapshot autocontido do raio-X — o mesmo formato serve para o PDF avulso
  // e para o registro imutável da consultoria (consultation_records).
  const buildRaioXSnapshot = (): RaioXSnapshot => ({
    clientName: coachViewClientName || 'Cliente',
    months: months.map(m => ({ monthName: m.monthName, year: m.year })),
    items: items.map(i => ({ description: i.description, category: i.category, values: i.values })),
    summaries: monthlySummaries.map(s => ({
      totalIncome: s.totalIncome, totalCreditCard: s.totalCreditCard,
      totalFixed: s.totalFixed, totalVariable: s.totalVariable,
      totalLeisure: s.totalLeisure, totalCost: s.totalCost,
      balance: s.balance, accumulated: s.accumulated,
    })),
  });

  const handleGeneratePDF = () => {
    openRaioXWindow(buildRaioXHtml(buildRaioXSnapshot(), new Date().toLocaleDateString('pt-BR')));
  };

  // Registra a consultoria: snapshot imutável no banco + e-mail-cópia ao cliente
  const handleRegisterConsultation = async () => {
    if (!coachViewHouseholdId) return;
    if (!confirm('Registrar a consultoria de hoje? O retrato atual do planejamento será gravado de forma permanente e uma cópia será enviada por e-mail ao cliente.')) return;
    setRegisteringConsult(true);
    try {
      const token = await getToken({ template: 'supabase' });
      const res = await fetch('/api/consultation-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          householdId: coachViewHouseholdId,
          clientName: coachViewClientName,
          snapshot: buildRaioXSnapshot(),
        }),
      });
      const data = await res.json();
      if (!res.ok) { alert('Erro ao registrar: ' + (data.error ?? res.status)); return; }
      setConsultRecords(null); // força recarga na próxima abertura da lista
      const agendMsg =
        data.agendamentosStatus === 'atualizado' ? '\n✅ Agendamento: reunião marcada como realizada'
        : data.agendamentosStatus === 'ja_marcado' ? '\nℹ️ Agendamento: reunião deste mês já estava marcada'
        : data.agendamentosStatus === 'nao_vinculado' ? '\n⚠️ Agendamento: cliente não vinculado — use o botão "Vincular agendamento"'
        : data.agendamentosStatus ? `\n⚠️ Agendamento: ${data.agendamentosStatus}`
        : '';
      alert(`Consultoria registrada em ${new Date(data.createdAt).toLocaleString('pt-BR')}.\nE-mail: ${data.emailStatus}${agendMsg}`);
    } catch {
      alert('Erro de conexão ao registrar a consultoria.');
    } finally {
      setRegisteringConsult(false);
    }
  };

  const openConsultRecords = async () => {
    setShowRecordsModal(true);
    if (consultRecords !== null) return; // já carregado nesta visita
    try {
      const token = await getToken({ template: 'supabase' });
      const res = await fetch(`/api/consultation-records?householdId=${coachViewHouseholdId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setConsultRecords(res.ok ? (data.records ?? []) : []);
    } catch {
      setConsultRecords([]);
    }
  };

  // deixadas em branco ao montar o plano do cliente — sem valor em nenhum mês e
  // sem lançamentos. Evita apagar uma a uma.
  const handleDeleteBlankFixed = () => {
    const isBlank = (i: FinanceItem) =>
      i.category === CategoryType.FIXED_EXPENSE &&
      !i.values.some(v => v > 0) &&
      !i.paidStatus.some(Boolean) &&
      !(i.partialExpenses && Object.values(i.partialExpenses).some(arr => (arr?.length ?? 0) > 0));
    const blanks = items.filter(isBlank);
    if (blanks.length === 0) return;
    if (!confirm(`Excluir ${blanks.length} conta(s) fixa(s) em branco deste cliente?`)) return;
    for (const item of blanks) {
      const dbId = itemIdMapRef.current[item.id] ?? item.id;
      // Tombstones permanentes — ver comentário em deleteItemWithRetry
      pendingDeletesRef.current.add(item.id);
      pendingDeletesRef.current.add(dbId);
      deleteItemWithRetry(dbId, 1);
    }
    const blankIds = new Set(blanks.map(b => b.id));
    setItems(prev => prev.filter(i => !blankIds.has(i.id)));
  };

  /**
   * Tira a linha das somas sem apagar nada (decisão de coach).
   * O histórico continua no banco — é para isso que ela existe.
   */
  const handleToggleOculto = (itemId: string, oculto: boolean) => {
    setItems(prev => prev.map((item, ordem) => {
      if (item.id !== itemId) return item;
      const atualizado = { ...item, oculto };
      if (db && householdId && !simulandoRef.current) {
        saveFinanceItem(db, householdId, atualizado, ordem).catch(() => window.alert('Não consegui salvar. Tente de novo.'));
      }
      return atualizado;
    }));
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
      const newMonthPartials = [...(partials[monthKey] || []), expense];
      const withPartial = { ...item, partialExpenses: { ...partials, [monthKey]: newMonthPartials } };
      // Conta variável: o valor da linha ACOMPANHA a soma dos lançamentos.
      // Antes só era preenchido quando estava zerado — o primeiro gasto fixava o
      // número e os seguintes somavam embaixo sem atualizar. Cartório de
      // R$102,98 + R$202,98 ficava com R$102,98 na linha (Eduardo, 2026-09-17).
      // Valor digitado à mão (diferente da soma anterior) é respeitado.
      if (item.category === CategoryType.VARIABLE_EXPENSE) {
        const mIdx = months.findIndex(m => m.year === targetYear && m.index === targetMonth);
        const atual = mIdx >= 0 ? (item.values[mIdx] || 0) : 0;
        const somaAnterior = (partials[monthKey] || []).reduce((sum, p) => sum + p.value, 0);
        if (mIdx >= 0 && (atual === 0 || Math.abs(atual - somaAnterior) < 0.01)) {
          const newTotal = newMonthPartials.reduce((sum, p) => sum + p.value, 0);
          const newValues = [...withPartial.values];
          newValues[mIdx] = newTotal;
          return { ...withPartial, values: newValues };
        }
      }
      return withPartial;
    }));

    /**
     * O card em Gastos nasce junto com o gasto.
     *
     * Antes ele só era criado quando o cliente tocava no valor no Plano: a
     * primeira vez caía em Lazer (o primeiro card), a segunda criava o card e
     * só a terceira acertava — Água R$ 73,20 do Eduardo, 2026-09-22. Aqui só
     * muda a lista local; quem grava no banco continua sendo o TetoGastos.
     */
    setTetoColumns(prev => {
      if (prev.some(c => c.linkedItemId === itemId)) return prev;
      const alvo = items.find(i => i.id === itemId);
      if (!alvo || alvo.category === CategoryType.INCOME || alvo.category === CategoryType.CREDIT_CARD) return prev;
      if (alvo.category === CategoryType.PERSONAL_LEISURE
        && prev.some(c => items.find(i => i.id === c.linkedItemId)?.category === CategoryType.PERSONAL_LEISURE)) return prev;
      return [...prev, { id: crypto.randomUUID(), title: (alvo.description || 'GASTO').toUpperCase().slice(0, 24).trim(), linkedItemId: itemId }];
    });

    if (db && !simulandoRef.current) {
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

  /**
   * Foto, imagem e voz dentro do pop-up de lançar.
   *
   * Usa o mesmo hook que o AICoach vai usar, em vez de repetir a conversa com
   * a IA: duas cópias divergem na primeira correção que só uma delas recebe.
   */
  const captura = useCapturaGasto({
    systemPrompt: () => {
      const s = monthlySummaries[mobileMonthIdx];
      const fixo = s && s.totalIncome > 0 ? ((s.totalFixed / s.totalIncome) * 100).toFixed(1) : '0';
      const lazer = s && s.totalIncome > 0 ? ((s.totalLeisure / s.totalIncome) * 100).toFixed(1) : '0';
      return `Seu nome é Stets. Você é o mentor financeiro do método "RICO nessa vida", criado por Eduardo Stetner.
Mês atual: ${months[mobileMonthIdx]?.monthName ?? ''} | Renda: ${s?.totalIncome ?? 0} | Fixos: ${fixo}% (ideal ≤55%) | Lazer: ${lazer}% (ideal ≤15%).

REGRAS DE RESPOSTA (OBRIGATÓRIAS):
- Máximo 2 frases curtas em português conversacional.
- ZERO markdown e ZERO emojis.
- Tom direto e encorajador.`;
    },
    availableItems: () => items
      .filter(i => i.category === CategoryType.FIXED_EXPENSE
        || i.category === CategoryType.VARIABLE_EXPENSE
        || i.category === CategoryType.PERSONAL_LEISURE)
      .map(i => ({ id: i.id, description: i.description })),
    onResultado: (_texto, gastos) => {
      const g = gastos?.[0];
      if (!g) return;
      handleExpenseDetected({
        itemId: g.itemId ?? '',
        value: g.value,
        description: g.description,
        installments: g.installments ?? 1,
        isCredit: g.isCredit ?? false,
      } as DetectedExpense);
    },
    // Não há toast global no App, e criar um só para isto seria exagero — o
    // mesmo raciocínio já aplicado em outro ponto deste arquivo.
    onErro: (msg) => window.alert(msg),
  });

  /**
   * Troca o nome do estabelecimento num lançamento já gravado (Editar em Gastos).
   * Grava no lançamento e ensina o dicionário, como a pergunta do Extrato faz.
   */
  const handleRenomearLancamento = (itemId: string, monthKey: string, partialId: string, nome: string) => {
    const item = items.find(i => i.id === itemId);
    const antigo = item?.partialExpenses?.[monthKey]?.find(p => p.id === partialId);
    if (!item || !antigo || !nome.trim()) return;
    const renomeado = { ...antigo, description: nome.trim() };
    setItems(prev => prev.map(i => (i.id !== itemId ? i : {
      ...i,
      partialExpenses: {
        ...i.partialExpenses,
        [monthKey]: (i.partialExpenses?.[monthKey] ?? []).map(p => (p.id === partialId ? renomeado : p)),
      },
    })));
    const [ano, mes] = monthKey.split('-').map(Number);
    if (db && !simulandoRef.current) {
      renomearPartialExpense(db, itemIdMapRef.current[itemId] ?? itemId, ano, mes, renomeado)
        .catch(() => window.alert('Não consegui salvar o nome. Tente de novo.'));
    }
    (async () => {
      try {
        const token = await getToken({ template: 'supabase' });
        await fetch('/api/merchant-nome', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
          body: JSON.stringify({ textoDoBanco: antigo.description, nome: renomeado.description }),
        });
      } catch { /* dicionário é acessório */ }
    })();
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

    // NÃO grava teto_columns daqui: a cópia do App fica defasada da do
    // TetoGastos e o saveTetoColumns (delete-all + insert) APAGAVA colunas
    // criadas lá (escritores concorrentes na mesma tabela, 2026-07-16).
    // O auto-link do TetoGastos cria e persiste a coluna de Lazer sozinho.
    setTetoColumns(prev => {
      const alreadyHas = prev.some(c => {
        const linked = items.find(i => i.id === c.linkedItemId);
        return linked?.category === CategoryType.PERSONAL_LEISURE;
      });
      if (alreadyHas) return prev;
      return [...prev, { id: crypto.randomUUID(), title: 'LAZER', linkedItemId: newId }];
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
      const arrIdx = toArrIdx(refYear, refMonth);
      // Gasto pontual no DÉBITO numa conta recém-criada (ex.: "consultório"):
      // grava só o VALOR na linha com o nome dela. SEM lançamento (partial) —
      // assim não aparece o badge de "realizado" nem um card em Gastos
      // Frequentes (gasto único não precisa de acompanhamento mensal).
      const isSimpleOneTimeDebit = !data.isCredit && !matchedItem;
      if (isSimpleOneTimeDebit) {
        if (arrIdx >= 0) handleUpdateValue(data.itemId, arrIdx, String(data.value));
      } else {
        // Crédito à vista (compensa fatura) ou lançamento numa conta já
        // existente (ex.: mercado, que acumula vários gastos): registra o
        // lançamento normalmente.
        const dateStr = `${String(refDay).padStart(2, '0')}/${String(refMonth + 1).padStart(2, '0')}`;
        handleAddPartial(data.itemId, {
          id: crypto.randomUUID(),
          date: dateStr,
          description: fallbackDesc,
          value: data.value,
          paymentSource: data.isCredit ? 'credit' : 'debit',
          cardLast4: (data as { cardLast4?: string }).cardLast4,
        }, refYear, refMonth);
        if (!matchedItem && arrIdx >= 0) handleUpdateValue(data.itemId, arrIdx, String(data.value));
      }
    } else {
      // Parcelado: data.value é o valor de CADA parcela (ex.: 3x de R$200).
      // Cada mês, a partir do mês da compra, recebe exatamente esse valor.
      const startAbsMonth = refYear * 12 + refMonth;
      // Débito numa conta recém-criada: espalha só o VALOR pelos meses, sem
      // lançamento → sem badge e sem card em Gastos Frequentes (igual ao débito
      // à vista). Crédito ou conta existente: registra lançamento por parcela.
      const isSimpleDebit = !data.isCredit && !matchedItem;
      for (let i = 0; i < installments; i++) {
        const absMonth = startAbsMonth + i;
        const targetCalMonth = absMonth % 12;
        const targetYear = Math.floor(absMonth / 12);
        const arrIdx = toArrIdx(targetYear, targetCalMonth);
        if (isSimpleDebit) {
          if (arrIdx >= 0) handleUpdateValue(data.itemId, arrIdx, String(data.value));
        } else {
          handleAddPartial(data.itemId, {
            id: crypto.randomUUID(),
            date: `${String(i === 0 ? refDay : 1).padStart(2, '0')}/${String(targetCalMonth + 1).padStart(2, '0')}`,
            description: `${fallbackDesc} ${i + 1}/${installments}`,
            value: data.value,
            paymentSource: data.isCredit ? 'credit' : 'debit',
            cardLast4: (data as { cardLast4?: string }).cardLast4,
          }, targetYear, targetCalMonth);
          if (!matchedItem && arrIdx >= 0) handleUpdateValue(data.itemId, arrIdx, String(data.value));
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

  // Cada despesa variável vira sua PRÓPRIA linha, com o nome que a pessoa
  // digitou. (Havia aqui um balde único "Gastos Avulsos" que juntava todas as
  // despesas pontuais numa linha só e apagava o nome — bug real 2026-07-XX.)
  /**
   * Banco removido com "apagar tudo" — solta as linhas de fatura que vieram
   * dele.
   *
   * Essas linhas são REFLEXO da conexão: o efeito de billTotals as recria a
   * cada carga. Era por isso que apagar a fatura no Plano não adiantava — ela
   * voltava sozinha. Com a conexão revogada o efeito não a recria mais, mas a
   * linha já existente precisa sair na mão.
   */
  /** Reconta o que falta categorizar. */
  const recontarPendentes = useCallback(async () => {
    if (!hasOpenFinanceAccess(user) || !householdId) return;
    try {
      const token = await getToken({ template: 'supabase' });
      if (!token) return;
      const params = new URLSearchParams({ householdId, status: 'pending', limit: '200' });
      const r = await fetch(`/api/of-transactions?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return;
      const json = await r.json() as { transactions?: Array<Record<string, unknown>> };
      let lista = json.transactions ?? [];

      /**
       * O que o cliente já ensinou entra sozinho AQUI, na abertura do app.
       *
       * Antes isso só acontecia quando o Extrato abria: o push dizia "já lancei
       * 1 por você", o cliente abria o app e o resumo não vinha — ele passava
       * por Extrato e Gastos e só depois o aviso aparecia (Eduardo, 2026-09-23).
       * Só memória lança sozinho; palpite continua esperando a pessoa.
       */
      const acharItem = (idDoBanco: string) => itemsAgoraRef.current.find(
        (i) => i.id === idDoBanco || itemIdMapRef.current[i.id] === idDoBanco,
      );
      const daMemoria = lista.filter((t) => t.suggestionConfidence === 'memory'
        && t.suggestedItemId && acharItem(String(t.suggestedItemId)));
      const lancadasAgora: Array<{ id: string; transactionId: string; descricao: string; valor: number; categoria: string; linha?: string }> = [];
      if (daMemoria.length > 0 && !lancandoAutoRef.current) {
        lancandoAutoRef.current = true;
        try {
          for (const t of daMemoria) {
            const item = acharItem(String(t.suggestedItemId))!;
            const dateStr = String(t.billDueDate ?? t.transactionDate ?? '');
            const [y, rawM] = dateStr.split('-').map(Number);
            if (!y || !rawM) continue;
            const partialId = crypto.randomUUID();
            handleAddPartial(item.id, {
              id: partialId,
              date: String(t.transactionDate ?? ''),
              description: String(t.merchant || t.description || ''),
              value: Number(t.amount ?? 0),
              paymentSource: t.accountType === 'credit_card' ? 'credit' : 'debit',
              cardLast4: (t.cardLast4 as string) ?? undefined,
            }, y, rawM - 1);
            fetch('/api/of-transactions', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({
                householdId, transactionId: t.transactionId, action: 'categorize',
                itemId: t.suggestedItemId, category: t.suggestedCategory, partialId,
              }),
            }).catch(() => { /* a próxima recontagem tenta de novo */ });
            lancadasAgora.push({
              id: String(t.id ?? t.transactionId ?? ''),
              transactionId: String(t.transactionId ?? ''),
              descricao: String(t.description ?? ''),
              valor: Number(t.amount ?? 0),
              categoria: String(t.suggestedCategory ?? ''),
              linha: item.description,
            });
          }
        } finally {
          lancandoAutoRef.current = false;
        }
        const idsLancados = new Set(daMemoria.map((t) => t.transactionId));
        lista = lista.filter((t) => !idsLancados.has(t.transactionId));
      }

      const precisamDeVoce = lista.filter((t) => t.suggestionConfidence !== 'memory').length;
      setCategorizeCount(precisamDeVoce);
      setPendentesAutomaticas(lista.length - precisamDeVoce);
      setOfPendentes(lista.map((t) => ({
        connectionId: (t.connectionId as string) ?? null,
        cardLast4: (t.cardLast4 as string) ?? null,
        billDueDate: (t.billDueDate as string) ?? null,
        transactionDate: String(t.transactionDate ?? ''),
        amount: Number(t.amount ?? 0),
      })));
      if (lista.length === 0) setShowCategorizePopup(false);

      /**
       * O que o Kashim lançou sozinho nos últimos dias.
       *
       * Sem mostrar isto, a fila encolhe sem explicação: o cliente viu 3
       * pendentes, voltou depois e tinha 1, sem ter mexido em nada (Eduardo,
       * 2026-09-14). Pior que a confusão é não poder conferir — lançamento
       * automático erra, e errar escondido é o que quebra a confiança no saldo.
       */
      const pc = new URLSearchParams({ householdId, status: 'categorized', limit: '200' });
      const rc = await fetch(`/api/of-transactions?${pc}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!rc.ok) return;
      const jc = await rc.json() as { transactions?: Array<Record<string, unknown>> };
      const limite = Date.now() - 3 * 24 * 60 * 60 * 1000;
      const auto = (jc.transactions ?? []).filter((t) => {
        if (t.suggestionConfidence !== 'memory') return false;
        // Conferido no servidor = conferido em TODO aparelho (Eduardo, 2026-09-23).
        if (t.resumoVisto === true) return false;
        const quando = t.categorizedAt ? new Date(String(t.categorizedAt)).getTime() : 0;
        return quando >= limite;
      });
      const doServidor = auto.map((t) => {
        const idDaLinha = String(t.kashimItemId ?? '');
        const linha = itemsAgoraRef.current.find(i => i.id === idDaLinha || itemIdMapRef.current[i.id] === idDaLinha);
        return {
          id: String(t.id ?? t.transactionId ?? `${t.description}|${t.amount}`),
          transactionId: String(t.transactionId ?? ''),
          descricao: String(t.description ?? ''),
          valor: Number(t.amount ?? 0),
          categoria: String(t.kashimCategory ?? t.suggestedCategory ?? ''),
          linha: linha?.description,
        };
      });
      // O PATCH pode não ter chegado ainda: o que acabou de entrar sozinho
      // aparece no resumo na hora, sem esperar a próxima leitura.
      const vistos = new Set(doServidor.map((t) => t.id));
      setAutoCategorizadas([...lancadasAgora.filter((t) => !vistos.has(t.id)), ...doServidor]);
    } catch { /* aviso é acessório */ }
  }, [user, householdId, getToken]);

  const handleBancoRemovido = (bankName: string) => {
    const daquele = (d: string) => d === `${bankName} · Fatura` || d.startsWith(`${bankName} ••`);
    setItems(prev => prev.filter(i => {
      if (i.category !== CategoryType.CREDIT_CARD || !daquele(i.description)) return true;
      if (db) deleteFinanceItem(db, i.id).catch(console.error);
      return false;
    }));
    // A contagem era buscada UMA vez, no primeiro carregamento. Sem isto o
    // "53 transações esperando você" continuava anunciando o que já não existe.
    recontarPendentes();
  };

  const handleOpenExtrato = async (cardLast4?: string) => {
    const t = await getToken({ template: 'supabase' });
    if (!t) return;
    setOfAuthToken(t);
    setOfInitialCardLast4(cardLast4);
    setShowExtrato(true);
  };

  const handleCreateItem = (description: string, category: CategoryType, _isOneTime?: boolean): string => {
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
      // Espelho do handleAddPartial: na variável, se a linha seguia a soma,
      // continua seguindo depois de apagar um lançamento.
      if (item.category !== CategoryType.VARIABLE_EXPENSE) return { ...item, partialExpenses: newPartials };
      const values = [...item.values];
      Object.keys(partials).forEach(key => {
        if (partials[key].length === newPartials[key].length) return;
        const [y, m] = key.split('-').map(Number);
        const mIdx = months.findIndex(md => md.year === y && md.index === m);
        if (mIdx < 0) return;
        const antes = partials[key].reduce((sum, p) => sum + p.value, 0);
        if (Math.abs((values[mIdx] || 0) - antes) < 0.01) {
          values[mIdx] = newPartials[key].reduce((sum, p) => sum + p.value, 0);
        }
      });
      return { ...item, partialExpenses: newPartials, values };
    }));

    if (db && !simulandoRef.current) {
      deletePartialExpense(db, expenseId).catch(console.error);
    }
  };

  const handleReplicateValue = (id: string, monthIdx: number) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, values: i.values.map((v, idx) => idx >= monthIdx ? i.values[monthIdx] : v) } : i));
  };

  /**
   * Sobe ou desce um item na ordem — sempre DENTRO da própria categoria.
   *
   * Troca com o vizinho da MESMA categoria, pulando o que houver entre eles no
   * array. Antes trocava com o vizinho imediato e desistia se ele fosse de
   * outra categoria: como cada bloco recebe `items.filter(...)`, dois itens
   * vizinhos na tela podiam estar separados por linhas de outros blocos no
   * array, e a seta não fazia nada sem dizer por quê.
   *
   * Mudar de categoria continua impossível, agora por construção: o swap só
   * acontece entre itens que já têm a mesma categoria.
   */
  const handleMoveItem = (id: string, direction: 'up' | 'down') => {
    setItems(prev => {
      const idx = prev.findIndex(i => i.id === id);
      if (idx === -1) return prev;
      const categoria = prev[idx].category;

      let swapIdx = -1;
      if (direction === 'up') {
        for (let k = idx - 1; k >= 0; k--) if (prev[k].category === categoria) { swapIdx = k; break; }
      } else {
        for (let k = idx + 1; k < prev.length; k++) if (prev[k].category === categoria) { swapIdx = k; break; }
      }
      if (swapIdx === -1) return prev; // já é o primeiro ou o último do bloco

      const next = [...prev];
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

  /**
   * Compilacao do mes em REGIME DE CAIXA (decisao do Eduardo, 2026-08-17).
   *
   * A pergunta que esta tabela responde e "quanto sai da minha conta neste mes",
   * e nao "quanto eu gastei neste mes". Sao perguntas diferentes: uma compra no
   * cartao dia 10 de agosto e gasto de agosto, mas o dinheiro so sai na fatura
   * de setembro.
   *
   *   Custo do mes = fatura que vence no mes + o que sai fora do cartao
   *
   * Por isso a fatura entra INTEIRA, categorizada ou nao: o banco debita o valor
   * cheio independentemente de o cliente ter classificado os lancamentos.
   * Categorizar passa a servir so para dizer de que categoria era o gasto (teto
   * de gastos e Desempenho, que usam a data da COMPRA via getPlanTotals).
   *
   * Antes o calculo misturava os dois regimes conforme o mes: descontava as
   * contas no cartao so no mes corrente, e nos meses ja passados somava as
   * categorias cheias MAIS a fatura cheia — contando o mesmo gasto duas vezes.
   */
  /** Apelido só para deixar explícito o que entra no cálculo abaixo. */
  const todosOsItens = items;

  const monthlySummaries = useMemo((): SummaryData[] => {
    const summaries: SummaryData[] = [];
    // Linha oculta fica FORA de toda soma — é a dívida que o coach decidiu
    // deixar para trás, guardada só para consulta (Eduardo, 2026-09-23).
    const items = todosOsItens.filter((i) => !i.oculto);
    const creditCardItems = items.filter(i => i.category === CategoryType.CREDIT_CARD);
    let accumulated = 0;
    /**
     * Tem cartão vindo do banco? Então a fatura é fato, não estimativa.
     *
     * Muda o que a projeção da fatura seguinte pode somar — ver
     * `vemDoMesAnterior`. Basta um cartão conectado: quem tem Open Finance tem a
     * fatura real preenchida pelo efeito de `billTotals`.
     */
    const temFaturaDoBanco = Object.values(ofCartoesPorConexao)
      .some((l) => Array.isArray(l) && l.length > 0);

    /**
     * O CUSTO não distingue mais mês corrente de mês futuro: o que está no
     * cartão sai do custo em todos os meses, sempre. Era essa distinção que
     * fazia o acumulado nascer vermelho e se desfazer sozinho na virada do mês
     * — e ela já tinha exigido duas correções antes de cair (2026-08-24 e -25).
     *
     * A FATURA ainda distingue, mas por outro motivo, explicado onde é usada:
     * a fatura do mês seguinte já foi atualizada pelo cliente com o que ele
     * passou no cartão; as de depois, não.
     */
    const absMonth = (year: number, monthIndex: number) => year * 12 + monthIndex;
    const hojeAbs = absMonth(currentActualYear, currentActualMonth);

    /**
     * Quanto DESTE item vai para o cartão no mês `mIdx` — o que já foi lançado
     * no crédito mais o que ainda está previsto numa linha declarada no cartão.
     *
     * Recebe o mês por parâmetro (e não do fechamento do laço) porque o mesmo
     * número é usado duas vezes, em meses diferentes: sai do custo de M e entra
     * na fatura de M+1. É essa simetria que impede o dinheiro de sumir.
     */
    const cartaoDoItemNoMes = (item: FinanceItem, mIdx: number): number => {
      const md = months[mIdx];
      if (!md) return 0;
      const mk = `${md.year}-${md.index}`;
      const partials = (item.partialExpenses?.[mk] || []) as PartialExpense[];
      const gastoReal = partials.reduce((sum, p) => sum + p.value, 0);

      // O que JÁ foi lançado no crédito — vale mesmo sem a linha declarar
      // cartão, porque no Open Finance a forma vem do lançamento, não da linha.
      const lancadoNoCartao = partials
        .filter(p => getSourceInfo(p, item, creditCardItems).isCredit)
        .reduce((sum, p) => sum + p.value, 0);

      // E o que ainda vai passar, quando a linha inteira é declarada no cartão.
      const declaradoCartao = !!item.linkedCardId && item.linkType !== LinkType.DEBIT;
      const fechadaNoReal = item.paidStatus?.[mIdx] === true && partials.length > 0;
      const planejadoRestante = fechadaNoReal ? 0 : Math.max(0, (item.values[mIdx] || 0) - gastoReal);

      return lancadoNoCartao + (declaradoCartao ? planejadoRestante : 0);
    };

    /**
     * Só o que AINDA VAI passar no cartão — o banco não sabe disso.
     *
     * A diferença para `cartaoDoItemNoMes` é o gasto que JÁ aconteceu. Ele
     * pertence às duas contas por motivos opostos:
     *   - no ABATIMENTO, precisa entrar (está dentro da fatura, não pode contar
     *     de novo na linha de conta fixa);
     *   - na PROJEÇÃO da fatura seguinte, não pode entrar — a fatura que veio do
     *     Open Finance já o contém.
     *
     * Somar os dois inflava outubro do Eduardo em R$ 3.955,61: a Compilação
     * mostrava R$ 10.747,38 numa fatura de R$ 4.092,51, e a sobra do mês
     * aparecia em vermelho (−R$ 891,35) num mês que fecha positivo
     * (2026-09-10).
     */
    const aindaVaiProCartao = (item: FinanceItem, mIdx: number): number => {
      const md = months[mIdx];
      if (!md) return 0;
      const declaradoCartao = !!item.linkedCardId && item.linkType !== LinkType.DEBIT;
      if (!declaradoCartao) return 0;
      const mk = `${md.year}-${md.index}`;
      const partials = (item.partialExpenses?.[mk] || []) as PartialExpense[];
      const gastoReal = partials.reduce((sum, p) => sum + p.value, 0);
      const fechadaNoReal = item.paidStatus?.[mIdx] === true && partials.length > 0;
      return fechadaNoReal ? 0 : Math.max(0, (item.values[mIdx] || 0) - gastoReal);
    };

    const CATEGORIAS_DE_CUSTO = [
      CategoryType.FIXED_EXPENSE,
      CategoryType.VARIABLE_EXPENSE,
      CategoryType.PERSONAL_LEISURE,
    ];

    /** Total que vai para o cartão num mês, somando todas as linhas de custo. */
    const cartaoDoMes = (mIdx: number): number =>
      mIdx < 0 || mIdx >= months.length ? 0
        : items.reduce((sum, i) =>
            CATEGORIAS_DE_CUSTO.includes(i.category) ? sum + cartaoDoItemNoMes(i, mIdx) : sum, 0);

    /** Igual ao anterior, mas só com o que o banco ainda não viu. */
    const cartaoProjetadoDoMes = (mIdx: number): number =>
      mIdx < 0 || mIdx >= months.length ? 0
        : items.reduce((sum, i) =>
            CATEGORIAS_DE_CUSTO.includes(i.category) ? sum + aindaVaiProCartao(i, mIdx) : sum, 0);

    for (let m = 0; m < 12; m++) {
      const monthData = months[m];
      const monthKey = monthData ? `${monthData.year}-${monthData.index}` : '';

      const totalIncome = items
        .filter(i => i.category === CategoryType.INCOME)
        .reduce((sum, i) => sum + (i.values[m] || 0), 0);

      /**
       * Quanto DESTE item sai da conta neste mes. O que foi (ou sera) pago no
       * cartao fica de fora: ja esta dentro da fatura.
       *
       * Com lancamentos do extrato sabemos exatamente como cada real foi pago.
       * O que sobra do teto e ainda nao foi gasto continua contando como saida
       * — a menos que o item esteja declarado como cartao, caso em que a sobra
       * tambem cairia na fatura.
       */
      /**
       * O que sai da conta por causa deste item, NESTE mês — valor CHEIO.
       *
       * A parte que vai no cartão continua aqui e é abatida uma vez só, no
       * `jaNaFatura`, reaparecendo na fatura do mês seguinte. Antes o
       * abatimento valia só até o mês seguinte; hoje vale sempre, porque a
       * contrapartida na fatura existe (ver `totalCreditCard`).
       */
      const desembolsoDoItem = (item: FinanceItem): number => {
        const partials = (item.partialExpenses?.[monthKey] || []) as PartialExpense[];
        const gastoReal = partials.reduce((sum, p) => sum + p.value, 0);
        const noCartao = partials
          .filter(p => getSourceInfo(p, item, creditCardItems).isCredit)
          .reduce((sum, p) => sum + p.value, 0);
        const noDebito = gastoReal - noCartao;
        const declaradoCartao = !!item.linkedCardId && item.linkType !== LinkType.DEBIT;

        /**
         * Conta marcada como PAGA e com lançamento fecha no valor real: o que
         * sobrou do previsto não vai mais acontecer. Sem a marca, vale o
         * previsto — o cliente ainda pode gastar até o teto.
         *
         * A marca sozinha não basta: quem marca "paguei" sem lançar nada não
         * está dizendo que gastou zero. Nesse caso vale o previsto, senão a
         * conta sumiria do mês.
         */
        const fechadaNoReal = item.paidStatus?.[m] === true && partials.length > 0;
        const planejadoRestante = fechadaNoReal ? 0 : Math.max(0, (item.values[m] || 0) - gastoReal);

        // Valor CHEIO do mês: o que já foi gasto (em qualquer forma) mais o que
        // ainda está previsto. O que está no cartão continua aqui — sai uma vez
        // só, no abatimento `jaNaFatura` abaixo.
        //
        // `noDebito` fica sem uso aqui de propósito: somar só o débito faria a
        // linha "cheia" perder o que já foi lançado no cartão. Era assim até
        // 2026-08-27 e fazia o mercado do Hugo aparecer como R$ 1.243,17 numa
        // linha rotulada "valor cheio", quando o previsto era R$ 1.500.
        void noDebito;
        return gastoReal + planejadoRestante;
      };

      /**
       * Quanto dos custos deste mês JÁ está dentro da fatura informada.
       *
       * Só existe no mês corrente e no seguinte: neles a fatura já foi
       * informada pelo cliente contendo esses gastos, então somar a linha de
       * custo cheia MAIS a fatura contaria duas vezes. O abatimento aparece na
       * tela como "(−) já incluído na fatura", com sinal, para a soma fechar na
       * vertical — foi a saída para mostrar a conta fixa cheia e estável sem
       * criar a pergunta "por que a soma não bate?".
       */
      const jaNaFaturaDoItem = (item: FinanceItem): number => cartaoDoItemNoMes(item, m);

      const somaDesembolso = (category: CategoryType) => items
        .filter(i => i.category === category)
        .reduce((sum, i) => sum + desembolsoDoItem(i), 0);

      const totalFixed = somaDesembolso(CategoryType.FIXED_EXPENSE);
      const totalVariable = somaDesembolso(CategoryType.VARIABLE_EXPENSE);
      const totalLeisure = somaDesembolso(CategoryType.PERSONAL_LEISURE);

      /**
       * Fatura do mês = o que o cliente informou + o que veio do cartão do mês
       * ANTERIOR, quando aquele mês ainda não terminou.
       *
       * A segunda parcela é o que faltava, e o furo aparecia assim: em 4 de
       * setembro o cliente ainda não tinha passado nada no cartão, mas o app já
       * abatia R$ 3.082 da conta fixa de outubro "porque estaria na fatura" —
       * e a fatura de outubro não tinha recebido nada. O dinheiro sumia entre
       * as duas linhas e a sobra do mês aparecia R$ 3.082 maior do que era.
       *
       * A regra do "ainda não terminou" evita o outro extremo. Se o mês
       * anterior já acabou, o cliente teve chance de atualizar a fatura com o
       * que passou — somar de novo duplicaria, que foi o erro de 2026-08-27,
       * quando a Compilação do Diego mostrou R$ 2.657 numa fatura informada
       * como R$ 13.
       */
      const faturaInformada = items
        .filter(i => i.category === CategoryType.CREDIT_CARD)
        .reduce((sum, card) => sum + (card.values[m] || 0), 0);

      const anteriorAindaNaoTerminou = m > 0 && !!months[m - 1] &&
        absMonth(months[m - 1].year, months[m - 1].index) >= hojeAbs;
      /**
       * Com fatura do banco, projeta-se só o que ele AINDA não viu.
       *
       * Sem Open Finance a fatura é um palpite do cliente e não contém o que ele
       * lançou à mão — aí somar o gasto já lançado está certo. Com Open Finance
       * a fatura JÁ é o valor real e o gasto está dentro dela; somar de novo é
       * contar duas vezes.
       */
      const vemDoMesAnterior = anteriorAindaNaoTerminou
        ? (temFaturaDoBanco ? cartaoProjetadoDoMes(m - 1) : cartaoDoMes(m - 1))
        : 0;

      const totalCreditCard = faturaInformada + vemDoMesAnterior;

      // Abatimento: o que vai no cartão sai do custo deste mês — em TODOS os
      // meses. Vale porque agora ele reaparece na fatura do mês seguinte; sem
      // essa contrapartida, abater nos meses distantes fazia o valor evaporar.
      const jaNaFatura = CATEGORIAS_DE_CUSTO
        .reduce((sum, cat) => sum + items.filter(i => i.category === cat).reduce((s, i) => s + jaNaFaturaDoItem(i), 0), 0);

      // Só a parte que vem da conta fixa — é o que o tooltip daquela linha cita.
      const fixoNoCartao = items
        .filter(i => i.category === CategoryType.FIXED_EXPENSE)
        .reduce((s, i) => s + jaNaFaturaDoItem(i), 0);

      const totalCost = totalCreditCard + totalFixed + totalVariable + totalLeisure - jaNaFatura;
      const balance = totalIncome - totalCost;
      accumulated += balance;

      summaries.push({ totalIncome, totalCreditCard, totalFixed, totalVariable, totalLeisure, jaNaFatura, fixoNoCartao, totalCost, balance, accumulated });
    }
    return summaries;
  }, [todosOsItens, months, currentActualMonth, currentActualYear, ofCartoesPorConexao]);

  // Backup automático: snapshot do PLANO INTEIRO (todos os itens) marcado no mês
  // vigente. Rede de segurança contra perda de dados — o saveSnapshot existia mas
  // nunca era chamado (ver lesson_data_loss_incidents). Debounce 6s após mudanças.
  // Silencioso: se a tabela financial_snapshots ainda não existir no Supabase
  // (docs/sql/financial-snapshots.sql), o erro é engolido e nada quebra.
  const snapshotTimeoutRef = useRef<any>(null);
  useEffect(() => {
    if (!db || !householdId || dbLoading || !dbItemsLoadedRef.current) return;
    if (items.length === 0 || simulando) return;
    clearTimeout(snapshotTimeoutRef.current);
    const hhAtSchedule = householdId;
    snapshotTimeoutRef.current = setTimeout(() => {
      // Não grava snapshot do perfil anterior se o usuário trocou de conta
      if (currentHouseholdIdRef.current !== hhAtSchedule) return;
      const calIdx = months.findIndex(m => m.index === currentActualMonth && m.year === currentActualYear);
      const idx = calIdx >= 0 ? calIdx : mobileMonthIdx;
      const s = monthlySummaries[idx];
      if (!s || !months[idx]) return;
      saveSnapshot(db!, hhAtSchedule, months[idx].index, months[idx].year, {
        totalIncome: s.totalIncome,
        totalFixed: s.totalFixed,
        totalVariable: s.totalVariable,
        totalLeisure: s.totalLeisure,
        totalCreditCard: s.totalCreditCard,
        balance: s.balance,
        accumulated: s.accumulated,
      }, items).catch(() => {});
    }, 6000);
    return () => clearTimeout(snapshotTimeoutRef.current);
  }, [items, db, householdId, dbLoading, simulando, monthlySummaries, months, mobileMonthIdx, currentActualMonth, currentActualYear]);

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

  // Total já categorizado pelo extrato bancário neste mês, por cardLast4.
  // Reduz o "a categorizar" conforme o usuário confirma transações no Extrato.
  const categorizedByCardLast4 = useMemo((): Record<string, number> => {
    // VOLTOU ao mês corrente em 2026-09-10. O deslocamento para o mês anterior
    // foi feito para o Open Finance e alterava o plano normal, que é quem usa
    // este mapa — a linha do cartão no modo OF usa `aCategorizarPorCartaoMes`.
    const curMonthData = months[mobileMonthIdx];
    if (!curMonthData) return {};
    const curMonthKey = `${curMonthData.year}-${curMonthData.index}`;
    const result: Record<string, number> = {};
    for (const item of items) {
      if (item.category === CategoryType.CREDIT_CARD) continue;
      for (const p of (item.partialExpenses?.[curMonthKey] ?? [])) {
        if (p.paymentSource === 'credit' && p.cardLast4) {
          result[p.cardLast4] = (result[p.cardLast4] ?? 0) + p.value;
        }
      }
    }
    return result;
  }, [items, months, mobileMonthIdx]);

  // Igual ao categorizedByCardLast4, porem para TODOS os meses: a tabela da web
  // mostra 12 colunas de uma vez, e o mapa de um mes so deixava o 'a categorizar'
  // invisivel no desktop para cartao que vem do Open Finance (o Bradesco aparecia
  // mudo enquanto o Latam, com rastreamento antigo, mostrava a caixa).
  const categorizedByCardAllMonths = useMemo((): Record<string, Record<number, number>> => {
    const result: Record<string, Record<number, number>> = {};
    months.forEach((monthData, mIdx) => {
      const monthKey = `${monthData.year}-${monthData.index}`;
      for (const item of items) {
        if (item.category === CategoryType.CREDIT_CARD) continue;
        for (const p of (item.partialExpenses?.[monthKey] ?? [])) {
          if (p.paymentSource !== 'credit' || !p.cardLast4) continue;
          if (!result[p.cardLast4]) result[p.cardLast4] = {};
          result[p.cardLast4][mIdx] = (result[p.cardLast4][mIdx] ?? 0) + p.value;
        }
      }
    });
    return result;
  }, [items, months]);

  /**
   * O que falta categorizar em cada fatura — vindo da FILA, não de subtração.
   *
   * Antes o número era um resíduo (fatura − rastreado − categorizado) e por
   * isso não correspondia a nada: sobrava o encargo que o banco cobra e a
   * Technospeed não entrega como lançamento, então novembro pedia R$ 105 com a
   * fila vazia; e rastreado e categorizado contavam o MESMO dinheiro por dois
   * caminhos (item vinculado ao cartão + parcela com o cartão carimbado),
   * fazendo o "identificado" passar da própria fatura — R$ 6.335 numa fatura de
   * R$ 4.092 (Eduardo, 2026-09-10).
   *
   * A regra agora é a que o Eduardo ditou: se a tela diz "a categorizar R$ X",
   * existem transações somando X esperando no Extrato, e tocar no número leva
   * até elas. Zero na fila = fatura categorizada, mesmo que a fatura tenha
   * dentro dela um encargo que nunca vira lançamento.
   *
   * A fatura de uma compra no crédito é a do mês SEGUINTE ao da compra, salvo
   * quando o banco carimba o vencimento — aí vale o que ele disse.
   */
  const aCategorizarPorCartaoMes = useMemo((): Record<string, Record<number, number>> => {
    const result: Record<string, Record<number, number>> = {};
    for (const t of ofPendentes) {
      const daConexao = ofCartoesPorConexao[t.connectionId ?? ''] ?? [];
      const cartao = t.cardLast4 && daConexao.includes(t.cardLast4)
        ? t.cardLast4
        : daConexao[0] ?? t.cardLast4;
      if (!cartao) continue;

      let ano: number, mes: number;
      if (t.billDueDate) {
        const [y, m] = t.billDueDate.split('-').map(Number);
        ano = y; mes = m - 1;
      } else {
        const [y, m] = t.transactionDate.split('-').map(Number);
        const d = new Date(Date.UTC(y, m, 1)); // mês seguinte ao da compra
        ano = d.getUTCFullYear(); mes = d.getUTCMonth();
      }

      const mIdx = months.findIndex((x) => x.year === ano && x.index === mes);
      if (mIdx < 0) continue;
      if (!result[cartao]) result[cartao] = {};
      result[cartao][mIdx] = Math.round(((result[cartao][mIdx] ?? 0) + t.amount) * 100) / 100;
    }
    return result;
  }, [ofPendentes, ofCartoesPorConexao, months]);

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
      <StaffTwoFactorGate>
        <CoachDashboard
          onEnterClient={(hId, name) => {
            setCoachViewHouseholdId(hId);
            setCoachViewClientName(name);
          }}
          isSuperAdmin={ADMIN_IDS.includes(user?.id ?? '')}
          chamadosAbertos={chamadosAbertos}
          onAbrirChamados={() => setShowSuporteAdmin(true)}
        />
        {/* O painel precisa ser renderizado AQUI: este return acontece antes
            dos overlays do fim do App, então o que estivesse só lá embaixo
            nunca apareceria para quem está no dashboard do consultor. */}
        {showSuporteAdmin && (
          <SuporteAdmin onClose={() => setShowSuporteAdmin(false)} onMudou={carregarChamadosAbertos} />
        )}
      </StaffTwoFactorGate>
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

          {/* Chegou por um convite de casal: explica o que fazer, senão o
              cônjuge cai na tela de cadastro sem entender por quê. */}
          {hasPendingInvite() && (
            <div className="w-full flex items-start gap-3 bg-green-500/10 border border-green-500/30 rounded-2xl px-4 py-3">
              <i className="fas fa-user-friends text-green-400 mt-0.5 shrink-0"></i>
              <p className="text-green-200 text-xs leading-relaxed text-left">
                <span className="font-black">Você foi convidado para um plano compartilhado.</span> Crie sua conta abaixo (nome, e-mail e senha) para entrar no mesmo plano do seu parceiro(a). Depois é só usar esse login e senha para acessar.
              </p>
            </div>
          )}

          {authMode === 'login' ? (
            <SignIn routing="hash" appearance={{
              elements: {
                headerTitle: 'hidden',
                headerSubtitle: 'hidden',
                // Google bloqueia OAuth em WebView (403 disallowed_useragent),
                // então no app nativo escondemos os botões sociais.
                ...(isNativeApp ? {
                  socialButtons: { display: 'none' },
                  socialButtonsBlockButton: { display: 'none' },
                  socialButtonsIconButton: { display: 'none' },
                  dividerRow: { display: 'none' },
                } : {}),
              }
            }} />
          ) : (
            <SignUp routing="hash" appearance={{
              elements: {
                headerTitle: 'hidden',
                headerSubtitle: 'hidden',
                // CADASTRO sempre sem Google (web E app). Quem cria com Google
                // fica preso ao tentar usar o app (Google bloqueia OAuth em
                // WebView), então todo cadastro novo usa e-mail+senha, que
                // funciona nos dois. O LOGIN (SignIn) mantém o Google na web
                // para quem já criou a conta assim não ficar trancado.
                socialButtons: { display: 'none' },
                socialButtonsBlockButton: { display: 'none' },
                socialButtonsIconButton: { display: 'none' },
                dividerRow: { display: 'none' },
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

  /**
   * O elemento que rola a página. html/body têm altura fixa (index.html), então
   * quem rola é o <body> e `window.scrollTo` não faz nada.
   */
  const rolador = (): HTMLElement => {
    const b = document.body;
    return b.scrollHeight > b.clientHeight + 1 ? b : (document.scrollingElement as HTMLElement ?? document.documentElement);
  };

  /** Fecha as camadas abertas (lancar/extrato) e vai para a aba pedida. */
  const irParaAba = (aba: typeof activeTab) => {
    // Tocar na aba em que já se está sobe para o topo (Eduardo, 2026-09-22).
    if (aba === activeTab && !showExtrato && !pendingExpense) {
      rolador().scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setVoltarAoPlanoY(null);
    setPendingExpense(null);
    // Sair do Extrato pela barra tambem tem de recontar: antes so o X fazia
    // isso, e o badge seguia com o numero antigo (Eduardo, 2026-09-22).
    if (showExtrato) { setShowExtrato(false); void recontarPendentes(); }
    setActiveTab(aba);
  };
  const destaqueBarra: string = showExtrato ? 'extrato' : (pendingExpense ? 'centro' : activeTab);

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f] isolate">
      <AmbientBackground />

      {/* Faixa da simulação — fica por cima de tudo para ninguém esquecer que
          está num rascunho. Aparece no celular e na web. */}
      {simulando && (
        <div
          className="fixed left-0 right-0 z-[9998] bg-[#b07500] text-white shadow-lg"
          style={{ top: 0, paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)', paddingBottom: '8px' }}
        >
          <div className="px-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <i className="fas fa-flask text-sm shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-widest leading-tight">Simulação</p>
                <p className="text-[11px] leading-tight opacity-90">Nada foi salvo. O cliente não está vendo estas mudanças.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={descartarSimulacao}
                disabled={aplicandoSimulacao}
                className="px-3 py-2 rounded-xl bg-white/15 text-white text-[10px] font-black uppercase tracking-wider active:scale-95 disabled:opacity-50"
              >
                Descartar
              </button>
              <button
                onClick={aplicarSimulacao}
                disabled={aplicandoSimulacao}
                className="px-3 py-2 rounded-xl bg-white text-[#b07500] text-[10px] font-black uppercase tracking-wider active:scale-95 disabled:opacity-60"
              >
                {aplicandoSimulacao ? 'Salvando…' : 'Aplicar no plano'}
              </button>
            </div>
          </div>
        </div>
      )}

      {ofMigracaoAberta && (
        <div className="fixed inset-0 z-[320] flex items-center justify-center bg-black/75 backdrop-blur-sm p-6">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-[#f0fad0] flex items-center justify-center mb-4">
              <i className="fas fa-calendar-check text-xl text-[#7ab800]" />
            </div>
            <h3 className="text-[#1d1d1f] font-black text-lg leading-tight mb-2">
              Vamos recomeçar seu plano em {months[Math.max(0, months.findIndex(m => m.index === currentActualMonth && m.year === currentActualYear))]?.monthName ?? 'este mês'}?
            </h3>
            <p className="text-[#6e6e73] text-sm leading-relaxed mb-3">
              Seu banco agora manda os gastos sozinho. Como seu plano começou em{' '}
              <b className="text-[#1d1d1f]">{months[0]?.monthName} {months[0]?.year}</b>, as faturas antigas
              apareceriam em meses que você nunca categorizou — e os números ficariam confusos.
            </p>
            <div className="rounded-2xl bg-[#f5f5f7] p-3 mb-5 flex flex-col gap-2">
              <p className="text-[13px] text-[#1d1d1f] leading-snug">
                <i className="fas fa-envelope text-[#7ab800] mr-2" />
                Enviamos o resumo dos meses anteriores para o seu e-mail.
              </p>
              <p className="text-[13px] text-[#1d1d1f] leading-snug">
                <i className="fas fa-eraser text-[#7ab800] mr-2" />
                Esses meses saem do painel; do mês atual em diante fica tudo automático.
              </p>
            </div>
            <button
              onClick={migrarParaOF}
              disabled={ofMigrando}
              className="w-full py-3.5 rounded-2xl k-btn-lime font-black text-sm disabled:opacity-60"
            >
              {ofMigrando ? 'Preparando…' : 'Começar neste mês'}
            </button>
            <button
              onClick={() => {
                try { localStorage.setItem(`kashim_of_migracao_${householdId}`, 'recusada'); } catch { /* ok */ }
                setOfMigracaoAberta(false);
              }}
              disabled={ofMigrando}
              className="w-full py-3 mt-2 text-[#6e6e73] font-bold text-[13px]"
            >
              Manter meu histórico como está
            </button>
          </div>
        </div>
      )}

      {/* POR QUE O BANCO E O KASHIM MOSTRAM NÚMEROS DIFERENTES.
          O cliente olhava os dois e concluía que o app estava errado; na maioria
          das vezes a diferença é dinheiro já comprometido (Eduardo, 2026-09-23). */}
      {explicandoSaldo && saldoNoBanco && (() => {
        const s = monthlySummaries[mobileMonthIdx];
        const naFila = ofPendentes.reduce((soma, t) => soma + Math.abs(Number(t.amount) || 0), 0);
        const linhas = [
          { rotulo: 'Fatura do cartão que ainda vai vencer', valor: s?.totalCreditCard ?? 0,
            nota: 'Está na sua conta hoje, mas já tem dono' },
          { rotulo: 'Contas do mês ainda não pagas', valor: (s?.totalFixed ?? 0) + (s?.totalVariable ?? 0),
            nota: 'Previstas no seu plano, ainda não saíram' },
          { rotulo: 'Gastos esperando você categorizar', valor: naFila,
            nota: naFila > 0 ? `${ofPendentes.length} na fila do Extrato` : undefined },
        ].filter((l) => Math.abs(l.valor) >= 0.01);
        return (
          <div className="fixed inset-0 z-[310] flex items-end justify-center lg:items-center" onClick={() => setExplicandoSaldo(false)}>
            <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" />
            <div onClick={e => e.stopPropagation()} className="relative w-full max-w-md bg-white rounded-t-3xl lg:rounded-3xl p-5 pb-8 shadow-2xl">
              <div className="w-10 h-1 bg-[#e8e8ed] rounded-full mx-auto mb-4 lg:hidden" />
              <h3 className="text-[#1d1d1f] font-black text-lg leading-tight mb-1">Por que os números são diferentes</h3>
              <p className="text-[#6e6e73] text-[13px] leading-snug mb-4">
                Os dois estão certos, e medem coisas diferentes.
              </p>
              <div className="flex items-start justify-between gap-3 rounded-2xl bg-[#f5f5f7] px-4 py-3">
                <div>
                  <p className="text-[#1d1d1f] text-[13.5px] font-bold">No banco {saldoNoBanco.contas > 1 ? `(${saldoNoBanco.contas} contas)` : ''}</p>
                  <p className="text-[#aeaeb2] text-[11px]">Última leitura {tempoDesde(saldoNoBanco.lido)}</p>
                </div>
                <span className="shrink-0 font-black k-num text-[15px] text-[#1d1d1f]">{formatCurrency(saldoNoBanco.total)}</span>
              </div>
              <p className="mt-4 mb-1 text-[10px] font-black uppercase tracking-widest text-[#aeaeb2]">Desse dinheiro, já tem destino</p>
              <div className="flex flex-col">
                {linhas.map((l) => (
                  <div key={l.rotulo} className="flex items-start justify-between gap-3 border-b border-[#f0f0f0] py-2.5">
                    <div className="min-w-0">
                      <p className="text-[#1d1d1f] text-[13.5px] leading-snug">{l.rotulo}</p>
                      {l.nota && <p className="mt-0.5 text-[11px] leading-snug text-[#aeaeb2]">{l.nota}</p>}
                    </div>
                    <span className="shrink-0 font-black k-num text-[14px] text-[#1d1d1f]">{formatCurrency(l.valor)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-[12px] leading-snug text-[#6e6e73]">
                O saldo do banco é o que existe agora. O número grande do Kashim é o que <strong>sobra</strong> depois
                que tudo isso acontecer. O saldo é da última leitura do banco, que pode levar até 24h.
              </p>
              <button
                onClick={() => setExplicandoSaldo(false)}
                className="mt-4 w-full rounded-2xl bg-[#1d1d1f] py-3.5 text-sm font-black text-white active:opacity-80"
              >
                Entendi
              </button>
            </div>
          </div>
        );
      })()}

      {saiDaContaAberto && monthlySummaries[mobileMonthIdx] && (() => {
        const s = monthlySummaries[mobileMonthIdx];
        const mes = months[mobileMonthIdx];
        const linhas: Array<{ rotulo: string; valor: number; nota?: string; negativo?: boolean }> = [
          { rotulo: 'Fatura dos cartões que vencem no mês', valor: s.totalCreditCard },
          { rotulo: 'Contas fixas', valor: s.totalFixed },
          { rotulo: 'Contas variáveis', valor: s.totalVariable },
          { rotulo: 'Lazer e gastos pessoais', valor: s.totalLeisure },
          {
            rotulo: 'Já está dentro da fatura',
            valor: -s.jaNaFatura,
            nota: 'O que você paga no cartão não sai duas vezes da conta',
            negativo: true,
          },
        ];
        return (
          <div className="fixed inset-0 z-[310] flex items-end justify-center lg:items-center" onClick={() => setSaiDaContaAberto(false)}>
            <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" />
            <div
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-md bg-white rounded-t-3xl lg:rounded-3xl p-5 pb-8 shadow-2xl"
            >
              <div className="w-10 h-1 bg-[#e8e8ed] rounded-full mx-auto mb-4 lg:hidden" />
              <p className="text-[10px] font-black uppercase tracking-widest text-[#aeaeb2]">
                {mes?.monthName} {mes?.year}
              </p>
              <h3 className="text-[#1d1d1f] font-black text-lg leading-tight mb-1">
                {planoEmModoOF ? 'De onde vem o "sai da conta"' : 'De onde vêm os gastos'}
              </h3>
              <p className="text-[#6e6e73] text-[13px] leading-snug mb-4">
                É o dinheiro que sai da sua conta neste mês — não o que você consumiu. Compra no cartão sai
                quando a fatura vence.
              </p>
              <div className="flex flex-col">
                {linhas.filter(l => Math.abs(l.valor) >= 0.01).map(l => (
                  <div key={l.rotulo} className="flex items-start justify-between gap-3 py-2.5 border-b border-[#f0f0f0]">
                    <div className="min-w-0">
                      <p className="text-[#1d1d1f] text-[13.5px] leading-snug">{l.rotulo}</p>
                      {l.nota && <p className="text-[#aeaeb2] text-[11px] leading-snug mt-0.5">{l.nota}</p>}
                    </div>
                    <span className={`shrink-0 font-black k-num text-[14px] ${l.negativo ? 'text-[#7ab800]' : 'text-[#1d1d1f]'}`}>
                      {l.negativo ? '− ' : ''}{formatCurrency(Math.abs(l.valor))}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3 pt-3">
                  <p className="text-[#1d1d1f] font-black text-[14px] uppercase tracking-wide">Total</p>
                  <span className="font-black k-num text-[18px] text-[#ff3b30]">{formatCurrency(s.totalCost)}</span>
                </div>
              </div>
              <button
                onClick={() => setSaiDaContaAberto(false)}
                className="mt-5 w-full py-3 rounded-2xl bg-[#f5f5f7] text-[#1d1d1f] font-black text-sm active:scale-[0.98]"
              >
                Entendi
              </button>
            </div>
          </div>
        );
      })()}

      {/* Modal de unificação de contas (Modo Casal: dois solos querendo se unir) */}
      {showMergeModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-7 max-w-sm w-full flex flex-col gap-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-green-400/10 rounded-full flex items-center justify-center shrink-0">
                <i className="fas fa-user-friends text-green-400"></i>
              </div>
              <div>
                <h2 className="text-white font-black text-base uppercase italic tracking-tighter">Unificar contas</h2>
                <p className="text-zinc-500 text-[10px] uppercase tracking-widest">Modo Casal</p>
              </div>
            </div>

            <p className="text-zinc-300 text-sm leading-relaxed">
              Você já tem lançamentos na sua conta. Para entrar na conta do seu parceiro(a), seus dados serão <strong className="text-white">movidos para a conta compartilhada</strong>.
            </p>

            <ul className="flex flex-col gap-1.5">
              <li className="flex items-start gap-2 text-zinc-400 text-xs">
                <i className="fas fa-check text-green-400 mt-0.5 shrink-0"></i>
                Seus lançamentos vão para o plano compartilhado
              </li>
              <li className="flex items-start gap-2 text-zinc-400 text-xs">
                <i className="fas fa-check text-green-400 mt-0.5 shrink-0"></i>
                Os dois ficam com acesso à mesma conta
              </li>
              <li className="flex items-start gap-2 text-zinc-400 text-xs">
                <i className="fas fa-info-circle text-yellow-400 mt-0.5 shrink-0"></i>
                Sua conta individual será encerrada
              </li>
            </ul>

            {mergeError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl px-4 py-3 text-red-400 text-xs">
                <i className="fas fa-exclamation-circle mr-2"></i>{mergeError}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <button
                disabled={mergeLoading}
                onClick={async () => {
                  if (!mergeAuthToken) return;
                  setMergeLoading(true);
                  setMergeError(null);
                  try {
                    await confirmMergeInvite(mergeAuthToken);
                    if (user) localStorage.setItem(`onboarding_done_${user.id}`, 'true');
                    window.location.reload();
                  } catch (err: unknown) {
                    setMergeError(err instanceof Error ? err.message : 'Erro ao unificar contas. Tente novamente.');
                    setMergeLoading(false);
                  }
                }}
                className="w-full bg-green-500 active:bg-green-400 text-black font-black py-3 rounded-2xl text-sm uppercase tracking-wider disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {mergeLoading
                  ? <><i className="fas fa-circle-notch animate-spin"></i> Unificando...</>
                  : 'Unificar e entrar'}
              </button>
              <button
                disabled={mergeLoading}
                onClick={() => {
                  discardPendingInvite();
                  setShowMergeModal(false);
                  window.location.reload();
                }}
                className="w-full bg-zinc-800 active:bg-zinc-700 text-zinc-400 font-bold py-3 rounded-2xl text-sm disabled:opacity-50"
              >
                Cancelar — ficar na minha conta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Consentimento LGPD — precede qualquer outra coisa (wizard, tour, app) */}
      {needsTermsAcceptance && (
        <TermsGate onAccept={handleAcceptTerms} onSignOut={() => signOut()} />
      )}

      {/* Wizard NUNCA para admin/assistente nem na visão de coach: a
          assistente (admin por DB, que NÃO pula o loadData) tinha o wizard da
          própria conta vazia armado, e ele estourava POR CIMA do perfil do
          cliente ao entrar — e o completar gravaria na conta do CLIENTE
          (2026-07-16). */}
      {!needsTermsAcceptance && showOnboarding && user && !isAdmin && !coachViewHouseholdId && (
        <OnboardingWizard
          userName={user.firstName || user.emailAddresses[0]?.emailAddress.split('@')[0] || ''}
          onComplete={handleWizardComplete}
        />
      )}

      {/* Onboarding interativo: auto-inicia no 1º acesso de cada tela + botão de ajuda global */}
      {user && !isAdmin && (
        <OnboardingManager
          // O Extrato é overlay, não aba: sem isto o tour de Open Finance nunca
          // via a própria tela. O portão continua sendo o mesmo — `showExtrato`
          // só abre com hasOpenFinanceAccess, então quem não tem acesso jamais
          // chega em 'extrato'.
          screen={showExtrato && hasOpenFinanceAccess(user) ? 'extrato' : activeTab}
          db={db}
          userId={user.id}
          active={!needsTermsAcceptance && !showOnboarding && !showSubscriptionGate && !coachViewHouseholdId && !dbLoading && activeTab !== 'coach'}
          onRequestScreen={setActiveTab}
          onAiPrompt={handleTourAiPrompt}
          // Ter acesso nao basta: os passos so mudam para quem REALMENTE
          // conectou um banco. Quem esta na lista mas ainda lanca a mao
          // continua lendo as instrucoes de lancamento manual, que sao as
          // certas para ele.
          temOpenFinance={temBancoConectado}
        />
      )}

      {showQuoteModal && currentWeekQuote && (
        <MondayQuote
          quote={currentWeekQuote}
          onClose={() => {
            if (householdId) localStorage.setItem(`kashim_quote_shown_${householdId}_${getMondayKey()}`, '1');
            setShowQuoteModal(false);
          }}
        />
      )}


      {showSubscriptionGate && (
        <SubscriptionGate
          onClose={() => setShowSubscriptionGate(false)}
          isNative={isNativeApp}
          onSignOut={() => signOut()}
        />
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
            {/**
             * O consultor tem a própria folha de Configurações, sem as abas do
             * cliente — então o "Testar push" precisa existir aqui também. Posto
             * só no ClientSettings, ele ficava num lugar que o admin nunca vê
             * (Eduardo, 2026-09-10).
             */}
            {hasOpenFinanceAccess(user) && (
              <button
                onClick={async () => {
                  const { diagnosticoPush } = await import('./lib/push');
                  alert(`Diagnóstico de push:\n\n${await diagnosticoPush()}`);
                }}
                className="w-full mb-2 bg-zinc-800 border border-zinc-700 active:bg-zinc-700 text-zinc-300 font-black py-3 rounded-2xl transition-all text-xs uppercase flex items-center justify-center gap-2"
              >
                <i className="fas fa-bell"></i> Testar push
              </button>
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
            <p className="text-center text-zinc-700 text-[10px] mt-3">
              versão {typeof __BUILD_STAMP__ !== 'undefined' ? __BUILD_STAMP__ : '—'}
            </p>
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
          onNotifPrefsChange={() => setNotifPrefsVersion(v => v + 1)}
          onAbrirSuporte={() => { setShowSettings(false); setShowSuporte(true); }}
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
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full bg-transparent border border-zinc-800 active:bg-zinc-900 text-zinc-600 font-black py-3 rounded-2xl transition-all text-xs uppercase flex items-center justify-center gap-2"
            >
              <i className="fas fa-trash-alt"></i> Excluir minha conta
            </button>
            <button onClick={() => setShowSettings(false)} className="w-full mt-2 text-zinc-600 font-black py-2 text-xs uppercase">Fechar</button>
          </div>
        </div>
      ) : null}

      {/* Account deletion confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-6 bg-black/90 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-zinc-900 border border-red-500/20 rounded-3xl p-7">
            <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mb-5 border border-red-500/20">
              <i className="fas fa-trash-alt text-red-400 text-lg"></i>
            </div>
            <h3 className="text-white font-black text-lg uppercase mb-2">Excluir conta</h3>
            <p className="text-zinc-400 text-sm leading-relaxed mb-4">
              Todos os seus dados financeiros serão permanentemente apagados. Esta ação não pode ser desfeita.
            </p>
            {deleteError && (
              <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 mb-4">
                {deleteError}
              </p>
            )}
            <button
              disabled={deletingAccount}
              onClick={async () => {
                setDeletingAccount(true);
                setDeleteError(null);
                try {
                  await deleteUserAccount();
                  await signOut();
                } catch (err) {
                  setDeletingAccount(false);
                  setDeleteError(
                    err instanceof Error
                      ? `Erro: ${err.message}`
                      : 'Não foi possível excluir a conta. Contate kashimappbr@gmail.com'
                  );
                }
              }}
              className="w-full bg-red-500 active:bg-red-600 disabled:opacity-60 text-white font-black py-3.5 rounded-2xl text-sm uppercase mb-3 transition-all flex items-center justify-center gap-2"
            >
              {deletingAccount
                ? <><i className="fas fa-circle-notch animate-spin"></i> Excluindo...</>
                : 'Sim, excluir permanentemente'}
            </button>
            <button
              disabled={deletingAccount}
              onClick={() => { setShowDeleteConfirm(false); setDeleteError(null); }}
              className="w-full text-zinc-600 font-black py-2 text-xs uppercase disabled:opacity-40"
            >
              Cancelar
            </button>
          </div>
        </div>
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
            <InvitePartner db={db} householdId={householdId} currentUserId={user.id} inviterName={user.fullName ?? user.firstName ?? undefined} getToken={getToken} />
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
                disabled={reprojetando}
                className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black font-black py-4 rounded-2xl transition-all shadow-lg uppercase text-xs tracking-widest"
              >
                {reprojetando ? 'Salvando o plano… não feche' : 'Sim, Reprojetar e Baixar Backup'}
              </button>
              <button disabled={reprojetando} onClick={() => { setShowProjectionModal(false); setPendingStartMonth(null); }} className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-4 rounded-2xl transition-all uppercase text-[10px] tracking-widest">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── HEADER ─────────────────────────────────────────────── */}
      <header id="header" className="bg-white/90 backdrop-blur-xl safe-top sticky top-0 z-50 border-b border-[#e8e8ed]">

        {/* Mobile header — py mínimo: o `safe-top` do <header> já reserva o
            espaço do notch, e qualquer padding aqui se SOMA a ele. Era daí que
            vinha a faixa branca sobre o nome Kashim. */}
        <div className="lg:hidden flex items-center justify-between px-4 py-0.5">
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
              <button onClick={() => setShowInvitePanel(p => !p)} className="w-9 h-9 flex items-center justify-center text-[#aeaeb2] active:text-[#7ab800]">
                <i className="fas fa-user-plus text-base"></i>
              </button>
            )}
            {user?.imageUrl ? (
              <img src={user.imageUrl} className="w-8 h-8 rounded-full border border-[#e8e8ed] cursor-pointer" onClick={() => setShowSettings(true)} />
            ) : (
              <button onClick={() => setShowSettings(true)} className="w-9 h-9 flex items-center justify-center text-[#aeaeb2] active:text-[#7ab800]">
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
            <button onClick={() => setActiveTab('dividas')} className={`px-6 py-2 rounded-lg text-xs font-black uppercase transition-all ${activeTab === 'dividas' ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#6e6e73] hover:text-[#1d1d1f]'}`}>Dívidas</button>
            <button onClick={() => setActiveTab('desempenho')} className={`px-6 py-2 rounded-lg text-xs font-black uppercase transition-all ${activeTab === 'desempenho' ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#6e6e73] hover:text-[#1d1d1f]'}`}>Desempenho</button>
            {hasOpenFinanceAccess(user) && (
              <button onClick={async () => { const t = await getToken({ template: 'supabase' }); if (t) { setOfAuthToken(t); setShowExtrato(true); } }} className="px-6 py-2 rounded-lg text-xs font-black uppercase transition-all text-[#6e6e73] hover:text-[#1d1d1f] flex items-center gap-1.5"><i className="fas fa-university text-sm" />Extrato</button>
            )}
            {/* Stets é para todo mundo — não passa pelo portão de Open Finance.
                Reaberto em 2026-09-13, depois que a troca para a Maritaca
                derrubou o custo por mensagem. Verde permanente para destacar
                entre as abas; selecionado, ganha fundo sólido. */}
            <button
              onClick={() => irParaAba('coach')}
              className={`px-6 py-2 rounded-lg text-xs font-black uppercase transition-all flex items-center gap-1.5 ${
                activeTab === 'coach'
                  ? 'bg-[#7ab800] text-white shadow-sm'
                  : 'text-[#7ab800] hover:bg-[#f0fad0]'
              }`}
            >
              <i className={`fas fa-bolt text-sm ${activeTab === 'coach' ? '' : 'k-glow-lime'}`} />Stets
            </button>
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
            {/* Sino de chamados — só para o admin. Vermelho quando há chamado
                em aberto; some quando tudo estiver respondido ou resolvido. */}
            {isAdmin && (
              <button
                onClick={() => setShowSuporteAdmin(true)}
                className="relative px-3 py-2 text-[#aeaeb2] hover:text-[#7ab800] transition-colors"
                title={chamadosAbertos > 0 ? `${chamadosAbertos} chamado(s) em aberto` : 'Chamados de suporte'}
              >
                <i className={`fas fa-bell ${chamadosAbertos > 0 ? 'text-red-500' : ''}`}></i>
                {chamadosAbertos > 0 && (
                  <span
                    className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center border-2 border-white"
                    style={{ animation: 'kashimPulse 2s ease-in-out infinite' }}
                  >
                    {chamadosAbertos > 9 ? '9+' : chamadosAbertos}
                  </span>
                )}
              </button>
            )}
            <button onClick={() => signOut()} className="px-3 py-2 text-[#aeaeb2] hover:text-red-500 transition-colors"><i className="fas fa-sign-out-alt"></i></button>
          </div>
        </div>
      </header>


      {/* ── CONTADOR DO TRIAL DE LANÇAMENTO ─────────────────────── */}
      {/* Oculto no app nativo: no iOS o acesso é gratuito e ilimitado, então
          falar em "acesso grátis terminando" implicaria uma assinatura que não
          existe ali (Apple 3.1.1). */}
      {/* daysLeft === null = cliente da consultoria sem contagem regressiva
          (acesso vale enquanto o coach não revogar) → nada de banner. */}
      {accessInfo && !isNativeApp && !coachViewHouseholdId && !isAdmin
        && (accessInfo.mode === 'expired' || (accessInfo.mode === 'trial' && accessInfo.daysLeft !== null)) && (
        /* A partir de 14 dias o aviso deixa de ser tarja e vira faixa com
           chamada — a contagem regressiva discreta passava despercebida e o
           cliente só descobria o fim do acesso quando já estava bloqueado. */
        (() => {
          const dias = accessInfo.daysLeft ?? 0;
          // 30 dias de antecedência: prazo para o cliente se organizar ou
          // falar com o coach antes de perder o acesso.
          const urgente = accessInfo.mode === 'expired' || dias <= 30;
          return (
            <div className={`px-4 ${urgente ? 'py-3' : 'py-2'} ${
              accessInfo.mode === 'expired'
                ? 'bg-[#fff0f0] border-b border-[#ffd4d1]'
                : dias <= 30
                  ? 'bg-orange-50 border-b border-orange-200'
                  : 'bg-[#f0fad0]'
            }`}>
              <div className={`max-w-3xl mx-auto flex items-center justify-center gap-2.5 flex-wrap ${
                accessInfo.mode === 'expired' ? 'text-[#ff3b30]' : dias <= 30 ? 'text-orange-700' : 'text-[#7ab800]'
              }`}>
                <i className={`fas ${accessInfo.mode === 'expired' ? 'fa-lock' : 'fa-gift'} ${urgente ? 'text-base' : 'text-xs'}`}></i>
                <span className={`font-black ${urgente ? 'text-sm' : 'text-[11px] uppercase tracking-wide'}`}>
                  {accessInfo.mode === 'expired'
                    ? 'Seu acesso terminou — regularize para continuar usando'
                    : dias <= 30
                      ? `Faltam ${dias} ${dias === 1 ? 'dia' : 'dias'} de acesso. Regularize seu plano para não perder seus dados de vista.`
                      : `Acesso de lançamento — ${dias} dias grátis restantes`}
                </span>
                {urgente && !isNativeApp && (
                  <button
                    onClick={() => setShowSubscriptionGate(true)}
                    className={`font-black text-xs uppercase tracking-wide px-4 py-1.5 rounded-full transition-all active:scale-95 ${
                      accessInfo.mode === 'expired' ? 'bg-[#ff3b30] text-white' : 'bg-orange-600 text-white'
                    }`}
                  >
                    Regularizar
                  </button>
                )}
              </div>
            </div>
          );
        })()
      )}

      <main key={activeTab} className={`k-reveal ${activeTab === 'plan' ? 'max-w-[1600px]' : 'w-full px-2'} mx-auto px-2 lg:px-8 mt-2 lg:mt-8`} style={(activeTab === 'desempenho' || activeTab === 'metas') ? { maxWidth: '100%' } : {}}>
        {/* O que o Kashim lançou sozinho, na tela principal e não escondido no
            Extrato. O cliente precisa saber que a fila encolheu porque o app
            agiu — e poder conferir, porque palpite automático erra. */}
        {(() => {
          const naoConferidas = autoCategorizadas.filter(t => !autoConferidas.has(t.id));
          if (naoConferidas.length === 0 || autoAvisoFechado || dbLoading) return null;
          /**
           * Confirmou, sumiu. Ponto.
           *
           * Tentei manter a linha na tela marcada como "conferido" para dar
           * segurança, e o efeito foi o oposto: o Eduardo confirmou e viu os
           * mesmos gastos de novo, achando que o app ignorou (2026-09-20).
           */
          const daLeva = naoConferidas;
          const abrirExtrato = async () => {
            const tk = await getToken({ template: 'supabase' });
            if (tk) { setOfAuthToken(tk); setShowExtrato(true); }
          };
          return (
          <div className="mb-3 bg-[#f0fad0] border border-[rgba(122,184,0,0.35)] rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-[#7ab800] flex items-center justify-center shrink-0">
                <i className="fas fa-wand-magic-sparkles text-white text-xs" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[#1d1d1f] font-black text-sm">
                  O Kashim lançou {naoConferidas.length} gasto{naoConferidas.length === 1 ? '' : 's'} por você
                </p>
                <p className="text-[#6e6e73] text-xs mt-0.5 mb-2">
                  {naoConferidas.length === 1 ? 'É um lugar' : 'São lugares'} que você já categorizou antes. Confira um por um.
                </p>
                {/* Uma decisão por gasto: concordar com um e discordar do outro
                    era impossível com os botões só no rodapé (Eduardo, 2026-09-20). */}
                <div className="space-y-1.5 mb-2.5">
                  {daLeva.slice(0, 6).map((t) => (
                    <div key={t.id} className="flex items-center gap-2 text-xs rounded-xl px-2.5 py-2 bg-white/70">
                      <div className="flex-1 min-w-0">
                        <p className="text-[#1d1d1f] truncate font-bold">{t.descricao}</p>
                        {/* ONDE entrou, não só a categoria: "Conta Fixa" não diz
                            em qual conta o gasto caiu (Eduardo, 2026-09-20). */}
                        <p className="text-[#6e6e73] text-[11px] truncate">
                          {t.linha ? `${t.categoria} · ${t.linha}` : t.categoria}
                        </p>
                      </div>
                      <span className="text-[#1d1d1f] font-black shrink-0 tabular-nums">
                        R$ {t.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                      <button
                        onClick={() => marcarConferidas([t.id])}
                        title="Está certo"
                        className="shrink-0 w-7 h-7 rounded-lg bg-[#7ab800] text-white flex items-center justify-center active:scale-95"
                      >
                        <i className="fas fa-check text-[11px]" />
                      </button>
                      <button
                        onClick={abrirExtrato}
                        title="Corrigir no Extrato"
                        className="shrink-0 w-7 h-7 rounded-lg bg-white border border-[#e8e8ed] text-[#6e6e73] flex items-center justify-center active:scale-95"
                      >
                        <i className="fas fa-pen text-[10px]" />
                      </button>
                    </div>
                  ))}
                  {daLeva.length > 6 && (
                    <p className="text-[#6e6e73] text-[11px]">e mais {daLeva.length - 6}…</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={abrirExtrato}
                    className="px-3 py-1.5 rounded-lg bg-[#7ab800] text-white text-[11px] font-black uppercase tracking-wide active:scale-95 transition-transform"
                  >
                    Revisar no Extrato
                  </button>
                  <button
                    onClick={() => marcarConferidas(naoConferidas.map(t => t.id))}
                    className="px-3 py-1.5 rounded-lg text-[#6e6e73] text-[11px] font-black uppercase tracking-wide"
                  >
                    Está tudo certo
                  </button>
                </div>
              </div>
            </div>
          </div>
          );
        })()}

        {/* Enquanto os lançamentos não chegaram, NÃO mostrar número nenhum.
            Com os dados pela metade o saldo aparecia errado — o Eduardo abriu o
            app e leu -R$7.000 onde havia +R$1.900, e só depois de ~20s o valor
            se corrigiu sozinho (2026-09-14). Número errado com cara de certo é
            pior que número nenhum: o cliente acredita nele. */}
        {dbLoading && items.length === 0 && activeTab !== 'coach' ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="relative">
              <div className="absolute inset-0 scale-150 rounded-2xl bg-[#7ab800]/15 blur-xl" />
              <div className="relative w-14 h-14 rounded-2xl bg-[#7ab800] flex items-center justify-center shadow-lg">
                <i className="fas fa-circle-notch fa-spin text-[#182200] text-xl" />
              </div>
            </div>
            <div className="text-center">
              <p className="text-[#1d1d1f] font-black text-sm">Carregando seus dados</p>
              <p className="text-[#6e6e73] text-xs mt-1">Buscando seus lançamentos no servidor...</p>
            </div>
          </div>
        ) : activeTab === 'coach' ? (
          <div className="h-[calc(100dvh-210px)] lg:h-[calc(100dvh-140px)]">
            <CoachChat
              getToken={() => getToken({ template: 'supabase' })}
              householdId={householdId}
              summary={monthlySummaries[mobileMonthIdx]}
              summaries={monthlySummaries}
              monthNames={months.map(m => m.monthName)}
              currentMonthIdx={mobileMonthIdx}
              perguntaInicial={stetsPerguntaInicial}
              onPerguntaConsumida={() => setStetsPerguntaInicial('')}
            />
          </div>
        ) : activeTab === 'desempenho' ? (
          <Desempenho summary={monthlySummaries[mobileMonthIdx]} summaries={monthlySummaries.slice(0, mobileMonthIdx + 1)} items={items} goals={goals} monthIdx={mobileMonthIdx} />
        ) : activeTab === 'metas' ? (
          <Metas goals={goals} onGoalsChange={handleGoalsChange} db={db} householdId={householdId} />
        ) : activeTab === 'dividas' ? (
          <Dividas householdId={householdId} />
        ) : activeTab === 'plan' ? (
          <>
            {/* Em modo Open Finance o card de lançar dá lugar ao convite do
                Stets: quem conectou o banco não precisa digitar gasto, e o
                topo da tela deve puxar para a dúvida, não para o teclado. */}
            {planoEmModoOF ? (
              <div id="stets">
                <StetsConvite onAbrir={(pergunta) => {
                  setStetsPerguntaInicial(pergunta ?? '');
                  setActiveTab('coach');
                }} />
              </div>
            ) : (
              <div id="stets"><AICoach summary={monthlySummaries[mobileMonthIdx]} items={items} monthName={months[mobileMonthIdx].monthName} onExpenseDetected={handleExpenseDetected} tetoColumns={tetoColumns} /></div>
            )}
            {/* Web: diagnóstico inline (tem espaço). Celular: botão que abre em
                pop-up, para não empurrar as contas do mês pra baixo. */}
            <div id="diagnosis" className="hidden lg:block">
              <Diagnosis summary={monthlySummaries[mobileMonthIdx]} items={items} monthIdx={mobileMonthIdx} monthName={months[mobileMonthIdx].monthName} isCurrentMonth={months[mobileMonthIdx].index === currentActualMonth && months[mobileMonthIdx].year === currentActualYear} />
            </div>

            {/* A margem negativa existia para encostar no card antigo, que tinha
                folga embaixo. Com o convite do Stets no lugar, ela passou a
                sobrepor o card — some quando ele está na tela. */}
            <div className={`lg:hidden px-1 mb-3 ${planoEmModoOF ? '' : '-mt-5'}`}>
              <button
                onClick={() => setShowDiagnosis(true)}
                className="group w-full flex items-center gap-3 rounded-2xl px-5 py-4 text-left active:scale-[.99] transition-all"
                style={{ background: 'linear-gradient(135deg,#2f6d1a 0%,#5aa515 45%,#7cc11a 100%)', boxShadow: '0 8px 22px -8px rgba(124,193,26,.6)' }}
              >
                <span className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                  <i className="fas fa-heart-pulse text-white text-xl"></i>
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-white font-black text-[15px] leading-tight uppercase italic tracking-tight">Ver meu diagnóstico do mês</span>
                  <span className="block text-white/85 text-[12px] font-semibold mt-0.5">Toque para o raio-X das suas finanças</span>
                </span>
                <i className="fas fa-arrow-right text-white text-lg group-active:translate-x-0.5 transition-transform"></i>
              </button>
            </div>

            {showDiagnosis && (
              <div className="lg:hidden fixed inset-0 z-[300] bg-black/60 backdrop-blur-sm flex flex-col">
                {/* Header escuro temático — combina com o hero do próprio Diagnosis */}
                {/* O cabeçalho começava colado no topo e o X ficava debaixo da
                    barra de status do iPhone — só dava para fechar deitando o
                    telefone (Eduardo, 2026-09-21). A área segura resolve. */}
                <div
                  className="flex items-center justify-between px-5 pb-4 shrink-0"
                  style={{
                    background: 'linear-gradient(160deg,#0d1f07 0%,#152f0a 100%)',
                    borderBottom: '1px solid rgba(255,255,255,.08)',
                    paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: 'rgba(74,222,128,.15)' }}>
                      <i className="fas fa-heart-pulse text-green-400 text-[15px]"></i>
                    </span>
                    <div>
                      <div className="font-black uppercase text-[13px] tracking-widest text-white leading-none">Diagnóstico</div>
                      <div className="text-[10px] font-semibold tracking-wide mt-0.5" style={{ color: 'rgba(74,222,128,.7)' }}>metodologia Kashim</div>
                    </div>
                  </div>
                  <button onClick={() => setShowDiagnosis(false)}
                    className="w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                    style={{ background: 'rgba(255,255,255,.1)', color: 'rgba(255,255,255,.75)' }}>
                    <i className="fas fa-times text-sm"></i>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-3 bg-zinc-50">
                  <Diagnosis summary={monthlySummaries[mobileMonthIdx]} items={items} monthIdx={mobileMonthIdx} monthName={months[mobileMonthIdx].monthName} isCurrentMonth={months[mobileMonthIdx].index === currentActualMonth && months[mobileMonthIdx].year === currentActualYear} />
                </div>
              </div>
            )}

            {/* ── MOBILE SUMMARY CARDS ──────────────────────────────── */}
            {/* Hero dark card — Acumulado */}
            <div id="summary-mobile" className="lg:hidden px-3 mb-3">
              <div
                ref={acumTilt.ref}
                onPointerMove={acumTilt.onPointerMove}
                onPointerLeave={acumTilt.onPointerLeave}
                className="bg-[#1d1d1f] rounded-[24px] p-5 relative overflow-hidden"
                style={{transition:'transform .3s cubic-bezier(.16,1,.3,1)', willChange:'transform'}}
              >
                <div className="absolute top-[-50px] right-[-30px] w-[180px] h-[180px] rounded-full pointer-events-none" style={{background:'radial-gradient(circle,rgba(168,231,22,0.18) 0%,transparent 65%)'}}></div>
                {/* Pointer-following neon glow (decorative) */}
                <div className="absolute inset-0 pointer-events-none z-0" style={{background:'radial-gradient(240px circle at var(--k-gx,50%) var(--k-gy,50%), rgba(168,231,22,0.16), transparent 60%)', transition:'background .2s'}}></div>
                <div className="relative z-10">
                  {/* "Acumulado" não dizia acumulado do quê — a Mariane leu como
                      acumulado de contas (2026-09-20). O rótulo agora diz o que o
                      número é, e muda de acordo com o sinal. */}
                  <div className="text-[10px] font-bold uppercase tracking-[2px] text-white/40 mb-1">
                    {monthlySummaries[mobileMonthIdx].accumulated >= 0 ? 'Dinheiro guardado até aqui' : 'Faltou até aqui'}
                  </div>
                  <div className="text-white font-black k-num" style={{fontSize:'36px',letterSpacing:'-0.04em',lineHeight:1}}>
                    <MoneyCountUp value={monthlySummaries[mobileMonthIdx].accumulated} />
                  </div>
                  <div className="text-white/30 text-[11px] mt-2">
                    {months[mobileMonthIdx].monthName} {months[mobileMonthIdx].year}
                  </div>
                  {planoEmModoOF && (
                    <div className="mt-2 flex items-center gap-1.5 text-white/35 text-[10px]">
                      <i className="fas fa-sync-alt text-[8px]"></i>
                      {/* NÃO é o saldo do banco: é a conta do plano (entradas −
                          saídas). Dizer "atualizado pelo seu banco" fazia o
                          cliente esperar o número da conta dele e não bater
                          (Eduardo, 2026-09-23). */}
                      <span>Os lançamentos vêm do seu banco; a sobra é a conta do seu plano</span>
                    </div>
                  )}

                  {/* O FATO, ao lado da conta do plano: é o número que o cliente
                      compara com o app do banco. Tocando, ele vê por que os dois
                      não são iguais, em vez de concluir que o app está errado
                      (Eduardo, 2026-09-23). */}
                  {planoEmModoOF && saldoNoBanco && (
                    <button
                      onClick={() => setExplicandoSaldo(true)}
                      className="mt-3 flex w-full items-center gap-2 rounded-2xl bg-white/8 px-3 py-2.5 text-left active:bg-white/12"
                    >
                      <i className="fas fa-building-columns text-[10px] text-white/40" />
                      <span className="text-[11px] text-white/50">No banco hoje</span>
                      <span className="flex-1 text-right text-[13px] font-black text-white k-num">
                        {formatCurrency(saldoNoBanco.total)}
                      </span>
                      <span className="text-[10px] text-white/35">{tempoDesde(saldoNoBanco.lido)}</span>
                      <i className="fas fa-circle-info text-[10px] text-white/40" />
                    </button>
                  )}

                  {/* De onde vem o acumulado.
                      Sem isto a tela mostra dois negativos diferentes — o card
                      diz -600,97 e o Sobra/Falta diz -4.101,08 — e o que
                      explica a diferença (o guardado dos meses anteriores) não
                      aparece em lugar nenhum. Só na web dava para deduzir. */}
                  {(() => {
                    const s = monthlySummaries[mobileMonthIdx];
                    const anterior = s.accumulated - s.balance;
                    if (Math.abs(anterior) < 0.01) return null;
                    const salvou = anterior > 0 && s.balance < 0;
                    return (
                      <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-2 flex-wrap text-[11px]">
                        <span className="text-white/45">
                          {anterior > 0 ? 'Guardado até aqui' : 'Vinha devendo'}
                        </span>
                        <span className={`k-num font-bold ${anterior > 0 ? 'text-[#a8e716]' : 'text-[#ff6b6b]'}`}>
                          {formatCurrency(anterior)}
                        </span>
                        <span className="text-white/25">·</span>
                        <span className="text-white/45">{s.balance >= 0 ? 'sobrou este mês' : 'faltou este mês'}</span>
                        <span className={`k-num font-bold ${s.balance >= 0 ? 'text-[#a8e716]' : 'text-[#ff6b6b]'}`}>
                          {formatCurrency(Math.abs(s.balance))}
                        </span>
                        {salvou && (
                          <span className="w-full text-white/50 mt-1 leading-snug">
                            O que você guardou antes está segurando o mês.
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
            <div className="lg:hidden k-stagger grid grid-cols-3 gap-2 px-3 mb-3">
              <div className="bg-white border border-[#e8e8ed] rounded-[18px] p-3 overflow-hidden shadow-sm">
                <div className="text-[7px] font-black uppercase text-[#aeaeb2] tracking-widest mb-1">Entradas</div>
                <div className="text-[#34c759] font-black k-num text-xs leading-tight truncate"><MoneyCountUp value={monthlySummaries[mobileMonthIdx].totalIncome} duration={900} /></div>
              </div>
              {/* O número é o que SAI DA CONTA no mês (fatura que vence + contas
                  fora do cartão), não o que foi consumido. Com Open Finance a
                  fatura real entra inteira e "Gastos" fazia a pessoa achar que
                  tinha gastado R$12 mil num mês de R$7 mil de plano (Mariane,
                  2026-09-17). Tocar abre a conta aberta: número grande sem
                  explicação vira desconfiança. */}
              <button
                onClick={() => setSaiDaContaAberto(true)}
                className="bg-white border border-[#e8e8ed] rounded-[18px] p-3 overflow-hidden shadow-sm text-left active:scale-[0.98] transition-transform"
              >
                <div className="text-[7px] font-black uppercase text-[#aeaeb2] tracking-widest mb-1 flex items-center gap-1">
                  {planoEmModoOF ? 'Sai da conta' : 'Gastos'}
                  <i className="fas fa-circle-info text-[7px] opacity-60" />
                </div>
                <div className="text-[#ff3b30] font-black k-num text-xs leading-tight truncate"><MoneyCountUp value={monthlySummaries[mobileMonthIdx].totalCost} duration={900} /></div>
              </button>
              <div className={`border rounded-[18px] p-3 overflow-hidden shadow-sm ${monthlySummaries[mobileMonthIdx].balance >= 0 ? 'bg-[#f0fad0] border-[rgba(122,184,0,0.25)]' : 'bg-[#fff0f0] border-[rgba(255,59,48,0.2)]'}`}>
                <div className="text-[7px] font-black uppercase tracking-widest mb-1 text-[#aeaeb2]">Sobra/Falta</div>
                <div className={`font-black k-num text-xs leading-tight truncate ${monthlySummaries[mobileMonthIdx].balance >= 0 ? 'text-[#7ab800]' : 'text-[#ff3b30] animate-pulse'}`}><MoneyCountUp value={monthlySummaries[mobileMonthIdx].balance} duration={900} /></div>
              </div>
            </div>

            {/* ── MOBILE MONTH NAVIGATOR ── */}
            <div id="month-navigator" className="lg:hidden bg-white border border-[#e8e8ed] rounded-[18px] mx-3 mb-3 shadow-sm">
              <div className="flex items-center justify-between px-3 py-3">
                <button onClick={() => setMobileMonthIdx(i => Math.max(0, i - 1))} disabled={mobileMonthIdx === 0} className="w-9 h-9 flex items-center justify-center text-[#aeaeb2] disabled:opacity-20 active:text-[#7ab800] rounded-xl">
                  <i className="fas fa-chevron-left text-sm"></i>
                </button>
                <div className="text-center">
                  <div className="text-[#1d1d1f] font-black uppercase tracking-tight text-base">{months[mobileMonthIdx].monthName} {months[mobileMonthIdx].year}</div>
                  {months[mobileMonthIdx].index === currentActualMonth && months[mobileMonthIdx].year === currentActualYear && <div className="text-[#7ab800] text-[9px] font-black uppercase tracking-widest mt-0.5">Mês atual</div>}
                </div>
                <button onClick={() => setMobileMonthIdx(i => Math.min(11, i + 1))} disabled={mobileMonthIdx === 11} className="w-9 h-9 flex items-center justify-center text-[#aeaeb2] disabled:opacity-20 active:text-[#7ab800] rounded-xl">
                  <i className="fas fa-chevron-right text-sm"></i>
                </button>
              </div>
              <div className="flex justify-center gap-1.5 pb-3">
                {months.map((_, i) => (
                  <button key={i} onClick={() => setMobileMonthIdx(i)} className={`rounded-full transition-all ${i === mobileMonthIdx ? 'w-4 h-1.5 bg-[#a8e716]' : 'w-1.5 h-1.5 bg-[#e8e8ed]'}`} />
                ))}
              </div>
            </div>

            {isAdmin && !isNativeApp && (
              <div id="coach-pdf-btn" className="px-3 mb-4 flex justify-end gap-2 flex-wrap">
                {coachViewHouseholdId && (
                  <>
                    {/* Badge de vínculo com agendamentos */}
                    {agendLink !== null && (
                      <button
                        onClick={() => setShowLinkModal(true)}
                        className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide rounded-xl px-3 py-2.5 transition-all ${
                          agendLink === false
                            ? 'text-amber-900 bg-amber-100 border border-amber-300 hover:bg-amber-200'
                            : 'text-green-900 bg-green-100 border border-green-300 hover:bg-green-200'
                        }`}
                        title={agendLink === false ? 'Vincular ao sistema de agendamentos' : `Vinculado a: ${agendLink.name} — clique para alterar`}
                      >
                        <i className={`fas ${agendLink === false ? 'fa-calendar-xmark text-amber-600' : 'fa-calendar-check text-green-600'}`}></i>
                        {agendLink === false ? 'Vincular agendamento' : agendLink.name}
                      </button>
                    )}
                    <button
                      onClick={openConsultRecords}
                      className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wide text-zinc-300 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 active:scale-95 transition-all shadow-sm hover:bg-zinc-800"
                      title="Registros imutáveis das consultorias deste cliente — reabra o raio-X de qualquer data"
                    >
                      <i className="fas fa-folder-open text-zinc-400"></i> Registros
                    </button>
                    <button
                      onClick={handleRegisterConsultation}
                      disabled={registeringConsult}
                      className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wide text-black bg-green-500 rounded-xl px-4 py-2.5 active:scale-95 transition-all shadow-sm hover:bg-green-400 disabled:opacity-50"
                      title="Grava o retrato de hoje de forma permanente e envia cópia por e-mail ao cliente (comprovante da consultoria)"
                    >
                      {registeringConsult
                        ? <i className="fas fa-circle-notch animate-spin"></i>
                        : <i className="fas fa-stamp"></i>} Registrar consultoria
                    </button>
                  </>
                )}
                <button
                  onClick={handleGeneratePDF}
                  className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wide text-white bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 active:scale-95 transition-all shadow-sm hover:bg-zinc-800"
                  title="Gera PDF do cenário completo (Gastos Mensais + Compilação Financeira) — só visível para o coach"
                >
                  <i className="fas fa-file-pdf text-[#ff3b30]"></i> Gerar PDF da consultoria
                </button>
              </div>
            )}

            {/* Modal de vinculação ao sistema de agendamentos */}
            {showLinkModal && (
              <div className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setShowLinkModal(false); setLinkSearch(''); }}>
                <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-4 flex-shrink-0">
                    <div>
                      <h3 className="text-white font-black uppercase italic tracking-tight">Vincular ao Agendamento</h3>
                      <p className="text-zinc-400 text-[11px] mt-0.5">Selecione quem é <strong className="text-white">{coachViewClientName}</strong> no sistema de agendamentos</p>
                    </div>
                    <button onClick={() => { setShowLinkModal(false); setLinkSearch(''); }} className="w-8 h-8 bg-zinc-800 rounded-full text-zinc-400 hover:text-white flex items-center justify-center">
                      <i className="fas fa-times"></i>
                    </button>
                  </div>

                  {/* Busca */}
                  <div className="relative mb-3 flex-shrink-0">
                    <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-xs"></i>
                    <input
                      type="text"
                      placeholder="Buscar por nome..."
                      value={linkSearch}
                      onChange={e => setLinkSearch(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl pl-8 pr-4 py-2 text-white text-sm placeholder:text-zinc-500 focus:outline-none focus:border-green-500"
                      autoFocus
                    />
                  </div>

                  {/* Lista de clientes do agendamentos */}
                  <div className="overflow-y-auto flex-1 space-y-1">
                    {agendAllClients.length === 0 ? (
                      <p className="text-zinc-500 text-sm text-center py-6">Nenhum cliente encontrado no agendamento.<br/><span className="text-zinc-600 text-xs">Verifique as env vars AGENDAMENTOS_*</span></p>
                    ) : (
                      agendAllClients
                        .filter(c => c.name.toLowerCase().includes(linkSearch.toLowerCase()))
                        .map(c => {
                          const isSelected = agendLink !== false && agendLink !== null && agendLink.id === c.id;
                          return (
                            <button
                              key={c.id}
                              disabled={savingLink}
                              onClick={async () => {
                                setSavingLink(true);
                                try {
                                  const token = await getToken({ template: 'supabase' });
                                  const r = await fetch('/api/agendamentos-link', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                    body: JSON.stringify({ householdId: coachViewHouseholdId, agendamentosClientId: c.id }),
                                  });
                                  if (r.ok) {
                                    setAgendLink({ id: c.id, name: c.name });
                                    setShowLinkModal(false);
                                    setLinkSearch('');
                                  } else {
                                    alert('Erro ao salvar vínculo');
                                  }
                                } catch { alert('Erro de conexão'); }
                                finally { setSavingLink(false); }
                              }}
                              className={`w-full text-left rounded-2xl px-4 py-3 transition-colors border ${
                                isSelected
                                  ? 'bg-green-500/20 border-green-500/40 hover:bg-green-500/30'
                                  : 'bg-zinc-800/60 border-zinc-700 hover:bg-zinc-800'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className={`font-bold text-sm ${isSelected ? 'text-green-400' : 'text-white'}`}>
                                  {isSelected && <i className="fas fa-check-circle text-green-400 mr-2"></i>}
                                  {c.name}
                                </span>
                                {c.phoneDigits && <span className="text-zinc-500 text-[11px] font-mono">{c.phoneDigits}</span>}
                              </div>
                              {c.startMonthYear && (
                                <p className="text-zinc-600 text-[10px] mt-0.5">Início: {c.startMonthYear}</p>
                              )}
                            </button>
                          );
                        })
                    )}
                  </div>

                  {/* Remover vínculo */}
                  {agendLink !== false && agendLink !== null && (
                    <button
                      disabled={savingLink}
                      onClick={async () => {
                        setSavingLink(true);
                        try {
                          const token = await getToken({ template: 'supabase' });
                          const r = await fetch('/api/agendamentos-link', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                            body: JSON.stringify({ householdId: coachViewHouseholdId, agendamentosClientId: null }),
                          });
                          if (r.ok) { setAgendLink(false); setShowLinkModal(false); setLinkSearch(''); }
                          else alert('Erro ao remover vínculo');
                        } catch { alert('Erro de conexão'); }
                        finally { setSavingLink(false); }
                      }}
                      className="mt-3 w-full text-[11px] font-black uppercase tracking-wide text-zinc-500 hover:text-red-400 py-2 transition-colors flex-shrink-0"
                    >
                      <i className="fas fa-link-slash mr-1"></i> Remover vínculo
                    </button>
                  )}
                </div>
              </div>
            )}

            {showRecordsModal && (
              <div className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowRecordsModal(false)}>
                <div className="max-w-lg w-full bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-white font-black uppercase italic tracking-tight">Registros — {coachViewClientName}</h3>
                    <button onClick={() => setShowRecordsModal(false)} className="w-8 h-8 bg-zinc-800 rounded-full text-zinc-400 hover:text-white">
                      <i className="fas fa-times"></i>
                    </button>
                  </div>
                  {consultRecords === null ? (
                    <div className="text-center py-10"><i className="fas fa-circle-notch animate-spin text-green-400 text-2xl"></i></div>
                  ) : consultRecords.length === 0 ? (
                    <p className="text-zinc-500 text-sm text-center py-8">Nenhuma consultoria registrada ainda.<br/>Use "Registrar consultoria" ao fim da reunião.</p>
                  ) : (
                    <div className="space-y-2">
                      {consultRecords.map(r => (
                        <button
                          key={r.id}
                          onClick={() => openRaioXWindow(buildRaioXHtml(
                            r.snapshot,
                            new Date(r.created_at).toLocaleDateString('pt-BR'),
                            `Registro imutável da consultoria de ${new Date(r.created_at).toLocaleString('pt-BR')} · Integridade SHA-256: ${r.content_hash}`
                          ))}
                          className="w-full text-left bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-3 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-white text-sm font-bold">
                              <i className="fas fa-file-shield text-green-400 mr-2"></i>
                              {new Date(r.created_at).toLocaleDateString('pt-BR')} às {new Date(r.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span className="text-zinc-500 text-[10px] uppercase font-black">Abrir PDF</span>
                          </div>
                          <p className="text-zinc-500 text-[11px] mt-1 truncate">
                            {r.email_sent_to ? `Cópia enviada: ${r.email_sent_to}` : 'Sem e-mail de cópia'} · hash {r.content_hash.slice(0, 12)}…
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div id="blocks" className="k-stagger">
              {[
                { title: "ENTRADAS (Rendas)", type: CategoryType.INCOME },
                { title: "FATURAS DE CARTÃO", type: CategoryType.CREDIT_CARD },
                { title: "CONTAS FIXAS", subtitle: "Recorrentes ou > 12 parcelas", type: CategoryType.FIXED_EXPENSE },
                { title: "CONTAS VARIÁVEIS", type: CategoryType.VARIABLE_EXPENSE },
                { title: "LAZER E GASTOS PESSOAIS", type: CategoryType.PERSONAL_LEISURE }
              ].map(block => (
                <React.Fragment key={block.type}>
                {isAdmin && !isNativeApp && block.type === CategoryType.FIXED_EXPENSE && (
                  <div className="px-3 mb-2 flex justify-end">
                    <button
                      onClick={handleDeleteBlankFixed}
                      className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wide text-[#ff3b30] bg-[#fff0f0] border border-[rgba(255,59,48,0.25)] rounded-xl px-3 py-2 active:scale-95 transition-all"
                      title="Remove só as contas fixas 100% em branco — zeradas em TODOS os meses (visível só para o coach)"
                    >
                      <i className="fas fa-broom text-xs"></i> Limpar contas fixas em branco
                    </button>
                  </div>
                )}
                <BlockSection
                  title={block.title} subtitle={block.subtitle} category={block.type}
                  items={items.filter(i => i.category === block.type)} allCards={allCards} months={months}
                  // Ideal (55/10/15%) SEMPRE sobre a renda do mês vigente, não do
                  // 1º mês do plano. mobileMonthIdx já salta para o mês atual no
                  // load, então ideal e realizado ficam no mesmo mês.
                  totalIncome={(monthlySummaries[mobileMonthIdx] ?? monthlySummaries[0]).totalIncome}
                  mobileMonthIdx={mobileMonthIdx}
                  // Tocar no "Realizado" leva aos lançamentos que formam aquele
                  // número, onde dá para recategorizar um a um.
                  onOpenSpending={(itemId, monthKey) => { setVoltarAoPlanoY(rolador().scrollTop); rolador().scrollTo({ top: 0 }); setFocusSpendingItemId(itemId); setTetoInitialFilter(null); setTetoInitialMonthKey(monthKey ?? null); setActiveTab('teto'); }}
                  onNavigateToGastos={(itemId, sourceKey, monthKey) => { setVoltarAoPlanoY(rolador().scrollTop); rolador().scrollTo({ top: 0 }); setFocusSpendingItemId(itemId); setTetoInitialFilter({ linkedItemId: itemId, sourceKey }); setTetoInitialMonthKey(monthKey ?? null); setActiveTab('teto'); }}
                  faturasPublicadas={faturasPublicadas}
                  onRemovePartial={handleRemovePartial}
                  onMovePartial={(origemId, destinoId, partial, ano, mes) => {
                    handleRemovePartial(origemId, partial.id);
                    handleAddPartial(destinoId, { ...partial, id: crypto.randomUUID() }, ano, mes);
                  }}
                  onAddItem={handleAddItem} onUpdateValue={handleUpdateValue} onTogglePaid={handleTogglePaid}
                  onRemoveItem={handleRemoveItem} onUpdateDescription={handleUpdateDescription}
                  onReplicateValue={handleReplicateValue} onLinkCard={handleLinkCard}
                  onUpdateCardConfig={handleUpdateCardConfig} onMoveItem={handleMoveItem}
                  trackedByCardId={block.type === CategoryType.CREDIT_CARD ? trackedByCardPrevMonth : undefined}
                  trackedByCardAllMonths={block.type === CategoryType.CREDIT_CARD ? trackedByCardAllMonths : undefined}
                  categorizedByCardLast4={block.type === CategoryType.CREDIT_CARD ? categorizedByCardLast4 : undefined}
                  categorizedByCardAllMonths={block.type === CategoryType.CREDIT_CARD ? categorizedByCardAllMonths : undefined}
                  aCategorizarPorCartaoMes={block.type === CategoryType.CREDIT_CARD ? aCategorizarPorCartaoMes : undefined}
                  onRequestExpenseSheet={block.type === CategoryType.VARIABLE_EXPENSE
                    ? () => {
                        const vm = months[mobileMonthIdx];
                        const isNow = vm.index === currentActualMonth && vm.year === currentActualYear;
                        setPendingExpense({ source: 'manual', itemId: '', value: 0, description: '', installments: 1, isCredit: false, category: CategoryType.VARIABLE_EXPENSE, purchaseDate: { day: isNow ? new Date().getDate() : 1, month: vm.index, year: vm.year } });
                      }
                    : undefined}
                  onAddLeisureItem={block.type === CategoryType.PERSONAL_LEISURE ? handleAddLeisureItem : undefined}
                  isAdmin={isAdmin}
                  onToggleOculto={handleToggleOculto}
                  onOpenExtrato={block.type === CategoryType.CREDIT_CARD && hasOpenFinanceAccess(user) ? handleOpenExtrato : undefined}
                  onPerguntarStets={(p) => { setStetsPerguntaInicial(p); setActiveTab('coach'); }}
                  // Só o cliente de Open Finance troca o seletor manual de forma de
                  // pagamento pelo detalhamento por fonte. No plano normal o seletor
                  // é a única maneira de informar débito x cartão.
                  hasOpenFinance={hasOpenFinanceAccess(user)}
                  modoOpenFinance={planoEmModoOF}
                />
                </React.Fragment>
              ))}
            </div>

            <div id="summary-section" className="hidden lg:block bg-zinc-900 border border-green-500/30 rounded-[40px] p-8 mt-12 mb-8 shadow-2xl overflow-hidden">
              <h3 className="text-green-400 font-black text-xl uppercase italic tracking-tighter mb-8 flex items-center gap-3"><i className="fas fa-vault"></i> Compilação Financeira</h3>
              {/* Sair da tabela fecha o balão, mesmo que o mouse tenha saído
                  rápido demais para o onMouseLeave da célula disparar. */}
              <div className="overflow-x-auto print:overflow-visible pb-4" onMouseLeave={fecharTip}>
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
                    {/* As linhas de custo mostram o valor CHEIO — é o que o cliente
                        reconhece e o que sustenta o diagnóstico. O que está no cartão
                        é abatido UMA vez, na linha com sinal (−) logo abaixo, para a
                        soma fechar na vertical sem contar o mesmo gasto duas vezes. */}
                    <tr className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                      <td className="p-4 font-bold text-zinc-300">
                        Faturas de Cartão
                        <span className="block text-[10px] font-normal text-zinc-500 normal-case">valor cheio que vence no mês</span>
                      </td>
                      {monthlySummaries.map((s, i) => (
                        <td key={i} className="p-4 text-center text-orange-400 font-mono align-top">
                          {celulaValor(
                            formatCurrency(s.totalCreditCard),
                            s.fixoNoCartao > 0 ? {
                              // Texto novo SÓ no modo Open Finance. No plano normal o
                              // cliente DECLARA a forma de pagamento, e o texto
                              // original ("você optou") é o correto para ele.
                              linhas: planoEmModoOF ? [
                                { rotulo: 'Fatura que vence neste mês:', valor: formatCurrency(s.totalCreditCard) },
                                { rotulo: 'Contas suas dentro dela:', valor: formatCurrency(s.fixoNoCartao) },
                              ] : [
                                { rotulo: 'Sua fatura completa ao final desse mês:', valor: formatCurrency(s.totalCreditCard) },
                                { rotulo: 'Contas fixas dentro da fatura:', valor: formatCurrency(s.fixoNoCartao) },
                              ],
                              corpo: planoEmModoOF
                                ? `É o que sai da sua conta neste mês para pagar o cartão. Desse total, ${formatCurrency(s.fixoNoCartao)} são contas suas — mercado, gasolina, esse tipo de coisa — que caem no cartão. Elas aparecem inteiras na linha de baixo e são descontadas ali, para o mesmo dinheiro não contar duas vezes.`
                                : `Além do valor que já existe na sua fatura atual, essa projeção já carrega as contas fixas que vão entrar, pois você optou em gastar ${formatCurrency(s.fixoNoCartao)} de contas fixas no cartão. Sendo assim, ele já é o valor que ela ficará ao final do período, após você ter gasto o valor que previu gastar.`,
                            } : undefined
                          )}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                      <td className="p-4 font-bold text-zinc-300">
                        Custos Fixos
                        <span className="block text-[10px] font-normal text-zinc-500 normal-case">valor cheio do mês</span>
                      </td>
                      {monthlySummaries.map((s, i) => (
                        <td key={i} className="p-4 text-center text-orange-400 font-mono align-top">
                          {celulaValor(
                            formatCurrency(s.totalFixed),
                            s.fixoNoCartao > 0 ? {
                              linhas: [
                                { rotulo: planoEmModoOF ? 'Suas contas fixas do mês:' : 'Sua conta fixa completa:', valor: formatCurrency(s.totalFixed) },
                                { rotulo: planoEmModoOF ? 'A parte que o cartão paga:' : 'No cartão:', valor: formatCurrency(s.fixoNoCartao) },
                              ],
                              corpo: planoEmModoOF
                                ? 'Todas as suas contas fixas do mês, inteiras. É este número que mostra o peso delas sobre o seu salário, e é ele que o seu diagnóstico usa. A parte que o cartão paga é descontada logo abaixo — ela já está somada dentro da fatura.'
                                : 'Esse é o total das suas contas fixas no mês, independente de como você paga cada uma. Ele é fundamental para você entender o peso que suas contas fixas têm sobre seu salário, e isso é mostrado no seu diagnóstico financeiro. A parte que vai no cartão é abatida logo abaixo, para não ser contada duas vezes.',
                            } : undefined
                          )}
                        </td>
                      ))}
                    </tr>
                    {/* Abatimento colado na conta fixa — as duas linhas contam a
                        mesma história: aqui está o total, aqui está a parte que
                        não sai agora. Sugestão do cliente do Eduardo. */}
                    {monthlySummaries.some(s => s.jaNaFatura > 0) && (
                      <tr className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                        <td className="p-4 font-bold text-sky-300/90">
                          (−) Já incluído na fatura
                          <span className="block text-[10px] font-normal text-zinc-500 normal-case">gastos que você paga no cartão — não contam duas vezes</span>
                        </td>
                        {monthlySummaries.map((s, i) => (
                          <td key={i} className="p-4 text-center font-mono text-sky-300/90 align-top">
                            {celulaValor(
                            s.jaNaFatura > 0 ? `− ${formatCurrency(s.jaNaFatura)}` : '—',
                            s.jaNaFatura > 0 ? {
                                // O número mora DENTRO da pergunta — mostrá-lo também
                                // na lateral repetia o mesmo valor duas vezes na
                                // mesma linha.
                                linhas: [
                                  planoEmModoOF
                                    ? { rotulo: 'Contas suas que o cartão paga:', valor: formatCurrency(s.jaNaFatura) }
                                    : { rotulo: 'Por que subtraímos esse valor de', valor: `${formatCurrency(s.jaNaFatura)}?` },
                                ],
                                corpo: planoEmModoOF
                                  ? 'Esse dinheiro aparece em dois lugares desta tela, mas só pode sair da sua conta uma vez. Ele está dentro da fatura, lá em cima, porque é o cartão que paga. E está nas contas fixas, porque elas precisam aparecer inteiras para o seu diagnóstico. Descontamos aqui para a conta fechar certo.'
                                  : 'Essa subtração acontece para a conta bater corretamente, pois esse valor está em dois lugares, mas só pode somar uma vez. 1º Está na fatura, porque você decidiu passar parte das contas fixas no cartão. 2º Também está nas contas fixas, para que você saiba o total de contas fixas que você tem, independente da forma de pagamento.',
                              } : undefined,
                            'border-sky-500/40'
                          )}
                          </td>
                        ))}
                      </tr>
                    )}
                    <tr className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                      <td className="p-4 font-bold text-zinc-300">Custos Variáveis<span className="block text-[10px] font-normal text-zinc-500 normal-case">fora do cartão</span></td>
                      {monthlySummaries.map((s, i) => <td key={i} className="p-4 text-center text-orange-400 font-mono">{formatCurrency(s.totalVariable)}</td>)}
                    </tr>
                    <tr className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                      <td className="p-4 font-bold text-zinc-300">Gastos Pessoais e Lazer<span className="block text-[10px] font-normal text-zinc-500 normal-case">fora do cartão</span></td>
                      {monthlySummaries.map((s, i) => <td key={i} className="p-4 text-center text-orange-400 font-mono">{formatCurrency(s.totalLeisure)}</td>)}
                    </tr>
                    <tr className="border-b border-zinc-800 bg-zinc-800/20">
                      <td className="p-4 font-black text-zinc-200 uppercase italic">Total de Custos</td>
                      {monthlySummaries.map((s, i) => (
                        <td key={i} className="p-4 text-center text-orange-400 font-mono font-black whitespace-nowrap align-top">
                          {celulaValor(
                            formatCurrency(s.totalCost),
                            s.jaNaFatura > 0 ? {
                              linhas: [
                                { rotulo: 'Como chegamos neste total:', valor: formatCurrency(s.totalCost) },
                              ],
                              corpo: `Fatura ${formatCurrency(s.totalCreditCard)} + conta fixa ${formatCurrency(s.totalFixed)}${s.totalVariable > 0 ? ` + variáveis ${formatCurrency(s.totalVariable)}` : ''} + lazer ${formatCurrency(s.totalLeisure)}, menos ${formatCurrency(s.jaNaFatura)} que já estavam contados dentro da fatura.`,
                            } : undefined
                          )}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b-2 border-zinc-800 bg-zinc-950/20">
                      <td className="p-4 font-black text-white uppercase italic">Sobras / Faltas</td>
                      {monthlySummaries.map((s, i) => (
                        <td key={i} className={`p-4 text-center font-black font-mono whitespace-nowrap ${s.balance >= 0 ? 'text-green-400' : 'text-red-500 animate-pulse'}`}>
                          {formatCurrency(s.balance)}
                        </td>
                      ))}
                    </tr>
                    <tr className="bg-zinc-900/40">
                      <td className="p-6 font-black text-zinc-300 uppercase italic text-base">ACUMULADO</td>
                      {monthlySummaries.map((s, i) => <td key={i} className={`p-6 text-center font-black font-mono text-lg drop-shadow-lg whitespace-nowrap ${s.accumulated >= 0 ? 'text-green-400' : 'text-red-500'}`}>{formatCurrency(s.accumulated)}</td>)}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div id="cycle-management" className="bg-white border border-zinc-200 rounded-3xl p-6 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6 mb-20">
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
                {/* Rascunho na reunião: só o coach vê, e nada é gravado até aplicar. */}
                {isAdmin && !simulando && (
                  <button
                    onClick={iniciarSimulacao}
                    title="Testar cenários sem gravar nada"
                    className="bg-white hover:bg-zinc-100 text-zinc-700 border border-zinc-300 text-[10px] font-black px-6 py-3.5 rounded-xl uppercase transition-all whitespace-nowrap"
                  >
                    Simular
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <TetoGastos focusItemId={focusSpendingItemId} onFocusHandled={() => setFocusSpendingItemId(null)} initialFilter={tetoInitialFilter} onInitialFilterHandled={() => setTetoInitialFilter(null)} initialMonthKey={tetoInitialMonthKey} items={items} currentMonthIdx={currentActualMonth} currentYear={currentActualYear} months={months} onAddPartial={handleAddPartial} onRemovePartial={handleRemovePartial} db={db} householdId={householdId} resolveDbId={(localId) => itemIdMapRef.current[localId] ?? localId} tetoAlert={user ? (() => { const p = getNotifPrefs(user.id); return { enabled: p.tetoAlert, pct: p.tetoPct }; })() : undefined} onCreateItem={handleCreateItem} modoOpenFinance={planoEmModoOF} colunasIniciais={tetoColumns} onColunasMudaram={setTetoColumns} onRenomearLancamento={handleRenomearLancamento} />
        )}
      </main>

      {/* ── MOBILE BOTTOM TAB BAR ──────────────────────────────────────── */}
      {/**
        * Barra de baixo: UM destaque só, no que está aberto.
        *
        * Antes Plano, Lançar e Stets ficavam realçados ao mesmo tempo e não
        * dava para saber em que tela se estava (Mariane, 2026-09-20). Agora
        * todos ficam cinza e o quadrado verde em relevo marca o selecionado —
        * o mesmo relevo que o botão central já tinha.
        */}
      {voltarAoPlanoY !== null && activeTab === 'teto' && !showExtrato && !pendingExpense && (
        <button
          onClick={() => {
            const y = voltarAoPlanoY;
            setVoltarAoPlanoY(null);
            setActiveTab('plan');
            // O Plano monta depois da troca de aba; tenta até a página ter altura para o ponto.
            const inicio = Date.now();
            const tentar = () => {
              const r = rolador();
              r.scrollTo({ top: y, behavior: 'auto' });
              if (Math.abs(r.scrollTop - y) > 4 && Date.now() - inicio < 1500) setTimeout(tentar, 80);
            };
            setTimeout(tentar, 30);
          }}
          className="fixed left-4 z-[90] flex items-center gap-2 rounded-full bg-[#1d1d1f] px-4 py-2.5 text-[12px] font-black uppercase tracking-wide text-white shadow-xl active:scale-95"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)' }}
        >
          <i className="fas fa-arrow-left text-[11px]" /> Voltar ao Plano
        </button>
      )}

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-[95] safe-bottom" style={{background:'rgba(245,245,247,0.92)',backdropFilter:'blur(28px) saturate(1.8)',borderTop:'0.5px solid rgba(0,0,0,0.1)'}}>
        <div className="relative">
        {/* Right-edge scroll hint */}
        <div className="pointer-events-none absolute right-0 top-0 bottom-0 z-10 flex items-center pr-1" style={{width:'28px',background:'linear-gradient(to right,transparent,rgba(245,245,247,0.96))'}}>
          <i className="fas fa-chevron-right text-[8px] text-zinc-400"></i>
        </div>
        {/* `overflow-x-auto` faz o navegador cortar na VERTICAL também, e o
            badge do botão central sai para cima. O respiro aqui é o que deixa
            ele aparecer inteiro (Eduardo, 2026-09-10). */}
        <div className="overflow-x-auto scrollbar-none">
          <div className={`flex min-w-max ${hasOpenFinanceAccess(user) ? 'pt-2.5' : ''}`}>
            <button
              onClick={() => irParaAba('plan')}
              className={`min-w-[72px] flex flex-col items-center justify-center pt-1.5 pb-0.5 gap-0.5 transition-colors active:scale-95 relative ${destaqueBarra === 'plan' ? 'text-[#182200]' : 'text-[#aeaeb2]'}`}
            >
              <div
                className="w-9 h-9 flex items-center justify-center rounded-[12px] transition-all"
                style={destaqueBarra === 'plan' ? ABA_ATIVA : undefined}
              >
                <i className="fas fa-chart-bar text-lg"></i>
              </div>
              <span className="text-[9px] font-black uppercase tracking-wide">Plano</span>
            </button>

            <button
              id="tab-teto-mobile"
              onClick={() => irParaAba('teto')}
              className={`min-w-[72px] flex flex-col items-center justify-center pt-1.5 pb-0.5 gap-0.5 transition-colors active:scale-95 relative ${destaqueBarra === 'teto' ? 'text-[#182200]' : 'text-[#aeaeb2]'}`}
            >
              <div
                className="w-9 h-9 flex items-center justify-center rounded-[12px] transition-all"
                style={destaqueBarra === 'teto' ? ABA_ATIVA : undefined}
              >
                <i className="fas fa-wallet text-lg"></i>
              </div>
              <span className="text-[9px] font-black uppercase tracking-wide">Gastos</span>
            </button>

            {/**
             * Botão central: mostra a próxima ação que VALE A PENA.
             *
             * Com fila pendente, o trabalho que gera valor é categorizar o que o
             * banco já trouxe — não lançar de novo à mão. O número no botão faz
             * a fila deixar de ser invisível: hoje ela só aparece no pop-up de
             * abertura e some (Eduardo, 2026-09-10).
             *
             * Fila zerada, volta a ser "Lançar". E o lançamento manual NUNCA
             * fica sem caminho, porque ele continua sendo necessário para o que
             * o Open Finance não cobre: dinheiro vivo, cartão de terceiro
             * (o caso da tia) e banco não conectado. Com fila pendente ele vive
             * no toque longo e dentro do próprio Extrato.
             */}
            {(() => {
              const pendentes = hasOpenFinanceAccess(user) ? categorizeCount : 0;
              // Acende so com a folha de lancar aberta — o Extrato tem aba propria.
              const abertoNoCentro = destaqueBarra === 'centro';
              const abrirLancamento = () => {
                setShowExtrato(false);
                const vm = months[mobileMonthIdx];
                const isNow = vm.index === currentActualMonth && vm.year === currentActualYear;
                setPendingExpense({ source: 'manual', itemId: '', value: 0, description: '', installments: 1, isCredit: false, purchaseDate: { day: isNow ? new Date().getDate() : 1, month: vm.index, year: vm.year } });
              };
              const abrirExtrato = async () => {
                setPendingExpense(null);
                const t = await getToken({ template: 'supabase' });
                if (t) { setOfAuthToken(t); setShowExtrato(true); }
              };
              return (
                <button
                  data-tour="tab-launch"
                  onClick={() => { if (pendentes > 0) { abrirExtrato(); } else { abrirLancamento(); } }}
                  onContextMenu={hasOpenFinanceAccess(user) ? (e) => { e.preventDefault(); abrirLancamento(); } : undefined}
                  aria-label={pendentes > 0 ? `Categorizar ${pendentes} transações` : 'Lançar gasto'}
                  // Tamanho novo só para quem tem Open Finance (o badge precisa do
                  // espaço); o plano normal segue com o botão de sempre.
                  className={`${hasOpenFinanceAccess(user) ? 'min-w-[86px]' : 'min-w-[72px]'} flex flex-col items-center justify-center pt-1.5 pb-0.5 gap-0.5 rounded-xl active:scale-95 transition-all relative ${abertoNoCentro ? 'text-[#182200]' : 'text-[#aeaeb2]'}`}
                >
                  {pendentes > 0 ? (
                    <>
                      {/* A borda branca é o que dá o relevo: sem ela o vermelho
                          encosta no verde e o badge parece parte do botão. */}
                      <span className="absolute top-0 right-2 min-w-[20px] h-[20px] px-1.5 rounded-full bg-[#ff3b30] text-white text-[11px] font-black flex items-center justify-center ring-2 ring-white shadow-lg z-10">
                        {pendentes > 99 ? '99+' : pendentes}
                      </span>
                      <div className="w-9 h-9 flex items-center justify-center rounded-[12px] transition-all" style={abertoNoCentro ? ABA_ATIVA : undefined}>
                        <i className="fas fa-list-check text-lg"></i>
                      </div>
                      <span className="text-[9px] font-black uppercase tracking-wide">Categorizar</span>
                    </>
                  ) : (
                    <>
                      <div className="w-9 h-9 flex items-center justify-center rounded-[12px] transition-all" style={abertoNoCentro ? ABA_ATIVA : undefined}>
                        <i className="fas fa-plus text-lg"></i>
                      </div>
                      <span className="text-[9px] font-black uppercase tracking-wide">Lançar</span>
                    </>
                  )}
                </button>
              );
            })()}

            {hasOpenFinanceAccess(user) && (
            <button
              onClick={async () => {
                // Já no Extrato: tocar de novo sobe a lista para o topo.
                if (showExtrato && !pendingExpense) {
                  document.querySelector('[data-extrato-rolagem]')?.scrollTo({ top: 0, behavior: 'smooth' });
                  return;
                }
                setPendingExpense(null);
                setVoltarAoPlanoY(null);
                const t = await getToken({ template: 'supabase' });
                if (t) { setOfAuthToken(t); setShowExtrato(true); }
              }}
              className={`min-w-[72px] flex flex-col items-center justify-center pt-1.5 pb-0.5 gap-0.5 transition-colors active:scale-95 ${destaqueBarra === 'extrato' ? 'text-[#182200]' : 'text-[#aeaeb2]'}`}
            >
              <div
                className="w-9 h-9 flex items-center justify-center rounded-[12px] transition-all"
                style={destaqueBarra === 'extrato' ? ABA_ATIVA : undefined}
              >
                <i className="fas fa-university text-lg"></i>
              </div>
              <span className="text-[9px] font-black uppercase tracking-wide">Extrato</span>
            </button>
            )}

            {/* Stets: sempre verde, mesmo sem estar selecionado — é o único item
                colorido da barra, o que o destaca e convida ao clique. */}
            <button
              onClick={() => setActiveTab('coach')}
              className={`min-w-[72px] flex flex-col items-center justify-center pt-1.5 pb-0.5 gap-0.5 transition-colors active:scale-95 ${destaqueBarra === 'coach' ? 'text-[#182200]' : 'text-[#aeaeb2]'}`}
            >
              <div
                className="w-9 h-9 flex items-center justify-center rounded-[12px] transition-all"
                style={destaqueBarra === 'coach' ? ABA_ATIVA : undefined}
              >
                <i className="fas fa-bolt text-lg"></i>
              </div>
              <span className="text-[9px] font-black uppercase tracking-wide">Stets</span>
            </button>

            <button
              onClick={() => irParaAba('metas')}
              className={`min-w-[72px] flex flex-col items-center justify-center pt-1.5 pb-0.5 gap-0.5 transition-colors active:scale-95 relative ${destaqueBarra === 'metas' ? 'text-[#182200]' : 'text-[#aeaeb2]'}`}
            >
              <div
                className="w-9 h-9 flex items-center justify-center rounded-[12px] transition-all"
                style={destaqueBarra === 'metas' ? ABA_ATIVA : undefined}
              >
                <i className="fas fa-bullseye text-lg"></i>
              </div>
              <span className="text-[9px] font-black uppercase tracking-wide">Metas</span>
            </button>

            <button
              onClick={() => irParaAba('dividas')}
              className={`min-w-[72px] flex flex-col items-center justify-center pt-1.5 pb-0.5 gap-0.5 transition-colors active:scale-95 relative ${destaqueBarra === 'dividas' ? 'text-[#182200]' : 'text-[#aeaeb2]'}`}
            >
              <div
                className="w-9 h-9 flex items-center justify-center rounded-[12px] transition-all"
                style={destaqueBarra === 'dividas' ? ABA_ATIVA : undefined}
              >
                <i className="fas fa-file-invoice-dollar text-lg"></i>
              </div>
              <span className="text-[9px] font-black uppercase tracking-wide">Dívidas</span>
            </button>

            {currentWeekQuote && (
              <button
                onClick={() => setShowQuoteModal(true)}
                className="min-w-[72px] flex flex-col items-center justify-center pt-1.5 pb-0.5 gap-0.5 transition-colors active:scale-95 relative"
              >
                <div className="w-9 h-9 flex items-center justify-center rounded-[12px]" style={showQuoteModal ? {background:'rgba(34,197,94,0.12)'} : {}}>
                  <i className="fas fa-quote-left text-lg" style={{color:'#22c55e'}}></i>
                </div>
                <span className="text-[9px] font-black uppercase tracking-wide" style={{color:'#22c55e'}}>Frase</span>
              </button>
            )}

            <button
              onClick={() => irParaAba('desempenho')}
              className={`min-w-[80px] flex flex-col items-center justify-center pt-1.5 pb-0.5 gap-0.5 transition-colors active:scale-95 relative ${destaqueBarra === 'desempenho' ? 'text-[#182200]' : 'text-[#aeaeb2]'}`}
            >
              <div
                className="w-9 h-9 flex items-center justify-center rounded-[12px] transition-all"
                style={destaqueBarra === 'desempenho' ? ABA_ATIVA : undefined}
              >
                <i className="fas fa-chart-pie text-lg"></i>
              </div>
              <span className="text-[9px] font-black uppercase tracking-wide">Desempenho</span>
            </button>

            <button
              onClick={() => setShowSettings(true)}
              className="min-w-[72px] flex flex-col items-center justify-center pt-1.5 pb-0.5 gap-0.5 text-[#aeaeb2] transition-colors active:scale-95"
            >
              <div className="w-9 h-9 flex items-center justify-center rounded-[12px]">
                <i className="fas fa-user-circle text-lg"></i>
              </div>
              <span className="text-[9px] font-black uppercase tracking-wide">Perfil</span>
            </button>
          </div>
        </div>
        </div>
      </nav>

      {/* Spacer so bottom tab bar doesn't cover content on mobile */}
      <div className="lg:hidden h-16"></div>

      {/* Convite de conexão — fecha o wizard e emenda na conexão bancária.
          Só existe para quem passou pelo portão; os demais nem veem. */}
      {showConviteBanco && hasOpenFinanceAccess(user) && (
        <ConviteConectarBanco
          nome={user?.firstName || undefined}
          onConectar={() => { setShowConviteBanco(false); handleOpenExtrato(); }}
          onDepois={() => setShowConviteBanco(false)}
        />
      )}

      {/* Open Finance — Extrato Bancário overlay */}
      {showExtrato && ofAuthToken && householdId && hasOpenFinanceAccess(user) && (
        <ExtratoBancario
          householdId={householdId}
          authToken={ofAuthToken}
          onRegistrarPush={registrarAparelho}
          onLancarManual={() => {
            const vm = months[mobileMonthIdx];
            const isNow = vm.index === currentActualMonth && vm.year === currentActualYear;
            setShowExtrato(false);
            setPendingExpense({ source: 'manual', itemId: '', value: 0, description: '', installments: 1, isCredit: false, purchaseDate: { day: isNow ? new Date().getDate() : 1, month: vm.index, year: vm.year } });
          }}
          items={items}
          currentYear={currentActualYear}
          currentMonth={currentActualMonth}
          months={months}
          tetoAlert={user ? (() => { const p = getNotifPrefs(user.id); return { enabled: p.tetoAlert, pct: p.tetoPct }; })() : undefined}
          categorizedIds={ofCategorized}
          initialCardLast4={ofInitialCardLast4}
          onLaunchExpense={(pre) => setPendingExpense({ source: 'manual', ...pre })}
          onCreateItem={handleCreateItem}
          onAddPartial={handleAddPartial}
          onBancoRemovido={handleBancoRemovido}
          onFilaMudou={(pendentes) => setCategorizeCount(pendentes)}
          /* Recontar ao sair: a categorização acontece dentro do Extrato, e sem
             isto o badge e o pop-up seguiam anunciando o que o cliente acabou
             de resolver. Ele categorizava, fechava, e o número continuava lá
             (Eduardo, 2026-09-16). */
          onClose={() => {
            setShowExtrato(false);
            setOfInitialCardLast4(undefined);
            recontarPendentes();
          }}
        />
      )}

      {/* Pop-up de categorização — gated por hasOpenFinanceAccess no efeito que
          liga showCategorizePopup. "Categorizar agora" abre o Extrato. */}
      {showCategorizePopup && categorizeCount > 0 && hasOpenFinanceAccess(user) && (
        <CategorizePopup
          count={categorizeCount}
          automaticas={pendentesAutomaticas}
          onCategorize={() => { setShowCategorizePopup(false); handleOpenExtrato(); }}
          onDismiss={() => setShowCategorizePopup(false)}
        />
      )}

      {showSuporte && <Suporte onClose={() => setShowSuporte(false)} telaAtual={activeTab} temOpenFinance={hasOpenFinanceAccess(user)} />}
      {showSuporteAdmin && (
        <SuporteAdmin onClose={() => setShowSuporteAdmin(false)} onMudou={carregarChamadosAbertos} />
      )}

      {/* Tooltip da Compilação. `fixed` porque a tabela rola na horizontal e
          cortaria um absolute; `pointer-events-none` para não roubar o hover
          da célula que o abriu. */}
      {tip && (
        <div
          className="fixed z-[400] pointer-events-none"
          style={{ left: tip.x, top: tip.y, transform: 'translateX(-50%)' }}
        >
          <div className="w-[330px] rounded-2xl border border-zinc-700 bg-[#17181a] shadow-2xl overflow-hidden">
            {/* Seta apontando para a célula */}
            <div className="absolute -top-[6px] left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-[#17181a] border-l border-t border-zinc-700" />
            <div className="relative px-4 pt-3.5 pb-3">
              {/* Cada linha do cabeçalho: rótulo em azul, número em branco ao
                  lado. O rótulo pode quebrar; o número nunca (`shrink-0`), que
                  era o que cortava "no cartão R$ 2.752,77" pela metade. */}
              {tip.linhas.map((l, i) => (
                <div key={i} className="flex items-baseline justify-between gap-2.5 mb-1">
                  <span className="text-[10px] font-black uppercase tracking-[0.08em] leading-[1.35] text-sky-400">{l.rotulo}</span>
                  {l.valor && (
                    <span className="shrink-0 font-mono text-[12.5px] font-bold text-white tabular-nums whitespace-nowrap">{l.valor}</span>
                  )}
                </div>
              ))}
              <p className="mt-2 text-[12.5px] leading-relaxed text-zinc-300">{tip.texto}</p>
            </div>
          </div>
        </div>
      )}

      {/* Fechamento do mês — pergunta o que ficou sem pagar no mês que passou.
          Só abre quando há algo a perguntar e o cliente não adiou 3 vezes. */}
      {fechamento && (
        <FechamentoMes
          mesNome={fechamento.mesNome}
          resumo={fechamento.resumo}
          acumuloPorItem={fechamento.acumulo}
          onConcluir={handleConcluirFechamento}
          onAdiar={handleAdiarFechamento}
          onCadastrarAcordo={handleCadastrarAcordo}
        />
      )}

      {/* Expense confirmation / entry sheet */}
      {/* Os inputs precisam existir na árvore para os botões do pop-up
          conseguirem dispará-los. */}
      <input
        ref={captura.inputsOcultos.inputFoto}
        type="file" accept="image/*" capture="environment" className="hidden"
        onChange={captura.inputsOcultos.aoEscolherArquivo}
      />
      <input
        ref={captura.inputsOcultos.inputGaleria}
        type="file" accept="image/*" className="hidden"
        onChange={captura.inputsOcultos.aoEscolherArquivo}
      />

      <ExpenseSheet
        onAbrirCamera={captura.tirarFoto}
        onAbrirGaleria={captura.anexarImagem}
        onAbrirVoz={captura.falar}
        onPerguntarStets={(p) => {
          setPendingExpense(null);
          setStetsPerguntaInicial(p);
          setActiveTab('coach');
        }}
        open={!!pendingExpense}
        source={pendingExpense?.source ?? 'manual'}
        items={items}
        initialItemId={pendingExpense?.itemId}
        initialValue={pendingExpense?.value}
        initialDescription={pendingExpense?.description}
        initialInstallments={pendingExpense?.installments}
        initialCategory={pendingExpense?.category}
        irDiretoParaLinha={pendingExpense?.irDiretoParaLinha}
        parcelaDoBanco={pendingExpense?.parcelaDoBanco}
        cartoesConectadosLast4={Object.values(ofCartoesPorConexao).flat()}
        contaConectada={planoEmModoOF}
        knownPayMethod={pendingExpense?.knownPayMethod}
        knownCardLast4={pendingExpense?.knownCardLast4}
        defaultPurchaseDate={pendingExpense?.purchaseDate}
        onConfirm={async (data) => {
          if (data.itemId) fireConfetti();
          // O cartao do extrato viaja junto ate o lancamento: sem isto, o gasto
          // herdava o cartao da LINHA e um gasto do Bradesco aparecia como Latam.
          if (pendingExpense?.knownCardLast4) {
            (data as { cardLast4?: string }).cardLast4 = pendingExpense.knownCardLast4;
          }
          handleConfirmExpense(data);

          /**
           * Fecha o ciclo: marca a transação e ensina o estabelecimento.
           *
           * TOKEN NOVO, NÃO O DA ABERTURA. `ofAuthToken` é capturado quando o
           * Extrato abre e o token do Clerk é curto — categorizar dez minutos
           * depois mandava um token vencido, o servidor recusava com 401, e o
           * `.catch(() => {})` engolia. O gasto entrava no plano, a transação
           * continuava pendente, e ela VOLTAVA na lista. Foi o que aconteceu com
           * o Eduardo em 2026-09-10: "Habibs" e "Las alitas" já lançados e ainda
           * na fila, e o mesmo gasto de R$ 202,90 categorizado duas vezes com
           * nomes diferentes ("Monitor trabalho" e "Luz e filtro"), cada um
           * gerando dez parcelas fantasma.
           *
           * Mesma lição do `marcarNoServidor` no ExtratoBancario: falha de
           * gravação tem de aparecer. Aqui ela avisa e devolve a transação para
           * a fila, em vez de fingir que deu certo.
           */
          const ofTx = pendingExpense?.ofTx;
          // Nome do estabelecimento trocado na tela de lançamento também ensina
          // o dicionário, como a pergunta do Extrato.
          const nomeDoBanco = pendingExpense?.description?.trim() ?? '';
          const nomeEscolhido = data.description?.trim() ?? '';
          if (ofTx && nomeDoBanco && nomeEscolhido && nomeEscolhido !== nomeDoBanco) {
            getToken({ template: 'supabase' }).then((t) => fetch('/api/merchant-nome', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t ?? ''}` },
              body: JSON.stringify({ textoDoBanco: nomeDoBanco, nome: nomeEscolhido }),
            })).catch(() => { /* dicionário é acessório */ });
          }
          if (ofTx && data.itemId) {
            const token = await getToken({ template: 'supabase' }).catch(() => null);
            const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ofAuthToken ?? ''}` };
            let marcou = false;
            try {
              const res = await fetch('/api/of-transactions', {
                method: 'PATCH', headers: auth,
                body: JSON.stringify({ householdId, transactionId: ofTx.transactionId, action: 'categorize', itemId: data.itemId, category: data.category, partialId: null }),
              });
              marcou = res.ok;
              if (!res.ok) {
                alert(res.status === 401 || res.status === 403
                  ? 'O gasto entrou no seu plano, mas sua sessão expirou e a transação continua na fila do Extrato. Feche e abra o Extrato para não lançar duas vezes.'
                  : `O gasto entrou no seu plano, mas não consegui tirar a transação da fila (erro ${res.status}). Confira no Extrato antes de lançar de novo.`);
              }
            } catch {
              alert('O gasto entrou no seu plano, mas não consegui tirar a transação da fila — sem conexão. Confira no Extrato antes de lançar de novo.');
            }

            if (marcou) {
              if (ofTx.merchantKey) {
                fetch('/api/of-merchant-memory', {
                  method: 'POST', headers: auth,
                  body: JSON.stringify({ householdId, merchantKey: ofTx.merchantKey, category: data.category, itemId: data.itemId }),
                }).catch(() => {/* memória é acessória */});
              }
              setOfCategorized((prev) => [...prev, ofTx.transactionId]);
            }
          }
        }}
        onClose={() => setPendingExpense(null)}
        onCreateItem={handleCreateItem}
      />
    </div>
  );
};

export default App;
