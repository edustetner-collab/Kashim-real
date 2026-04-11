
import React, { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { parseFormText, ParsedField } from '../lib/parseFormText';
import { formatCurrency } from '../constants';

interface ClientProfile {
  householdId: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  createdAt: string;
  coachingEndsAt: string;
}

interface CoachDashboardProps {
  onEnterClient: (householdId: string, clientName: string) => void;
}

const CoachDashboard: React.FC<CoachDashboardProps> = ({ onEnterClient }) => {
  const { getToken } = useAuth();
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formText, setFormText] = useState('');
  const [parsedFields, setParsedFields] = useState<ParsedField[]>([]);
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

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
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: clientName,
          email: clientEmail,
          parsedItems: parsedFields,
          startMonth: new Date().getMonth(),
          startYear: new Date().getFullYear(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error ?? 'Erro ao criar perfil');
        return;
      }

      setShowCreateForm(false);
      setClientName('');
      setClientEmail('');
      setFormText('');
      setParsedFields([]);
      await loadClients();
    } catch (e) {
      setCreateError('Erro de conexão. Tente novamente.');
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteClient(householdId: string, clientId: string) {
    try {
      const token = await getToken({ template: 'supabase' });
      await fetch('/api/delete-client', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ householdId, clientClerkId: clientId }),
      });
      setDeleteConfirm(null);
      await loadClients();
    } catch (e) {
      console.error(e);
    }
  }

  function daysRemaining(endsAt: string) {
    const diff = new Date(endsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="bg-[#0f0f0f] border-b border-yellow-600/30 px-8 py-4 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <span className="text-2xl font-black italic bg-clip-text text-transparent bg-gradient-to-b from-yellow-200 to-yellow-700 uppercase tracking-tighter">
            RICO nessa vida — Coach
          </span>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">Dashboard</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 py-10">
        {/* Topo */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-black uppercase italic tracking-tighter text-white">Clientes</h1>
            <p className="text-zinc-500 text-sm mt-1">{clients.length} perfil{clients.length !== 1 ? 's' : ''} ativo{clients.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={() => setShowCreateForm(true)}
            className="bg-yellow-600 hover:bg-yellow-500 text-black font-black px-6 py-3 rounded-2xl transition-all shadow-lg flex items-center gap-2 uppercase text-sm"
          >
            <i className="fas fa-plus"></i> Criar novo perfil
          </button>
        </div>

        {/* Lista de clientes */}
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {clients.map(client => {
              const days = daysRemaining(client.coachingEndsAt);
              const isExpiring = days < 30;
              return (
                <div key={client.householdId} className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 hover:border-yellow-600/30 transition-all group">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-12 h-12 bg-yellow-600/10 rounded-2xl flex items-center justify-center border border-yellow-600/20">
                      <i className="fas fa-user text-yellow-500"></i>
                    </div>
                    <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full ${isExpiring ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                      {days}d restantes
                    </span>
                  </div>

                  <h3 className="text-white font-black text-lg uppercase italic tracking-tight mb-1">{client.clientName}</h3>
                  <p className="text-zinc-500 text-xs mb-4">{client.clientEmail}</p>
                  <p className="text-zinc-700 text-[9px] uppercase tracking-widest mb-4">
                    Criado em {new Date(client.createdAt).toLocaleDateString('pt-BR')}
                  </p>

                  <div className="flex gap-2">
                    <button
                      onClick={() => onEnterClient(client.householdId, client.clientName)}
                      className="flex-1 bg-yellow-600 hover:bg-yellow-500 text-black font-black py-2.5 rounded-xl transition-all text-xs uppercase"
                    >
                      <i className="fas fa-eye mr-1"></i> Acessar
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(client.householdId)}
                      className="w-10 h-10 bg-zinc-800 hover:bg-red-500/20 text-zinc-500 hover:text-red-400 rounded-xl transition-all flex items-center justify-center"
                    >
                      <i className="fas fa-trash-alt text-xs"></i>
                    </button>
                  </div>

                  {deleteConfirm === client.householdId && (
                    <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                      <p className="text-red-400 text-xs mb-2 font-bold">Excluir perfil de {client.clientName}?</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDeleteClient(client.householdId, client.clientId)}
                          className="flex-1 bg-red-600 text-white font-black text-xs py-2 rounded-lg uppercase"
                        >
                          Confirmar
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="flex-1 bg-zinc-700 text-white font-black text-xs py-2 rounded-lg uppercase"
                        >
                          Cancelar
                        </button>
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
            <button
              onClick={() => { setShowCreateForm(false); setParsedFields([]); setFormText(''); }}
              className="absolute top-4 right-4 w-8 h-8 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-400 hover:text-white"
            >
              <i className="fas fa-times text-xs"></i>
            </button>

            <h2 className="text-xl font-black uppercase italic tracking-tighter text-white mb-6">
              <i className="fas fa-user-plus text-yellow-500 mr-2"></i>
              Novo Perfil de Cliente
            </h2>

            <form onSubmit={handleCreateClient} className="flex flex-col gap-5">
              {/* Dados do cliente */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-1 block">Nome completo</label>
                  <input
                    type="text"
                    value={clientName}
                    onChange={e => setClientName(e.target.value)}
                    required
                    placeholder="Maria Silva"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-3 text-white text-sm outline-none focus:border-yellow-500 transition-all"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-1 block">E-mail do cliente</label>
                  <input
                    type="email"
                    value={clientEmail}
                    onChange={e => setClientEmail(e.target.value)}
                    required
                    placeholder="maria@email.com"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-3 text-white text-sm outline-none focus:border-yellow-500 transition-all"
                  />
                </div>
              </div>

              {/* Área de texto do formulário */}
              <div>
                <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-1 block">
                  Cole aqui o texto do formulário
                </label>
                <textarea
                  value={formText}
                  onChange={e => { setFormText(e.target.value); setParsedFields([]); }}
                  rows={8}
                  placeholder={"Renda: R$ 7.662\n* Telefone fixo: Não tenho esse gasto\n* Internet: 93,40\n* Celular: 53,81\n..."}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-3 text-white text-sm outline-none focus:border-yellow-500 transition-all font-mono resize-none"
                />
                <button
                  type="button"
                  onClick={handleParseText}
                  disabled={!formText.trim()}
                  className="mt-2 bg-zinc-700 hover:bg-zinc-600 text-white font-black px-4 py-2 rounded-xl text-xs uppercase transition-all disabled:opacity-40"
                >
                  <i className="fas fa-magic mr-1"></i> Interpretar texto
                </button>
              </div>

              {/* Preview dos campos interpretados */}
              {parsedFields.length > 0 && (
                <div className="bg-zinc-800/50 border border-zinc-700 rounded-2xl p-4">
                  <p className="text-[10px] font-black uppercase text-yellow-500 tracking-widest mb-3">
                    {parsedFields.length} campos interpretados — replicados nos 12 meses
                  </p>
                  <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                    {parsedFields.map((f, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className={`font-bold ${f.isIncome ? 'text-green-400' : 'text-zinc-300'}`}>
                          {f.isIncome ? '↑' : '↓'} {f.description}
                        </span>
                        <span className="font-mono text-zinc-400">{formatCurrency(f.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {createError && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-red-400 text-sm">
                  <i className="fas fa-exclamation-circle mr-2"></i>{createError}
                </div>
              )}

              <button
                type="submit"
                disabled={creating || !clientName || !clientEmail}
                className="bg-yellow-600 hover:bg-yellow-500 text-black font-black py-4 rounded-2xl uppercase text-sm tracking-widest transition-all disabled:opacity-50 shadow-lg"
              >
                {creating
                  ? <><i className="fas fa-circle-notch animate-spin mr-2"></i>Criando perfil...</>
                  : <><i className="fas fa-user-check mr-2"></i>Criar perfil e enviar acesso</>
                }
              </button>

              <p className="text-zinc-600 text-[10px] text-center">
                O cliente receberá um e-mail para definir a senha e acessar o sistema
              </p>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CoachDashboard;
