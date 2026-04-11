
import React, { useState, useEffect } from 'react';
import { UserProfile } from '@clerk/clerk-react';
import { SupabaseClient } from '@supabase/supabase-js';

interface ClientSettingsProps {
  db: SupabaseClient;
  householdId: string;
  onClose: () => void;
}

const ClientSettings: React.FC<ClientSettingsProps> = ({ db, householdId, onClose }) => {
  const [coachAccess, setCoachAccess] = useState<any[]>([]);
  const [revokeConfirm, setRevokeConfirm] = useState(false);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    loadCoachAccess();
  }, [householdId]);

  async function loadCoachAccess() {
    const { data } = await db
      .from('coach_access')
      .select('*')
      .eq('household_id', householdId)
      .eq('status', 'approved');
    setCoachAccess(data ?? []);
  }

  async function handleRevokeCoach() {
    setRevoking(true);
    try {
      await db
        .from('coach_access')
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('household_id', householdId)
        .eq('status', 'approved');
      setRevokeConfirm(false);
      await loadCoachAccess();
    } finally {
      setRevoking(false);
    }
  }

  const hasActiveCoach = coachAccess.length > 0;

  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto bg-black/80 backdrop-blur-sm flex items-start justify-center p-4 pt-10">
      <div className="max-w-2xl w-full">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-black uppercase italic tracking-tighter text-white">
            <i className="fas fa-cog text-yellow-500 mr-2"></i>Configurações
          </h2>
          <button
            onClick={onClose}
            className="w-10 h-10 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Perfil do Clerk — foto, nome, senha, etc */}
        <div className="mb-6 rounded-3xl overflow-hidden">
          <UserProfile
            appearance={{
              elements: {
                rootBox: 'w-full',
                card: 'bg-zinc-900 border border-zinc-800 shadow-none rounded-3xl',
                navbar: 'bg-zinc-950 border-r border-zinc-800',
                navbarButton: 'text-zinc-400 hover:text-white',
                navbarButtonIcon: 'text-zinc-500',
                headerTitle: 'text-white font-black uppercase italic',
                headerSubtitle: 'text-zinc-500',
                formFieldLabel: 'text-zinc-400 text-xs uppercase tracking-widest',
                formFieldInput: 'bg-zinc-800 border-zinc-700 text-white rounded-xl',
                formButtonPrimary: 'bg-yellow-600 hover:bg-yellow-500 text-black font-black uppercase text-xs',
                badge: 'bg-yellow-600/20 text-yellow-500',
              }
            }}
          />
        </div>

        {/* Acesso do Coach */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
          <h3 className="text-white font-black uppercase italic tracking-tight mb-4 flex items-center gap-2">
            <i className="fas fa-user-shield text-yellow-500"></i>
            Acesso do Coach
          </h3>

          {hasActiveCoach ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 bg-green-500/10 border border-green-500/20 rounded-2xl p-4">
                <div className="w-10 h-10 bg-green-500/20 rounded-full flex items-center justify-center">
                  <i className="fas fa-check text-green-400"></i>
                </div>
                <div>
                  <p className="text-green-400 font-bold text-sm">Coach com acesso ativo</p>
                  <p className="text-zinc-500 text-xs">Seu coach pode visualizar e editar seu plano financeiro</p>
                </div>
              </div>

              {!revokeConfirm ? (
                <button
                  onClick={() => setRevokeConfirm(true)}
                  className="w-full bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-400 font-black py-3 rounded-2xl transition-all text-sm uppercase"
                >
                  <i className="fas fa-user-slash mr-2"></i>
                  Revogar acesso do coach
                </button>
              ) : (
                <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
                  <p className="text-red-400 font-bold text-sm mb-1">Tem certeza?</p>
                  <p className="text-zinc-500 text-xs mb-4">
                    Seu coach não poderá mais acessar seus dados. Esta ação pode ser desfeita entrando em contato com ele.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleRevokeCoach}
                      disabled={revoking}
                      className="flex-1 bg-red-600 hover:bg-red-500 text-white font-black py-2.5 rounded-xl text-xs uppercase transition-all"
                    >
                      {revoking ? <i className="fas fa-circle-notch animate-spin"></i> : 'Sim, revogar'}
                    </button>
                    <button
                      onClick={() => setRevokeConfirm(false)}
                      className="flex-1 bg-zinc-700 text-white font-black py-2.5 rounded-xl text-xs uppercase"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 bg-zinc-800/50 border border-zinc-700 rounded-2xl p-4">
              <div className="w-10 h-10 bg-zinc-700 rounded-full flex items-center justify-center">
                <i className="fas fa-user-slash text-zinc-500"></i>
              </div>
              <div>
                <p className="text-zinc-400 font-bold text-sm">Sem acesso do coach</p>
                <p className="text-zinc-600 text-xs">O coach não tem acesso ao seu plano</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClientSettings;
