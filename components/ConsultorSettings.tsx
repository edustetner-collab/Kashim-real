
import React, { useState, useEffect } from 'react';
import { UserProfile, useUser, useClerk, useAuth } from '@clerk/clerk-react';
import { SupabaseClient } from '@supabase/supabase-js';

interface ConsultorSettingsProps {
  db: SupabaseClient;
  onClose: () => void;
}

const ConsultorSettings: React.FC<ConsultorSettingsProps> = ({ db, onClose }) => {
  const { user } = useUser();
  const { signOut } = useClerk();
  const { getToken } = useAuth();
  const [assistants, setAssistants] = useState<{ id: string; email: string; name: string }[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState('');
  const [tab, setTab] = useState<'perfil' | 'equipe'>('perfil');

  useEffect(() => { loadAssistants(); }, []);

  async function loadAssistants() {
    const { data } = await db.from('admin_users').select('*').order('created_at');
    setAssistants(data ?? []);
  }

  async function handleAddAssistant(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail || !newName) return;
    setAdding(true);
    setAddError('');
    setAddSuccess('');

    try {
      const token = await getToken({ template: 'supabase' });
      const res = await fetch('/api/invite-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: newEmail, name: newName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Erro ao enviar convite');

      if (data.alreadyExists) {
        setAddSuccess(`${newName} já tem conta no Kashim e foi adicionada à equipe!`);
      } else {
        setAddSuccess(`Convite enviado para ${newEmail}! Ela vai receber um e-mail para criar a conta.`);
      }
      setNewEmail('');
      setNewName('');
      await loadAssistants();
    } catch (e: any) {
      setAddError(e.message ?? 'Erro ao adicionar. Tente novamente.');
    } finally {
      setAdding(false);
    }
  }

  async function handleRemoveAssistant(id: string) {
    await db.from('admin_users').delete().eq('id', id);
    await loadAssistants();
  }

  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto bg-black/85 backdrop-blur-sm flex items-start justify-center p-4 pt-8">
      <div className="max-w-2xl w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <img src="/kashim-icon.png" className="h-8 w-8 rounded-lg" alt="Kashim" />
            <h2 className="text-2xl font-black uppercase italic tracking-tighter text-white">Configurações</h2>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 bg-zinc-900 p-1 rounded-xl border border-zinc-800 mb-6">
          <button
            onClick={() => setTab('perfil')}
            className={`flex-1 py-2 rounded-lg text-xs font-black uppercase transition-all ${tab === 'perfil' ? 'bg-yellow-600 text-black' : 'text-zinc-400 hover:text-white'}`}
          >
            <i className="fas fa-user mr-2"></i>Meu Perfil
          </button>
          <button
            onClick={() => setTab('equipe')}
            className={`flex-1 py-2 rounded-lg text-xs font-black uppercase transition-all ${tab === 'equipe' ? 'bg-yellow-600 text-black' : 'text-zinc-400 hover:text-white'}`}
          >
            <i className="fas fa-users mr-2"></i>Minha Equipe
          </button>
        </div>

        {tab === 'perfil' && (
          <div>
            {/* Info do consultor */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 mb-5 flex items-center gap-4">
              {user?.imageUrl && (
                <img src={user.imageUrl} className="w-14 h-14 rounded-full border-2 border-yellow-500/30" alt="Avatar" />
              )}
              <div>
                <p className="text-white font-black text-lg">{user?.fullName || user?.firstName}</p>
                <p className="text-zinc-500 text-xs">{user?.emailAddresses[0]?.emailAddress}</p>
                <span className="text-[9px] font-black uppercase text-yellow-500 bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded-full mt-1 inline-block">Consultor</span>
              </div>
            </div>

            {/* Clerk UserProfile */}
            <div className="rounded-3xl overflow-hidden">
              <UserProfile
                appearance={{
                  elements: {
                    rootBox: 'w-full',
                    card: 'bg-zinc-900 border border-zinc-800 shadow-none rounded-3xl',
                    navbar: 'bg-zinc-950 border-r border-zinc-800',
                    navbarButton: 'text-zinc-400 hover:text-white',
                    headerTitle: 'text-white font-black uppercase italic',
                    headerSubtitle: 'text-zinc-500',
                    formFieldLabel: 'text-zinc-400 text-xs uppercase tracking-widest',
                    formFieldInput: 'bg-zinc-800 border-zinc-700 text-white rounded-xl',
                    formButtonPrimary: 'bg-yellow-600 hover:bg-yellow-500 text-black font-black uppercase text-xs',
                    navbarButton__apiKeys: { display: 'none' },
                  }
                }}
              />
            </div>
            <p className="text-zinc-600 text-[10px] text-center mt-2 uppercase tracking-widest">
              <i className="fas fa-camera mr-1"></i>Para trocar sua foto, clique no avatar dentro da aba "Perfil" acima
            </p>

            <button
              onClick={() => signOut()}
              className="mt-4 w-full bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-400 font-black py-3 rounded-2xl transition-all text-sm uppercase"
            >
              <i className="fas fa-sign-out-alt mr-2"></i>Sair da conta
            </button>
          </div>
        )}

        {tab === 'equipe' && (
          <div className="space-y-5">
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
              <h3 className="text-white font-black uppercase italic tracking-tight mb-1 flex items-center gap-2">
                <i className="fas fa-user-plus text-yellow-500"></i>
                Adicionar Assistente
              </h3>
              <p className="text-zinc-500 text-xs mb-5">
                A assistente precisa criar conta no Kashim com o e-mail que você cadastrar aqui.
              </p>

              <form onSubmit={handleAddAssistant} className="flex flex-col gap-3">
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Nome da assistente"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-3 text-white text-sm outline-none focus:border-yellow-500 transition-all"
                />
                <input
                  type="email"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="email@exemplo.com"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-3 text-white text-sm outline-none focus:border-yellow-500 transition-all"
                />
                {addError && <p className="text-red-400 text-xs">{addError}</p>}
                {addSuccess && <p className="text-green-400 text-xs">{addSuccess}</p>}
                <button
                  type="submit"
                  disabled={adding || !newEmail || !newName}
                  className="w-full bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-black font-black py-3 rounded-2xl transition-all text-sm uppercase"
                >
                  {adding ? <i className="fas fa-circle-notch animate-spin"></i> : 'Adicionar à equipe'}
                </button>
              </form>
            </div>

            {/* Lista de assistentes */}
            {assistants.length > 0 && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
                <h3 className="text-white font-black uppercase italic tracking-tight mb-4 flex items-center gap-2">
                  <i className="fas fa-users text-yellow-500"></i>
                  Equipe Ativa
                </h3>
                <div className="space-y-3">
                  {assistants.map(a => (
                    <div key={a.id} className="flex items-center justify-between bg-zinc-800 rounded-2xl px-4 py-3">
                      <div>
                        <p className="text-white font-bold text-sm">{a.name}</p>
                        <p className="text-zinc-500 text-xs">{a.email}</p>
                      </div>
                      <button
                        onClick={() => handleRemoveAssistant(a.id)}
                        className="w-8 h-8 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl flex items-center justify-center transition-all"
                      >
                        <i className="fas fa-times text-xs"></i>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ConsultorSettings;
