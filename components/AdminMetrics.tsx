import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/clerk-react';

// Dashboard do administrador — usuários ativos, pagantes, último acesso e
// projeção de faturamento. Renderizado dentro do CoachDashboard, SÓ para
// super-admin (a API também recusa qualquer outro usuário).

type Status = 'coach' | 'pagante' | 'trial' | 'expirado' | 'sem_conta';

interface ClientRow {
  id: string;
  name: string;
  email: string;
  lastSignInAt: number | null;
  status: Status;
  trialDaysLeft: number | null;
  isAnnual: boolean;
  hidden: boolean;
}

interface Metrics {
  totals: {
    totalUsers: number;
    active7d: number;
    active30d: number;
    paying: number;
    inTrial: number;
    coachActive: number;
    expired: number;
    mrr: number;
    potentialMrr: number;
  };
  clients: ClientRow[];
}

const STATUS_META: Record<Status, { label: string; classes: string }> = {
  coach: { label: 'Consultoria', classes: 'bg-green-500/10 text-green-400 border-green-500/30' },
  pagante: { label: 'Pagante', classes: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  trial: { label: 'Trial', classes: 'bg-sky-500/10 text-sky-400 border-sky-500/30' },
  expirado: { label: 'Expirado', classes: 'bg-red-500/10 text-red-400 border-red-500/30' },
  sem_conta: { label: 'Sem plano', classes: 'bg-zinc-800 text-zinc-500 border-zinc-700' },
};

const FILTERS: Array<{ key: Status | 'all'; label: string }> = [
  { key: 'all', label: 'Todos' },
  { key: 'coach', label: 'Consultoria' },
  { key: 'trial', label: 'Trial' },
  { key: 'pagante', label: 'Pagantes' },
  { key: 'expirado', label: 'Expirados' },
];

function formatBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

function lastAccessLabel(ts: number | null): { text: string; fresh: boolean } {
  if (!ts) return { text: 'Nunca acessou', fresh: false };
  const diffMs = Date.now() - ts;
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days === 0) return { text: 'Hoje', fresh: true };
  if (days === 1) return { text: 'Ontem', fresh: true };
  if (days < 7) return { text: `Há ${days} dias`, fresh: true };
  if (days < 30) return { text: `Há ${days} dias`, fresh: false };
  const months = Math.floor(days / 30);
  return { text: `Há ${months} ${months === 1 ? 'mês' : 'meses'}`, fresh: false };
}

function chipText(c: ClientRow): string {
  const meta = STATUS_META[c.status];
  if (c.status === 'coach' && c.trialDaysLeft != null) return `${meta.label} · ${c.trialDaysLeft}d p/ pagar`;
  if (c.status === 'trial' && c.trialDaysLeft != null) return `${meta.label} · ${c.trialDaysLeft}d`;
  if (c.status === 'pagante' && c.isAnnual) return `${meta.label} · anual`;
  return meta.label;
}

const AdminMetrics: React.FC = () => {
  const { getToken } = useAuth();
  const [data, setData] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [showHidden, setShowHidden] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [regularizando, setRegularizando] = useState(false);
  const [regularizouMsg, setRegularizouMsg] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const token = await getToken({ template: 'supabase' });
      const res = await fetch('/api/admin-metrics', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Erro ${res.status}`);
      }
      setData(await res.json() as Metrics);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar métricas');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => { load(); }, [load]);

  /** Dá a todo cliente o prazo devido: 5 meses a partir do primeiro acesso. */
  async function regularizarTodos() {
    setRegularizando(true);
    setRegularizouMsg('');
    try {
      const token = await getToken({ template: 'supabase' });
      const res = await fetch('/api/client-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'regularize-all' }),
      });
      const body = await res.json().catch(() => ({})) as { atualizados?: number; error?: string };
      if (!res.ok) throw new Error(body.error ?? `Erro ${res.status}`);
      setRegularizouMsg(`${body.atualizados ?? 0} cliente(s) regularizado(s).`);
      await load();
    } catch (e) {
      setRegularizouMsg(e instanceof Error ? e.message : 'Erro ao regularizar');
    } finally {
      setRegularizando(false);
    }
  }

  async function toggleHidden(c: ClientRow) {
    setTogglingId(c.id);
    try {
      const token = await getToken({ template: 'supabase' });
      const res = await fetch('/api/admin-metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: c.id, hide: !c.hidden }),
      });
      if (res.ok) await load();
    } finally {
      setTogglingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <i className="fas fa-circle-notch animate-spin text-green-400 text-3xl"></i>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-16 text-zinc-500">
        <i className="fas fa-triangle-exclamation text-3xl mb-3 block text-amber-500"></i>
        <p className="text-sm">{error || 'Sem dados'}</p>
      </div>
    );
  }

  const t = data.totals;
  const hiddenCount = data.clients.filter(c => c.hidden).length;
  const q = search.trim().toLowerCase();
  const visible = data.clients.filter(c => {
    if (c.hidden !== showHidden) return false;
    if (filter !== 'all' && c.status !== filter) return false;
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
  });

  return (
    <div className="pb-10">
      {/* Faturamento — destaque principal */}
      <div className="bg-gradient-to-br from-green-950 to-zinc-900 border border-green-500/20 rounded-3xl p-6 mb-4">
        <p className="text-green-500 text-[10px] font-black uppercase tracking-[0.25em] mb-1">Faturamento mensal (MRR)</p>
        <p className="text-white text-4xl font-black font-mono tracking-tight">{formatBRL(t.mrr)}</p>
        <p className="text-zinc-500 text-xs mt-2">
          Potencial se os {t.inTrial + t.coachActive} com acesso assinarem: <span className="text-green-400 font-bold">{formatBRL(t.potentialMrr)}</span>
        </p>
      </div>

      {/* Regularizar — aplica a régua da casa (5 meses do 1º acesso) em todos.
          Só estende prazo; nunca encurta o de ninguém. */}
      {(t.inTrial > 0 || t.expired > 0) && (
        <div className="bg-zinc-900 border border-green-500/25 rounded-2xl p-4 mb-4">
          <p className="text-white text-xs font-black uppercase tracking-wide mb-1">
            <i className="fas fa-wand-magic-sparkles text-green-400 mr-2"></i>
            {t.inTrial + t.expired} cliente(s) fora do plano de 5 meses
          </p>
          <p className="text-zinc-500 text-[11px] mb-3 leading-snug">
            Dá a todos o prazo devido: 5 meses contados do primeiro acesso de cada um.
            Só estende — ninguém perde tempo que já tem.
          </p>
          <button
            onClick={regularizarTodos}
            disabled={regularizando}
            className="bg-green-500 active:bg-green-400 disabled:opacity-50 text-black font-black text-xs px-4 py-2.5 rounded-xl uppercase transition-all"
          >
            {regularizando
              ? <><i className="fas fa-circle-notch animate-spin mr-2"></i>Regularizando…</>
              : 'Dar 5 meses a todos'}
          </button>
          {regularizouMsg && (
            <p className="text-green-400 text-[11px] font-bold mt-2">{regularizouMsg}</p>
          )}
        </div>
      )}

      {/* Grid de números */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <p className="text-zinc-500 text-[9px] font-black uppercase tracking-[0.2em] mb-1">Usuários</p>
          <p className="text-white text-2xl font-black font-mono">{t.totalUsers}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <p className="text-zinc-500 text-[9px] font-black uppercase tracking-[0.2em] mb-1">Ativos · 7 dias</p>
          <p className="text-green-400 text-2xl font-black font-mono">{t.active7d}</p>
          <p className="text-zinc-600 text-[10px] mt-0.5">{t.active30d} em 30 dias</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <p className="text-zinc-500 text-[9px] font-black uppercase tracking-[0.2em] mb-1">Pagantes</p>
          <p className="text-emerald-300 text-2xl font-black font-mono">{t.paying}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <p className="text-zinc-500 text-[9px] font-black uppercase tracking-[0.2em] mb-1">Consultoria</p>
          <p className="text-green-400 text-2xl font-black font-mono">{t.coachActive}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <p className="text-zinc-500 text-[9px] font-black uppercase tracking-[0.2em] mb-1">Em trial</p>
          <p className="text-sky-400 text-2xl font-black font-mono">{t.inTrial}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <p className="text-zinc-500 text-[9px] font-black uppercase tracking-[0.2em] mb-1">Expirados</p>
          <p className="text-red-400 text-2xl font-black font-mono">{t.expired}</p>
        </div>
      </div>

      {/* Lista de clientes — último acesso */}
      <h2 className="text-white text-sm font-black uppercase italic tracking-tight mb-3 mt-6">
        Último acesso <span className="text-zinc-600 normal-case not-italic font-normal">· mais recentes primeiro</span>
      </h2>

      {/* Busca */}
      <div className="relative mb-3">
        <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 text-sm"></i>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nome ou e-mail..."
          className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl pl-11 pr-10 py-3 text-white text-sm outline-none focus:border-green-500/50 transition-colors placeholder:text-zinc-600"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-white transition-colors"
          >
            <i className="fas fa-times text-sm"></i>
          </button>
        )}
      </div>

      {/* Filtro por status */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`shrink-0 px-3.5 py-2 rounded-xl text-[11px] font-black uppercase tracking-wide transition-all border ${
              filter === f.key ? 'bg-green-500 text-black border-green-500' : 'bg-zinc-900 text-zinc-400 border-zinc-800'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Lista */}
      {visible.length === 0 ? (
        <div className="text-center py-12 text-zinc-600">
          <i className="fas fa-user-slash text-3xl mb-3 block"></i>
          <p className="text-xs uppercase font-black tracking-widest">
            {showHidden ? 'Nenhum usuário oculto' : 'Nenhum cliente encontrado'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(c => {
            const access = lastAccessLabel(c.lastSignInAt);
            const meta = STATUS_META[c.status];
            return (
              <div key={c.id} className={`bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 flex items-center gap-3 ${c.hidden ? 'opacity-60' : ''}`}>
                <div className={`w-2 h-2 rounded-full shrink-0 ${access.fresh ? 'bg-green-400' : 'bg-zinc-700'}`}></div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-bold truncate">{c.name}</p>
                  <p className="text-zinc-600 text-[11px] truncate">{c.email}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-[11px] font-bold ${access.fresh ? 'text-green-400' : 'text-zinc-500'}`}>{access.text}</p>
                  <span className={`inline-block mt-1 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${meta.classes}`}>
                    {chipText(c)}
                  </span>
                </div>
                <button
                  onClick={() => toggleHidden(c)}
                  disabled={togglingId === c.id}
                  title={c.hidden ? 'Voltar a mostrar nas métricas' : 'Ocultar das métricas (não apaga a conta)'}
                  className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-zinc-800 text-zinc-500 hover:text-white active:scale-95 transition-all"
                >
                  {togglingId === c.id
                    ? <i className="fas fa-circle-notch animate-spin text-xs"></i>
                    : <i className={`fas ${c.hidden ? 'fa-eye' : 'fa-eye-slash'} text-xs`}></i>}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Alternar visão de ocultos */}
      {(hiddenCount > 0 || showHidden) && (
        <button
          onClick={() => setShowHidden(v => !v)}
          className="mt-4 w-full text-zinc-500 hover:text-zinc-300 text-[11px] font-black uppercase tracking-widest py-3 border border-zinc-800 rounded-2xl transition-colors"
        >
          {showHidden ? '← Voltar para a lista' : `Ver ocultos (${hiddenCount})`}
        </button>
      )}
    </div>
  );
};

export default AdminMetrics;
