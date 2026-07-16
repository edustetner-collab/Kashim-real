import React, { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';

// Dashboard do administrador — usuários ativos, pagantes, último acesso e
// projeção de faturamento. Renderizado dentro do CoachDashboard, SÓ para
// super-admin (a API também recusa qualquer outro usuário).

type Status = 'coach' | 'pagante' | 'trial' | 'expirado' | 'sem_conta';

interface ClientRow {
  name: string;
  email: string;
  lastSignInAt: number | null;
  status: Status;
  trialDaysLeft: number | null;
  isAnnual: boolean;
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

const AdminMetrics: React.FC = () => {
  const { getToken } = useAuth();
  const [data, setData] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
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
        const json = await res.json() as Metrics;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Erro ao carregar métricas');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [getToken]);

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

  return (
    <div className="pb-10">
      {/* Faturamento — destaque principal */}
      <div className="bg-gradient-to-br from-green-950 to-zinc-900 border border-green-500/20 rounded-3xl p-6 mb-4">
        <p className="text-green-500 text-[10px] font-black uppercase tracking-[0.25em] mb-1">Faturamento mensal (MRR)</p>
        <p className="text-white text-4xl font-black font-mono tracking-tight">{formatBRL(t.mrr)}</p>
        <p className="text-zinc-500 text-xs mt-2">
          Potencial se os {t.inTrial} em trial assinarem: <span className="text-green-400 font-bold">{formatBRL(t.potentialMrr)}</span>
        </p>
      </div>

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
      <div className="space-y-2">
        {data.clients.map((c, i) => {
          const access = lastAccessLabel(c.lastSignInAt);
          const meta = STATUS_META[c.status];
          return (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full shrink-0 ${access.fresh ? 'bg-green-400' : 'bg-zinc-700'}`}></div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-bold truncate">{c.name}</p>
                <p className="text-zinc-600 text-[11px] truncate">{c.email}</p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-[11px] font-bold ${access.fresh ? 'text-green-400' : 'text-zinc-500'}`}>{access.text}</p>
                <span className={`inline-block mt-1 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${meta.classes}`}>
                  {meta.label}{c.status === 'trial' && c.trialDaysLeft != null ? ` · ${c.trialDaysLeft}d` : ''}{c.status === 'pagante' && c.isAnnual ? ' · anual' : ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AdminMetrics;
