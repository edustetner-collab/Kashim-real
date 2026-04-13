
import React, { useState, useEffect } from 'react';
import { useAuth, useUser, useClerk } from '@clerk/clerk-react';
import { useSupabase } from '../lib/useSupabase';
import { parseFormText, ParsedField } from '../lib/parseFormText';
import { formatCurrency } from '../constants';
import ConsultorSettings from './ConsultorSettings';

interface ClientProfile {
  householdId: string;
  clientId: string | null;
  clientName: string;
  clientEmail: string;
  createdAt: string;
  coachingEndsAt: string;
  status: 'draft' | 'active';
}

interface CoachDashboardProps {
  onEnterClient: (householdId: string, clientName: string) => void;
}

const CoachDashboard: React.FC<CoachDashboardProps> = ({ onEnterClient }) => {
  const { getToken } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const db = useSupabase();

  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
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
      <header className="bg-[#0f0f0f] border-b border-yellow-600/30 px-6 py-3 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/kashim-icon.png" alt="Kashim" className="h-9 w-9 rounded-xl" />
            <span className="text-xl font-black text-white uppercase tracking-widest hidden md:block">Kashim</span>
            <span className="text-[9px] font-black uppercase text-yellow-500 bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded-full ml-1">Consultor</span>
          </div>
          <div className="flex items-center gap-2">
            {user && (
              <div className="hidden md:flex items-center gap-2 border-r border-zinc-800 pr-3 mr-1">
                <img src={user.imageUrl} className="w-7 h-7 rounded-full border border-yellow-500/30" alt="Avatar" />
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

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Topo */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-black uppercase italic tracking-tighter text-white">Clientes</h1>
            <p className="text-zinc-500 text-xs mt-0.5">
              {activeCount} ativo{activeCount !== 1 ? 's' : ''}
              {draftCount > 0 && <span className="ml-2 text-zinc-600">· {draftCount} rascunho{draftCount !== 1 ? 's' : ''}</span>}
            </p>
          </div>
          <button
            onClick={() => setShowCreateForm(true)}
            className="bg-yellow-600 hover:bg-yellow-500 text-black font-black px-5 py-2.5 rounded-xl transition-all shadow-lg flex items-center gap-2 uppercase text-xs"
          >
            <i className="fas fa-plus"></i> Criar novo perfil
          </button>
        </div>

        {/* Lista */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <i className="fas fa-circle-notch animate-spin text-yellow-500 text-3xl"></i>
          </div>
        ) : clients.length === 0 ? (
          <div className="text-center py-20 text-zinc-600">
            <i className="fas fa-users text-5xl mb-4 block"></i>
            <p className="font-black uppercase text-sm tracking-widest">Nenhum cliente ainda</p>
            <p className="text-xs mt-2">Clique em "Criar novo perfil" para começar</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Cabeçalho da tabela */}
            <div className="grid grid-cols-[1fr_180px_90px_auto] gap-3 px-4 py-2 text-[10px] font-black uppercase text-zinc-600 tracking-widest">
              <span>Cliente</span>
              <span>Status</span>
              <span className="text-center">Consulta</span>
              <span></span>
            </div>

            {clients.map(client => {
              const days = daysRemaining(client.coachingEndsAt);
              const isExpiring = days < 30;
              const isDraft = client.status === 'draft';
              const justActivated = activateSuccess === client.householdId;

              return (
                <div key={client.householdId}>
                  <div className={`grid grid-cols-[1fr_180px_90px_auto] gap-3 items-center px-4 py-3 rounded-2xl border transition-all ${
                    isDraft ? 'bg-zinc-900/60 border-zinc-800' : 'bg-zinc-900 border-zinc-800 hover:border-yellow-600/20'
                  }`}>
                    {/* Nome + e-mail */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-white font-black text-sm uppercase italic truncate">{client.clientName}</p>
                        {isDraft && (
                          <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full bg-zinc-700 text-zinc-400 shrink-0">Rascunho</span>
                        )}
                        {justActivated && (
                          <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 shrink-0">
                            <i className="fas fa-check mr-1"></i>Ativado!
                          </span>
                        )}
                      </div>
                      <p className="text-zinc-500 text-xs truncate">{client.clientEmail}</p>
                    </div>

                    {/* Status de consultoria */}
                    <div>
                      {isDraft ? (
                        <span className="text-zinc-500 text-xs">Aguardando ativação</span>
                      ) : (
                        <span className={`text-xs font-bold ${isExpiring ? 'text-red-400' : 'text-green-400'}`}>
                          {days}d restantes
                        </span>
                      )}
                    </div>

                    {/* Data de criação */}
                    <div className="text-center">
                      <span className="text-zinc-600 text-[10px]">
                        {new Date(client.createdAt).toLocaleDateString('pt-BR')}
                      </span>
                    </div>

                    {/* Ações */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => onEnterClient(client.householdId, client.clientName)}
                        className="bg-yellow-600 hover:bg-yellow-500 text-black font-black px-3 py-1.5 rounded-lg text-[10px] uppercase transition-all"
                      >
                        <i className="fas fa-eye mr-1"></i> Acessar
                      </button>

                      {isDraft ? (
                        <button
                          onClick={() => handleActivateClient(client.householdId)}
                          disabled={activating === client.householdId}
                          className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-black px-3 py-1.5 rounded-lg text-[10px] uppercase transition-all"
                        >
                          {activating === client.householdId
                            ? <i className="fas fa-circle-notch animate-spin"></i>
                            : <><i className="fas fa-paper-plane mr-1"></i> Ativar</>}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleGenLink(client.householdId)}
                          disabled={generatingLink === client.householdId}
                          className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-300 hover:text-white font-black px-3 py-1.5 rounded-lg text-[10px] uppercase transition-all"
                          title="Gerar link de acesso"
                        >
                          {generatingLink === client.householdId
                            ? <i className="fas fa-circle-notch animate-spin"></i>
                            : <i className="fas fa-link"></i>}
                        </button>
                      )}

                      <button
                        onClick={() => setDeleteConfirm(client.householdId)}
                        className="w-7 h-7 bg-zinc-800 hover:bg-red-500/20 text-zinc-500 hover:text-red-400 rounded-lg transition-all flex items-center justify-center"
                        title="Excluir"
                      >
                        <i className="fas fa-trash-alt text-[10px]"></i>
                      </button>
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
              <i className="fas fa-user-plus text-yellow-500 mr-2"></i>
              Novo Perfil de Cliente
            </h2>
            <p className="text-zinc-500 text-xs mb-6">O cliente não receberá e-mail agora. O acesso só é enviado ao clicar em "Ativar".</p>

            <form onSubmit={handleCreateClient} className="flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-1 block">Nome completo</label>
                  <input type="text" value={clientName} onChange={e => setClientName(e.target.value)} required placeholder="Maria Silva"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-3 text-white text-sm outline-none focus:border-yellow-500 transition-all" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-1 block">E-mail do cliente</label>
                  <input type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)} required placeholder="maria@email.com"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-3 text-white text-sm outline-none focus:border-yellow-500 transition-all" />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-1 block">Formulário financeiro (opcional)</label>
                <textarea value={formText} onChange={e => setFormText(e.target.value)}
                  placeholder="Cole aqui o formulário preenchido pelo cliente..." rows={8}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-3 text-white text-sm outline-none focus:border-yellow-500 transition-all resize-none font-mono" />
                {formText && (
                  <button type="button" onClick={handleParseText} className="mt-2 text-xs text-yellow-500 hover:text-yellow-400 font-black uppercase underline">
                    Interpretar formulário
                  </button>
                )}
              </div>

              {parsedFields.length > 0 && (
                <div className="bg-zinc-800 rounded-2xl p-4 max-h-48 overflow-y-auto">
                  <p className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-3">{parsedFields.length} campos interpretados</p>
                  <div className="space-y-1">
                    {parsedFields.map((f, i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className={f.isIncome ? 'text-green-400' : 'text-zinc-400'}>{f.description}</span>
                        <span className="text-yellow-400 font-bold">{formatCurrency(f.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {createError && (
                <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{createError}</p>
              )}

              <button type="submit" disabled={creating}
                className="w-full bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-black font-black py-4 rounded-2xl transition-all shadow-lg uppercase text-sm">
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
