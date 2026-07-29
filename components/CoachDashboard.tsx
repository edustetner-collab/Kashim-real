
import React, { useState, useEffect } from 'react';
import { useAuth, useUser, useClerk } from '@clerk/clerk-react';
import { useSupabase } from '../lib/useSupabase';
import { parseFormText, ParsedField } from '../lib/parseFormText';
import { formatCurrency } from '../constants';
import ConsultorSettings from './ConsultorSettings';
import AdminMetrics from './AdminMetrics';

interface ClientProfile {
  householdId: string;
  clientId: string | null;
  clientName: string;
  clientEmail: string;
  createdAt: string;
  coachingEndsAt: string;
  status: 'draft' | 'active';
  isPrivate: boolean;
}

interface CoachDashboardProps {
  onEnterClient: (householdId: string, clientName: string) => void;
  isSuperAdmin: boolean;
}

const CoachDashboard: React.FC<CoachDashboardProps> = ({ onEnterClient, isSuperAdmin }) => {
  const { getToken } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const db = useSupabase();

  const [view, setView] = useState<'clients' | 'metrics'>('clients');
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'new'>('all');
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [privacyLoading, setPrivacyLoading] = useState<string | null>(null);
  const [formText, setFormText] = useState('');
  const [parsedFields, setParsedFields] = useState<ParsedField[]>([]);
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [activating, setActivating] = useState<string | null>(null);
  const [activateSuccess, setActivateSuccess] = useState<string | null>(null);
  const [signInLinks, setSignInLinks] = useState<Record<string, string>>({});
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [generatingLink, setGeneratingLink] = useState<string | null>(null);

  useEffect(() => { loadClients(); }, []);

  async function loadClients() {
    setLoading(true);
    try {
      const token = await getToken({ template: 'supabase' });
      const res = await fetch('/api/list-clients', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setClients(data.clients ?? []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function handleParseText() {
    const fields = parseFormText(formText);
    setParsedFields(fields);
  }

  async function handleCreateClient(e: React.FormEvent) {
    e.preventDefault();
    if (!clientName || !clientEmail) return;
    setCreating(true);
    setCreateError('');

    try {
      const token = await getToken({ template: 'supabase' });
      const res = await fetch('/api/create-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: clientName,
          email: clientEmail,
          parsedItems: parsedFields,
          startMonth: new Date().getMonth(),
          startYear: new Date().getFullYear(),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setCreateError(data.error ?? 'Erro ao criar perfil'); return; }
      setShowCreateForm(false);
      setClientName(''); setClientEmail(''); setFormText(''); setParsedFields([]);
      await loadClients();
    } catch {
      setCreateError('Erro de conexão. Tente novamente.');
    } finally {
      setCreating(false);
    }
  }

  async function handleActivateClient(householdId: string) {
    setActivating(householdId);
    try {
      const token = await getToken({ template: 'supabase' });
      const res = await fetch('/api/activate-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ householdId }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error ?? 'Erro ao ativar cliente'); return; }
      setActivateSuccess(householdId);
      if (data.signInUrl) {
        setSignInLinks(prev => ({ ...prev, [householdId]: data.signInUrl }));
      }
      await loadClients();
      setTimeout(() => setActivateSuccess(null), 5000);
    } catch {
      alert('Erro de conexão. Tente novamente.');
    } finally {
      setActivating(null);
    }
  }

  async function handleGenLink(householdId: string) {
    setGeneratingLink(householdId);
    try {
      const token = await getToken({ template: 'supabase' });
      const res = await fetch('/api/gen-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ householdId }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error ?? 'Erro ao gerar link'); return; }
      if (data.signInUrl) {
        setSignInLinks(prev => ({ ...prev, [householdId]: data.signInUrl }));
      }
    } catch {
      alert('Erro de conexão. Tente novamente.');
    } finally {
      setGeneratingLink(null);
    }
  }

  async function handleTogglePrivacy(householdId: string, currentIsPrivate: boolean) {
    setPrivacyLoading(householdId);
    try {
      const token = await getToken({ template: 'supabase' });
      const res = await fetch('/api/toggle-privacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ householdId, isPrivate: !currentIsPrivate }),
      });
      if (res.ok) {
        setClients(prev => prev.map(c =>
          c.householdId === householdId ? { ...c, isPrivate: !currentIsPrivate } : c
        ));
      }
    } catch (e) { console.error(e); }
    finally { setPrivacyLoading(null); }
  }

  async function handleDeleteClient(householdId: string, clientId: string | null) {
    try {
      const token = await getToken({ template: 'supabase' });
      await fetch('/api/delete-client', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ householdId, clientClerkId: clientId }),
      });
      setDeleteConfirm(null);
      await loadClients();
    } catch (e) { console.error(e); }
  }

  function daysRemaining(endsAt: string) {
    const diff = new Date(endsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  const draftCount = clients.filter(c => c.status === 'draft').length;
  const activeCount = clients.filter(c => c.status === 'active').length;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">

      {showSettings && db && (
        <ConsultorSettings db={db} onClose={() => setShowSettings(false)} />
      )}

      {/* Header */}
      <header className="bg-[#0f0f0f] border-b border-green-500/30 px-6 py-3 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/kashim-icon.png" alt="Kashim" className="h-9 w-9 rounded-xl" />
            <span className="text-xl font-black text-white uppercase tracking-widest hidden md:block">Kashim</span>
            <span className="text-[9px] font-black uppercase text-green-400 bg-green-400/10 border border-green-400/20 px-2 py-0.5 rounded-full ml-1">Consultor</span>
          </div>
          <div className="flex items-center gap-2">
            {user && (
              <div className="hidden md:flex items-center gap-2 border-r border-zinc-800 pr-3 mr-1">
                <img src={user.imageUrl} className="w-7 h-7 rounded-full border border-green-400/30" alt="Avatar" />
                <span className="text-[10px] font-black uppercase text-zinc-400">{user.firstName || user.emailAddresses[0]?.emailAddress.split('@')[0]}</span>
              </div>
            )}
            <button onClick={() => setShowSettings(true)} className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-zinc-300 hover:text-white transition-all text-xs font-black uppercase">
              <i className="fas fa-cog"></i>
              <span className="hidden md:inline">Configurações</span>
            </button>
            <button onClick={() => signOut()} className="px-3 py-2 bg-zinc-800 hover:bg-red-500/20 text-zinc-500 hover:text-red-400 rounded-xl transition-all" title="Sair">
              <i className="fas fa-sign-out-alt"></i>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Alternador Clientes / Métricas — métricas só para o super-admin */}
        {isSuperAdmin && (
          <div className="flex gap-2 mb-5">
            <button
              onClick={() => setView('clients')}
              className={`flex-1 md:flex-none md:px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wide transition-all border ${
                view === 'clients' ? 'bg-green-500 text-black border-green-500' : 'bg-zinc-900 text-zinc-400 border-zinc-800'
              }`}
            >
              <i className="fas fa-users mr-2"></i>Clientes
            </button>
            <button
              onClick={() => setView('metrics')}
              className={`flex-1 md:flex-none md:px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wide transition-all border ${
                view === 'metrics' ? 'bg-green-500 text-black border-green-500' : 'bg-zinc-900 text-zinc-400 border-zinc-800'
              }`}
            >
              <i className="fas fa-chart-line mr-2"></i>Métricas
            </button>
          </div>
        )}

        {view === 'metrics' && isSuperAdmin ? (
          <AdminMetrics />
        ) : (
        <>
        {/* Topo */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-black uppercase italic tracking-tighter text-white">Clientes</h1>
            <p className="text-zinc-500 text-xs mt-0.5">
              {activeCount} ativo{activeCount !== 1 ? 's' : ''}
              {draftCount > 0 && <span className="ml-2 text-zinc-600">· {draftCount} rascunho{draftCount !== 1 ? 's' : ''}</span>}
            </p>
          </div>
          <button
            onClick={() => setShowCreateForm(true)}
            className="bg-green-500 active:bg-green-400 text-black font-black px-4 py-2.5 rounded-xl transition-all shadow-lg flex items-center gap-2 uppercase text-xs"
          >
            <i className="fas fa-plus"></i> Criar novo perfil
          </button>
        </div>

        {/* Busca — filtra por nome ou e-mail conforme digita */}
        {!loading && clients.length > 0 && (
          <div className="relative mb-4">
            <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 text-sm"></i>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar cliente por nome ou e-mail..."
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
        )}

        {/* Filtro — Todos vs Novos (aguardando 1ª reunião) */}
        {!loading && clients.length > 0 && (
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wide transition-all border ${
                filter === 'all' ? 'bg-green-500 text-black border-green-500' : 'bg-zinc-900 text-zinc-400 border-zinc-800'
              }`}
            >
              Todos ({clients.length})
            </button>
            <button
              onClick={() => setFilter('new')}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wide transition-all border flex items-center gap-2 ${
                filter === 'new' ? 'bg-amber-400 text-black border-amber-400' : 'bg-zinc-900 text-amber-400/80 border-amber-500/30'
              }`}
            >
              <i className="fas fa-star text-[10px]"></i>
              Novos ({draftCount})
            </button>
          </div>
        )}

        {/* Lista */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <i className="fas fa-circle-notch animate-spin text-green-400 text-3xl"></i>
          </div>
        ) : clients.length === 0 ? (
          <div className="text-center py-20 text-zinc-600">
            <i className="fas fa-users text-5xl mb-4 block"></i>
            <p className="font-black uppercase text-sm tracking-widest">Nenhum cliente ainda</p>
            <p className="text-xs mt-2">Clique em "Criar novo perfil" para começar</p>
          </div>
        ) : (() => {
          const q = search.trim().toLowerCase();
          const visible = clients.filter(c => {
            if (filter === 'new' && c.status !== 'draft') return false;
            if (!q) return true;
            return (c.clientName ?? '').toLowerCase().includes(q) ||
                   (c.clientEmail ?? '').toLowerCase().includes(q);
          });
          if (visible.length === 0) {
            return (
              <div className="text-center py-16 text-zinc-600">
                <i className={`fas ${filter === 'new' ? 'fa-star' : 'fa-user-slash'} text-4xl mb-3 block`}></i>
                <p className="font-black uppercase text-sm tracking-widest">
                  {filter === 'new' ? 'Nenhum cliente novo aguardando' : 'Nenhum cliente encontrado'}
                </p>
                <p className="text-xs mt-2">
                  {filter === 'new' ? 'Perfis novos aparecem aqui até você ativar' : 'Tente outro nome ou e-mail'}
                </p>
              </div>
            );
          }
          return (
          <div className="flex flex-col gap-3">
            {visible.map(client => {
              const days = daysRemaining(client.coachingEndsAt);
              const isExpiring = days < 30;
              const isDraft = client.status === 'draft';
              const justActivated = activateSuccess === client.householdId;

              return (
                <div key={client.householdId}>
                  <div className={`rounded-2xl border p-4 transition-all ${
                    isDraft ? 'bg-amber-500/5 border-amber-500/40' : 'bg-zinc-900 border-zinc-800'
                  }`}>
                    {/* Linha 1: Nome + badges */}
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-white font-black text-sm uppercase italic">{client.clientName}</p>
                          {isDraft && (
                            <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-400"><i className="fas fa-star mr-1"></i>Novo</span>
                          )}
                          {justActivated && (
                            <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">
                              <i className="fas fa-check mr-1"></i>Ativado!
                            </span>
                          )}
                        </div>
                        <p className="text-zinc-500 text-xs mt-0.5">{client.clientEmail}</p>
                      </div>
                      {/* Status consulta */}
                      <div className="shrink-0 text-right">
                        {isDraft ? (
                          <span className="text-zinc-600 text-[10px]">Aguardando ativação</span>
                        ) : (
                          <span className={`text-xs font-bold ${isExpiring ? 'text-red-400' : 'text-green-400'}`}>
                            {days}d restantes
                          </span>
                        )}
                        <div className="text-zinc-700 text-[9px] mt-0.5">{new Date(client.createdAt).toLocaleDateString('pt-BR')}</div>
                      </div>
                    </div>

                    {/* Linha 2: Ações */}
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      <button
                        onClick={() => onEnterClient(client.householdId, client.clientName)}
                        className="bg-green-500 active:bg-green-400 text-black font-black px-4 py-2 rounded-xl text-xs uppercase transition-all flex items-center gap-1.5"
                      >
                        <i className="fas fa-eye text-xs"></i> Acessar
                      </button>

                      {isSuperAdmin && (isDraft ? (
                        <button
                          onClick={() => handleActivateClient(client.householdId)}
                          disabled={activating === client.householdId}
                          className="bg-green-600 active:bg-green-500 disabled:opacity-50 text-white font-black px-4 py-2 rounded-xl text-xs uppercase transition-all flex items-center gap-1.5"
                        >
                          {activating === client.householdId
                            ? <i className="fas fa-circle-notch animate-spin"></i>
                            : <><i className="fas fa-paper-plane text-xs"></i> Ativar</>}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleGenLink(client.householdId)}
                          disabled={generatingLink === client.householdId}
                          className="bg-zinc-700 active:bg-zinc-600 disabled:opacity-50 text-zinc-300 font-black px-4 py-2 rounded-xl text-xs uppercase transition-all flex items-center gap-1.5"
                        >
                          {generatingLink === client.householdId
                            ? <i className="fas fa-circle-notch animate-spin"></i>
                            : <><i className="fas fa-link text-xs"></i> Link</>}
                        </button>
                      ))}

                      <div className="flex gap-1.5 ml-auto">
                        <button
                          onClick={() => handleTogglePrivacy(client.householdId, client.isPrivate)}
                          disabled={privacyLoading === client.householdId}
                          className={`w-9 h-9 rounded-xl transition-all flex items-center justify-center disabled:opacity-50 ${
                            client.isPrivate ? 'bg-green-500/20 text-green-400' : 'bg-zinc-800 text-zinc-500'
                          }`}
                        >
                          {privacyLoading === client.householdId
                            ? <i className="fas fa-circle-notch animate-spin text-xs"></i>
                            : <i className={`fas ${client.isPrivate ? 'fa-lock' : 'fa-lock-open'} text-xs`}></i>
                          }
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(client.householdId)}
                          className="w-9 h-9 bg-zinc-800 active:bg-red-500/20 text-zinc-500 active:text-red-400 rounded-xl transition-all flex items-center justify-center"
                        >
                          <i className="fas fa-trash-alt text-xs"></i>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Link de acesso gerado após ativação */}
                  {signInLinks[client.householdId] && (
                    <div className="mx-1 mb-1 p-3 bg-green-500/10 border border-green-500/20 rounded-xl flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-green-400 text-[10px] font-black uppercase tracking-wider mb-0.5">
                          <i className="fas fa-link mr-1"></i>Link de acesso gerado
                        </p>
                        <p className="text-zinc-400 text-[10px] truncate">{signInLinks[client.householdId]}</p>
                      </div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(signInLinks[client.householdId]);
                          setCopiedLink(client.householdId);
                          setTimeout(() => setCopiedLink(null), 2500);
                        }}
                        className="shrink-0 bg-green-600 hover:bg-green-500 text-white font-black text-[10px] px-3 py-1.5 rounded-lg uppercase transition-all flex items-center gap-1.5"
                      >
                        {copiedLink === client.householdId
                          ? <><i className="fas fa-check"></i> Copiado!</>
                          : <><i className="fas fa-copy"></i> Copiar link</>
                        }
                      </button>
                    </div>
                  )}

                  {/* Confirmação de exclusão */}
                  {deleteConfirm === client.householdId && (
                    <div className="mx-1 mb-1 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-between">
                      <p className="text-red-400 text-xs font-bold">Excluir {client.clientName}?</p>
                      <div className="flex gap-2">
                        <button onClick={() => handleDeleteClient(client.householdId, client.clientId)} className="bg-red-600 text-white font-black text-xs px-3 py-1.5 rounded-lg uppercase">Confirmar</button>
                        <button onClick={() => setDeleteConfirm(null)} className="bg-zinc-700 text-white font-black text-xs px-3 py-1.5 rounded-lg uppercase">Cancelar</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          );
        })()}
        </>
        )}
      </main>

      {/* Modal criar perfil */}
      {showCreateForm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
          <div className="max-w-2xl w-full bg-zinc-900 border border-zinc-800 rounded-[30px] p-8 my-4 relative">
            <button onClick={() => { setShowCreateForm(false); setParsedFields([]); setFormText(''); }} className="absolute top-4 right-4 w-8 h-8 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-400 hover:text-white">
              <i className="fas fa-times text-xs"></i>
            </button>

            <h2 className="text-xl font-black uppercase italic tracking-tighter text-white mb-1">
              <i className="fas fa-user-plus text-green-400 mr-2"></i>
              Novo Perfil de Cliente
            </h2>
            <p className="text-zinc-500 text-xs mb-6">O cliente não receberá e-mail agora. O acesso só é enviado ao clicar em "Ativar".</p>

            <form onSubmit={handleCreateClient} className="flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-1 block">Nome completo</label>
                  <input type="text" value={clientName} onChange={e => setClientName(e.target.value)} required placeholder="Maria Silva"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-3 text-white text-sm outline-none focus:border-green-400 transition-all" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-1 block">E-mail do cliente</label>
                  <input type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)} required placeholder="maria@email.com"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-3 text-white text-sm outline-none focus:border-green-400 transition-all" />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-1 block">Formulário financeiro (opcional)</label>
                <textarea value={formText} onChange={e => setFormText(e.target.value)}
                  placeholder="Cole aqui o formulário preenchido pelo cliente..." rows={8}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-3 text-white text-sm outline-none focus:border-green-400 transition-all resize-none font-mono" />
                {formText && (
                  <button type="button" onClick={handleParseText} className="mt-2 text-xs text-green-400 hover:text-green-300 font-black uppercase underline">
                    Interpretar formulário
                  </button>
                )}
              </div>

              {parsedFields.length > 0 && (
                <div className="bg-zinc-800 rounded-2xl p-4 max-h-48 overflow-y-auto">
                  <p className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-3">{parsedFields.length} campos interpretados</p>
                  <div className="space-y-1">
                    {parsedFields.map((f, i) => {
                      const tag = f.category === 'credit' ? 'Cartão' : f.category === 'variable' ? 'Variável' : f.isIncome ? 'Renda' : 'Fixa';
                      const months = f.monthlyValues?.filter(v => v > 0).length ?? 0;
                      return (
                        <div key={i} className="flex justify-between items-center text-xs gap-2">
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span className={`shrink-0 text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${f.category === 'credit' ? 'bg-orange-500/20 text-orange-300' : f.category === 'variable' ? 'bg-blue-500/20 text-blue-300' : f.isIncome ? 'bg-green-500/20 text-green-300' : 'bg-zinc-700 text-zinc-300'}`}>{tag}</span>
                            <span className={`truncate ${f.isIncome ? 'text-green-400' : 'text-zinc-400'}`}>{f.description}</span>
                          </span>
                          <span className="text-green-300 font-bold shrink-0">
                            {formatCurrency(f.value)}{months > 1 ? ` ×${months}m` : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {createError && (
                <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{createError}</p>
              )}

              <button type="submit" disabled={creating}
                className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-black py-4 rounded-2xl transition-all shadow-lg uppercase text-sm">
                {creating ? <i className="fas fa-circle-notch animate-spin"></i> : 'Criar perfil'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CoachDashboard;
