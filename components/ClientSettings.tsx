
import React, { useState, useEffect, useRef } from 'react';
import { useUser, useClerk } from '@clerk/clerk-react';
import { SupabaseClient } from '@supabase/supabase-js';

interface ClientSettingsProps {
  db: SupabaseClient;
  householdId: string;
  onClose: () => void;
}

type PasswordView = 'idle' | 'set' | 'change' | 'reset_sent';

const ClientSettings: React.FC<ClientSettingsProps> = ({ db, householdId, onClose }) => {
  const { user } = useUser();
  const { signOut } = useClerk();

  // Coach access
  const [coachAccess, setCoachAccess] = useState<any[]>([]);
  const [revokeConfirm, setRevokeConfirm] = useState(false);
  const [revoking, setRevoking] = useState(false);

  // Password
  const [passwordView, setPasswordView] = useState<PasswordView>('idle');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  // Show/hide password fields
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Photo upload
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const photoInputRef = useRef<HTMLInputElement>(null);

  const hasPassword = user?.passwordEnabled ?? false;

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

  function openPasswordForm() {
    setPasswordView(hasPassword ? 'change' : 'set');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
    setPasswordSuccess('');
  }

  function cancelPassword() {
    setPasswordView('idle');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
    setPasswordSuccess('');
  }

  async function handleSavePassword() {
    setPasswordError('');
    setPasswordSuccess('');

    if (!newPassword || newPassword.length < 8) {
      setPasswordError('A senha deve ter pelo menos 8 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('As senhas não coincidem.');
      return;
    }
    if (hasPassword && !currentPassword) {
      setPasswordError('Informe sua senha atual.');
      return;
    }

    setPasswordLoading(true);
    try {
      await user?.updatePassword({
        newPassword,
        ...(hasPassword ? { currentPassword } : {}),
        signOutOfOtherSessions: false,
      });
      setPasswordSuccess(hasPassword ? 'Senha alterada com sucesso!' : 'Senha cadastrada com sucesso!');
      setPasswordView('idle');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      const msg: string = err?.errors?.[0]?.longMessage ?? err?.message ?? 'Erro ao salvar senha.';
      if (msg.toLowerCase().includes('incorrect') || msg.toLowerCase().includes('wrong')) {
        setPasswordError('Senha atual incorreta.');
      } else if (msg.toLowerCase().includes('pwned') || msg.toLowerCase().includes('common')) {
        setPasswordError('Essa senha é muito comum. Escolha uma senha mais segura.');
      } else {
        setPasswordError(msg);
      }
    } finally {
      setPasswordLoading(false);
    }
  }

  const hasActiveCoach = coachAccess.length > 0;

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError('');
    setPhotoLoading(true);
    try {
      await user?.setProfileImage({ file });
    } catch (err: any) {
      setPhotoError(err?.errors?.[0]?.longMessage ?? err?.message ?? 'Erro ao atualizar foto.');
    } finally {
      setPhotoLoading(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  }

  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto bg-black/80 backdrop-blur-sm flex items-start justify-center p-4 pt-10">
      <div className="max-w-2xl w-full pb-16">

        {/* Header */}
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

        {/* Senha */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 mb-4">
          <h3 className="text-white font-black uppercase italic tracking-tight mb-1 flex items-center gap-2">
            <i className="fas fa-lock text-yellow-500"></i>
            Senha de acesso
          </h3>
          <p className="text-zinc-500 text-xs mb-5">
            {hasPassword
              ? 'Você já tem uma senha cadastrada. Altere-a abaixo quando quiser.'
              : 'Cadastre uma senha para entrar sem precisar receber código por e-mail toda vez.'}
          </p>

          {/* Mensagem de sucesso */}
          {passwordSuccess && passwordView === 'idle' && (
            <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-2xl px-4 py-3 mb-4">
              <i className="fas fa-check-circle text-green-400 text-sm"></i>
              <span className="text-green-400 text-sm font-bold">{passwordSuccess}</span>
            </div>
          )}

          {passwordView === 'idle' && (
            <button
              onClick={openPasswordForm}
              className="w-full bg-yellow-600 hover:bg-yellow-500 text-black font-black py-3 rounded-2xl transition-all text-sm uppercase tracking-widest"
            >
              <i className={`fas ${hasPassword ? 'fa-key' : 'fa-plus'} mr-2`}></i>
              {hasPassword ? 'Alterar senha' : 'Cadastrar senha'}
            </button>
          )}

          {(passwordView === 'set' || passwordView === 'change') && (
            <div className="flex flex-col gap-3">

              {/* Senha atual (só se já tem senha) */}
              {hasPassword && (
                <div>
                  <label className="text-zinc-400 text-xs uppercase tracking-widest block mb-1">
                    Senha atual
                  </label>
                  <div className="relative">
                    <input
                      type={showCurrent ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={e => setCurrentPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-yellow-600 pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrent(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                    >
                      <i className={`fas ${showCurrent ? 'fa-eye-slash' : 'fa-eye'} text-sm`}></i>
                    </button>
                  </div>
                </div>
              )}

              {/* Nova senha */}
              <div>
                <label className="text-zinc-400 text-xs uppercase tracking-widest block mb-1">
                  {hasPassword ? 'Nova senha' : 'Criar senha'}
                </label>
                <div className="relative">
                  <input
                    type={showNew ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-yellow-600 pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    <i className={`fas ${showNew ? 'fa-eye-slash' : 'fa-eye'} text-sm`}></i>
                  </button>
                </div>
              </div>

              {/* Confirmar senha */}
              <div>
                <label className="text-zinc-400 text-xs uppercase tracking-widest block mb-1">
                  Confirmar senha
                </label>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Repita a senha"
                    className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-yellow-600 pr-12"
                    onKeyDown={e => { if (e.key === 'Enter') handleSavePassword(); }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    <i className={`fas ${showConfirm ? 'fa-eye-slash' : 'fa-eye'} text-sm`}></i>
                  </button>
                </div>
              </div>

              {/* Erro */}
              {passwordError && (
                <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                  <i className="fas fa-exclamation-circle text-red-400 text-sm mt-0.5"></i>
                  <span className="text-red-400 text-sm">{passwordError}</span>
                </div>
              )}

              {/* Botões */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSavePassword}
                  disabled={passwordLoading}
                  className="flex-1 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-black font-black py-3 rounded-2xl transition-all text-sm uppercase"
                >
                  {passwordLoading
                    ? <i className="fas fa-circle-notch animate-spin"></i>
                    : hasPassword ? 'Salvar nova senha' : 'Cadastrar senha'}
                </button>
                <button
                  onClick={cancelPassword}
                  className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white font-black py-3 rounded-2xl transition-all text-sm uppercase"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Esqueci minha senha */}
          {hasPassword && passwordView === 'idle' && (
            <div className="mt-4 pt-4 border-t border-zinc-800">
              <p className="text-zinc-500 text-xs">
                <i className="fas fa-info-circle text-zinc-600 mr-1"></i>
                Esqueceu sua senha atual? Saia da conta e clique em{' '}
                <span className="text-zinc-400 font-bold">"Esqueci minha senha"</span>{' '}
                na tela de login para receber um link de redefinição por e-mail.
              </p>
            </div>
          )}
        </div>

        {/* Conta */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 mb-4">
          <h3 className="text-white font-black uppercase italic tracking-tight mb-4 flex items-center gap-2">
            <i className="fas fa-user text-yellow-500"></i>
            Conta
          </h3>
          {user && (
            <div className="flex items-center gap-4 mb-4 p-4 bg-zinc-800 rounded-2xl">
              {/* Avatar + upload trigger */}
              <div className="relative shrink-0">
                <img
                  src={user.imageUrl}
                  className="w-16 h-16 rounded-full border-2 border-yellow-500/30 object-cover"
                  alt="Avatar"
                />
                <button
                  onClick={() => photoInputRef.current?.click()}
                  disabled={photoLoading}
                  className="absolute -bottom-1 -right-1 w-6 h-6 bg-yellow-600 hover:bg-yellow-500 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-90"
                  title="Alterar foto"
                >
                  {photoLoading
                    ? <i className="fas fa-circle-notch animate-spin text-[9px] text-black"></i>
                    : <i className="fas fa-camera text-[9px] text-black"></i>
                  }
                </button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoChange}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-white font-bold text-sm truncate">{user.firstName} {user.lastName}</p>
                <p className="text-zinc-500 text-xs truncate">{user.emailAddresses[0]?.emailAddress}</p>
                <button
                  onClick={() => photoInputRef.current?.click()}
                  disabled={photoLoading}
                  className="text-yellow-600 hover:text-yellow-500 text-[10px] font-bold uppercase tracking-widest mt-1 transition-colors"
                >
                  Alterar foto
                </button>
              </div>
            </div>
          )}
          {photoError && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-4">
              <i className="fas fa-exclamation-circle text-red-400 text-sm"></i>
              <span className="text-red-400 text-xs">{photoError}</span>
            </div>
          )}
          <button
            onClick={() => signOut()}
            className="w-full bg-red-500/10 border border-red-500/20 active:bg-red-500/20 text-red-400 font-black py-3 rounded-2xl transition-all text-sm uppercase flex items-center justify-center gap-2"
          >
            <i className="fas fa-sign-out-alt"></i> Sair da conta
          </button>
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
