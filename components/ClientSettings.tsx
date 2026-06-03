
import React, { useState, useEffect, useRef } from 'react';
import { useUser, useClerk, useSignIn, useAuth } from '@clerk/clerk-react';
import { SupabaseClient } from '@supabase/supabase-js';
import { NotificationPrefs, SummaryData } from '../types';
import { saveNotificationPrefs, loadNotificationPrefs } from '../lib/db';
import { MONTHS_BR } from '../constants';
import InvitePartner from './InvitePartner';

interface ClientSettingsProps {
  db: SupabaseClient;
  householdId: string;
  onClose: () => void;
  summary?: SummaryData;
  currentMonthIdx?: number;
  currentYear?: number;
  subscriptionStatus?: string | null;
}

type PasswordView = 'idle' | 'set' | 'change';
type SettingsTab = 'conta' | 'notificacoes' | 'parceiro' | 'assinatura';

const DEFAULT_PREFS: NotificationPrefs = {
  weeklyEmail: false,
  pushEnabled: false,
  alertThresholdPct: 80,
  recurringReminderDay: 20,
};

const ClientSettings: React.FC<ClientSettingsProps> = ({ db, householdId, onClose, summary, currentMonthIdx, currentYear, subscriptionStatus }) => {
  const { user } = useUser();
  const { signOut } = useClerk();
  const { signIn, setActive } = useSignIn();
  const { getToken } = useAuth();
  const [tab, setTab] = useState<SettingsTab>('conta');

  // Subscription
  const [subLoading, setSubLoading] = useState(false);
  const [subError, setSubError] = useState('');
  const [subStartedAt, setSubStartedAt] = useState<string | null>(null);
  const [subExpiresAt, setSubExpiresAt] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'annual'>('annual');
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);

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
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Email verification for password (Clerk requires_verification flow)
  const [verificationPending, setVerificationPending] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationLoading, setVerificationLoading] = useState(false);

  // Photo upload
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Notification preferences
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [digestSending, setDigestSending] = useState(false);
  const [digestSent, setDigestSent] = useState(false);

  const hasPassword = user?.passwordEnabled ?? false;

  useEffect(() => {
    loadCoachAccess();
    if (user) {
      loadNotificationPrefs(db, user.id).then(p => { if (p) setPrefs(p); }).catch(() => {});
    }
    db.from('households')
      .select('subscription_started_at, subscription_expires_at')
      .eq('id', householdId)
      .single()
      .then(({ data }) => {
        if (data?.subscription_started_at) setSubStartedAt(data.subscription_started_at);
        if (data?.subscription_expires_at) setSubExpiresAt(data.subscription_expires_at);
      })
      .catch(() => {});
  }, [householdId]);

  async function handleCancelSubscription() {
    setCancelling(true);
    try {
      const token = await getToken({ template: 'supabase' });
      const res = await fetch('/api/cancel-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ householdId }),
      });
      if (!res.ok) throw new Error('Erro ao cancelar');
      setCancelConfirm(false);
      window.location.reload();
    } catch {
      setSubError('Não foi possível cancelar. Entre em contato: kashimappbr@gmail.com');
    } finally {
      setCancelling(false);
    }
  }

  async function handleSubscribe() {
    setSubLoading(true);
    setSubError('');
    try {
      const token = await getToken({ template: 'supabase' });
      const res = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan: selectedPlan }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Erro ao criar sessão de pagamento.');
      }
      const { url } = await res.json() as { url: string };
      window.location.href = url;
    } catch (err: unknown) {
      setSubError(err instanceof Error ? err.message : 'Erro ao iniciar assinatura.');
    } finally {
      setSubLoading(false);
    }
  }

  async function loadCoachAccess() {
    const { data } = await db.from('coach_access').select('*').eq('household_id', householdId).eq('status', 'approved');
    setCoachAccess(data ?? []);
  }

  async function handleRevokeCoach() {
    setRevoking(true);
    try {
      await db.from('coach_access').update({ status: 'revoked', revoked_at: new Date().toISOString() }).eq('household_id', householdId).eq('status', 'approved');
      setRevokeConfirm(false);
      await loadCoachAccess();
    } finally {
      setRevoking(false);
    }
  }

  function openPasswordForm() {
    setPasswordView(hasPassword ? 'change' : 'set');
    setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    setPasswordError(''); setPasswordSuccess('');
  }

  function cancelPassword() {
    setPasswordView('idle');
    setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    setPasswordError(''); setPasswordSuccess('');
    setVerificationPending(false); setVerificationCode('');
  }

  async function handleSavePassword() {
    setPasswordError(''); setPasswordSuccess('');
    if (!newPassword || newPassword.length < 8) { setPasswordError('A senha deve ter pelo menos 8 caracteres.'); return; }
    if (newPassword !== confirmPassword) { setPasswordError('As senhas não coincidem.'); return; }
    if (hasPassword && !currentPassword) { setPasswordError('Informe sua senha atual.'); return; }
    setPasswordLoading(true);
    try {
      await user?.updatePassword({ newPassword, ...(hasPassword ? { currentPassword } : {}), signOutOfOtherSessions: false });
      setPasswordSuccess(hasPassword ? 'Senha alterada com sucesso!' : 'Senha cadastrada com sucesso!');
      setPasswordView('idle');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (err: any) {
      const code: string = err?.errors?.[0]?.code ?? err?.code ?? '';
      const msg: string = err?.errors?.[0]?.longMessage ?? err?.errors?.[0]?.message ?? err?.message ?? 'Erro ao salvar senha.';
      const isVerificationRequired =
        code.includes('verification') ||
        code.includes('step_up') ||
        code === 'requires_current_password' ||
        msg.toLowerCase().includes('additional verification') ||
        msg.toLowerCase().includes('verificação adicional') ||
        msg.toLowerCase().includes('provide additional');
      if (isVerificationRequired) {
        try {
          const email = user?.emailAddresses[0]?.emailAddress;
          if (!email || !signIn) throw new Error('unavailable');
          await signIn.create({ identifier: email });
          await signIn.prepareFirstFactor({ strategy: 'email_code', emailAddressId: user!.emailAddresses[0].id });
          setVerificationPending(true);
        } catch {
          setPasswordError('Por segurança, saia da conta e entre novamente com o link de e-mail. Depois tente definir a senha.');
        }
      } else if (msg.toLowerCase().includes('incorrect') || msg.toLowerCase().includes('wrong')) {
        setPasswordError('Senha atual incorreta.');
      } else if (msg.toLowerCase().includes('pwned') || msg.toLowerCase().includes('common')) {
        setPasswordError('Essa senha é muito comum.');
      } else {
        setPasswordError(msg);
      }
    } finally {
      setPasswordLoading(false);
    }
  }

  async function handleVerifyAndSavePassword() {
    setPasswordError('');
    setVerificationLoading(true);
    try {
      if (!signIn) throw new Error('unavailable');
      const result = await signIn.attemptFirstFactor({ strategy: 'email_code', code: verificationCode });
      if (result.status === 'complete' && setActive) {
        await setActive({ session: result.createdSessionId });
      }
      setVerificationPending(false);
      setVerificationCode('');
      await user?.updatePassword({ newPassword, ...(hasPassword ? { currentPassword } : {}), signOutOfOtherSessions: false });
      setPasswordSuccess(hasPassword ? 'Senha alterada com sucesso!' : 'Senha cadastrada com sucesso!');
      setPasswordView('idle');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (err: any) {
      const msg: string = err?.errors?.[0]?.longMessage ?? err?.errors?.[0]?.message ?? err?.message ?? 'Código inválido.';
      if (msg.toLowerCase().includes('incorrect') || msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('inválido')) {
        setPasswordError('Código incorreto. Verifique o e-mail e tente novamente.');
      } else {
        setPasswordError(msg);
      }
    } finally {
      setVerificationLoading(false);
    }
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError(''); setPhotoLoading(true);
    try {
      await user?.setProfileImage({ file });
    } catch (err: any) {
      setPhotoError(err?.errors?.[0]?.longMessage ?? err?.message ?? 'Erro ao atualizar foto.');
    } finally {
      setPhotoLoading(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  }

  async function handleSavePrefs(updated: NotificationPrefs) {
    setPrefs(updated);
    if (!user) return;
    setPrefsLoading(true);
    try {
      await saveNotificationPrefs(db, user.id, updated);
    } finally {
      setPrefsLoading(false);
    }
  }

  async function handleSendDigest() {
    if (!user || !summary) return;
    const email = user.emailAddresses[0]?.emailAddress;
    if (!email) return;
    setDigestSending(true);
    try {
      const monthName = currentMonthIdx !== undefined ? MONTHS_BR[currentMonthIdx] : undefined;
      await fetch('/api/weekly-digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name: user.firstName || email.split('@')[0],
          balance: summary.balance,
          totalIncome: summary.totalIncome,
          totalCost: summary.totalCost,
          accumulated: summary.accumulated,
          monthName,
        }),
      });
      setDigestSent(true);
      setTimeout(() => setDigestSent(false), 4000);
    } finally {
      setDigestSending(false);
    }
  }

  function handleExportPDF() {
    onClose();
    setTimeout(() => window.print(), 350);
  }

  const hasActiveCoach = coachAccess.length > 0;

  const ToggleRow = ({ label, sublabel, value, onChange }: { label: string; sublabel?: string; value: boolean; onChange: (v: boolean) => void }) => (
    <div className="flex items-center justify-between py-3 border-b border-zinc-800 last:border-0">
      <div>
        <p className="text-white text-sm font-bold">{label}</p>
        {sublabel && <p className="text-zinc-500 text-[11px] mt-0.5">{sublabel}</p>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-12 h-6 rounded-full transition-colors ${value ? 'bg-green-500' : 'bg-zinc-700'}`}
      >
        <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-6' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto bg-black/80 backdrop-blur-sm flex items-start justify-center p-4 pt-10">
      <div className="max-w-2xl w-full pb-16">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-black uppercase italic tracking-tighter text-white">
            <i className="fas fa-cog text-green-400 mr-2"></i>Configurações
          </h2>
          <button onClick={onClose} className="w-10 h-10 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 bg-zinc-900 p-1 rounded-xl border border-zinc-800">
          {([['conta','Conta','fa-user'],['notificacoes','Avisos','fa-bell'],['parceiro','Casal','fa-heart'],['assinatura','Plano','fa-crown']] as const).map(([key, label, icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all ${tab === key ? 'bg-green-500 text-black shadow' : 'text-zinc-500 hover:text-white'}`}
            >
              <i className={`fas ${icon}`}></i> {label}
            </button>
          ))}
        </div>

        {/* ── CONTA TAB ── */}
        {tab === 'conta' && (
          <>
            {/* Profile */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 mb-4">
              <h3 className="text-white font-black uppercase italic tracking-tight mb-4 flex items-center gap-2">
                <i className="fas fa-user text-green-400"></i>Conta
              </h3>
              {user && (
                <div className="flex items-center gap-4 mb-4 p-4 bg-zinc-800 rounded-2xl">
                  <div className="relative shrink-0">
                    <img src={user.imageUrl} className="w-16 h-16 rounded-full border-2 border-green-400/30 object-cover" alt="Avatar" />
                    <button onClick={() => photoInputRef.current?.click()} disabled={photoLoading} className="absolute -bottom-1 -right-1 w-6 h-6 bg-green-500 hover:bg-green-400 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-90" title="Alterar foto">
                      {photoLoading ? <i className="fas fa-circle-notch animate-spin text-[9px] text-black"></i> : <i className="fas fa-camera text-[9px] text-black"></i>}
                    </button>
                    <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-white font-bold text-sm truncate">{user.firstName} {user.lastName}</p>
                    <p className="text-zinc-500 text-xs truncate">{user.emailAddresses[0]?.emailAddress}</p>
                    <button onClick={() => photoInputRef.current?.click()} disabled={photoLoading} className="text-green-500 hover:text-green-400 text-[10px] font-bold uppercase tracking-widest mt-1 transition-colors">Alterar foto</button>
                  </div>
                </div>
              )}
              {photoError && (
                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-4">
                  <i className="fas fa-exclamation-circle text-red-400 text-sm"></i>
                  <span className="text-red-400 text-xs">{photoError}</span>
                </div>
              )}

              {/* PDF Export */}
              <button onClick={handleExportPDF} className="w-full mb-3 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-black py-3 rounded-2xl text-sm uppercase tracking-widest flex items-center justify-center gap-2 transition-all">
                <i className="fas fa-file-pdf text-red-400"></i> Exportar relatório (PDF)
              </button>

              <button onClick={() => signOut()} className="w-full bg-red-500/10 border border-red-500/20 active:bg-red-500/20 text-red-400 font-black py-3 rounded-2xl transition-all text-sm uppercase flex items-center justify-center gap-2">
                <i className="fas fa-sign-out-alt"></i> Sair da conta
              </button>
            </div>

            {/* Password */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 mb-4">
              <h3 className="text-white font-black uppercase italic tracking-tight mb-1 flex items-center gap-2">
                <i className="fas fa-lock text-green-400"></i>Senha de acesso
              </h3>
              <p className="text-zinc-500 text-xs mb-5">{hasPassword ? 'Senha cadastrada. Altere quando quiser.' : 'Cadastre uma senha para entrar sem código por e-mail.'}</p>
              {passwordSuccess && passwordView === 'idle' && (
                <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-2xl px-4 py-3 mb-4">
                  <i className="fas fa-check-circle text-green-400 text-sm"></i>
                  <span className="text-green-400 text-sm font-bold">{passwordSuccess}</span>
                </div>
              )}
              {passwordView === 'idle' ? (
                <button onClick={openPasswordForm} className="w-full bg-green-500 hover:bg-green-400 text-black font-black py-3 rounded-2xl transition-all text-sm uppercase tracking-widest">
                  <i className={`fas ${hasPassword ? 'fa-key' : 'fa-plus'} mr-2`}></i>{hasPassword ? 'Alterar senha' : 'Cadastrar senha'}
                </button>
              ) : verificationPending ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 bg-green-400/10 border border-green-400/20 rounded-xl px-4 py-3">
                    <i className="fas fa-envelope text-green-400 text-sm"></i>
                    <span className="text-green-300 text-sm">Código enviado para seu e-mail. Insira-o abaixo para confirmar sua identidade.</span>
                  </div>
                  <input
                    type="text"
                    value={verificationCode}
                    onChange={e => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="Código de verificação"
                    maxLength={6}
                    className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-green-500 text-center tracking-[0.4em] font-mono"
                    onKeyDown={e => { if (e.key === 'Enter') handleVerifyAndSavePassword(); }}
                  />
                  {passwordError && (
                    <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                      <i className="fas fa-exclamation-circle text-red-400 text-sm mt-0.5"></i>
                      <span className="text-red-400 text-sm">{passwordError}</span>
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button onClick={handleVerifyAndSavePassword} disabled={verificationLoading || verificationCode.length < 4} className="flex-1 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-black py-3 rounded-2xl transition-all text-sm uppercase">
                      {verificationLoading ? <i className="fas fa-circle-notch animate-spin"></i> : 'Confirmar'}
                    </button>
                    <button onClick={cancelPassword} className="flex-1 bg-zinc-800 text-white font-black py-3 rounded-2xl text-sm uppercase">Cancelar</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {hasPassword && (
                    <div>
                      <label className="text-zinc-400 text-xs uppercase tracking-widest block mb-1">Senha atual</label>
                      <div className="relative">
                        <input type={showCurrent ? 'text' : 'password'} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="••••••••" className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-green-500 pr-12" />
                        <button type="button" onClick={() => setShowCurrent(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500"><i className={`fas ${showCurrent ? 'fa-eye-slash' : 'fa-eye'} text-sm`}></i></button>
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="text-zinc-400 text-xs uppercase tracking-widest block mb-1">{hasPassword ? 'Nova senha' : 'Criar senha'}</label>
                    <div className="relative">
                      <input type={showNew ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Mínimo 8 caracteres" className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-green-500 pr-12" />
                      <button type="button" onClick={() => setShowNew(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500"><i className={`fas ${showNew ? 'fa-eye-slash' : 'fa-eye'} text-sm`}></i></button>
                    </div>
                  </div>
                  <div>
                    <label className="text-zinc-400 text-xs uppercase tracking-widest block mb-1">Confirmar senha</label>
                    <div className="relative">
                      <input type={showConfirm ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Repita a senha" className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-green-500 pr-12" onKeyDown={e => { if (e.key === 'Enter') handleSavePassword(); }} />
                      <button type="button" onClick={() => setShowConfirm(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500"><i className={`fas ${showConfirm ? 'fa-eye-slash' : 'fa-eye'} text-sm`}></i></button>
                    </div>
                  </div>
                  {passwordError && (
                    <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                      <i className="fas fa-exclamation-circle text-red-400 text-sm mt-0.5"></i>
                      <span className="text-red-400 text-sm">{passwordError}</span>
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button onClick={handleSavePassword} disabled={passwordLoading} className="flex-1 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-black py-3 rounded-2xl transition-all text-sm uppercase">
                      {passwordLoading ? <i className="fas fa-circle-notch animate-spin"></i> : hasPassword ? 'Salvar nova senha' : 'Cadastrar senha'}
                    </button>
                    <button onClick={cancelPassword} className="flex-1 bg-zinc-800 text-white font-black py-3 rounded-2xl text-sm uppercase">Cancelar</button>
                  </div>
                </div>
              )}
            </div>

            {/* Coach access */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
              <h3 className="text-white font-black uppercase italic tracking-tight mb-4 flex items-center gap-2">
                <i className="fas fa-user-shield text-green-400"></i>Acesso do Consultor Financeiro
              </h3>
              {hasActiveCoach ? (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3 bg-green-500/10 border border-green-500/20 rounded-2xl p-4">
                    <div className="w-10 h-10 bg-green-500/20 rounded-full flex items-center justify-center"><i className="fas fa-check text-green-400"></i></div>
                    <div>
                      <p className="text-green-400 font-bold text-sm">Consultor financeiro com acesso ativo</p>
                      <p className="text-zinc-500 text-xs">Seu consultor pode visualizar e editar seu plano</p>
                    </div>
                  </div>
                  {!revokeConfirm ? (
                    <button onClick={() => setRevokeConfirm(true)} className="w-full bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-400 font-black py-3 rounded-2xl text-sm uppercase">
                      <i className="fas fa-user-slash mr-2"></i>Revogar acesso do consultor
                    </button>
                  ) : (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
                      <p className="text-red-400 font-bold text-sm mb-1">Tem certeza?</p>
                      <p className="text-zinc-500 text-xs mb-4">Seu consultor não poderá mais acessar seus dados.</p>
                      <div className="flex gap-2">
                        <button onClick={handleRevokeCoach} disabled={revoking} className="flex-1 bg-red-600 hover:bg-red-500 text-white font-black py-2.5 rounded-xl text-xs uppercase">
                          {revoking ? <i className="fas fa-circle-notch animate-spin"></i> : 'Sim, revogar'}
                        </button>
                        <button onClick={() => setRevokeConfirm(false)} className="flex-1 bg-zinc-700 text-white font-black py-2.5 rounded-xl text-xs uppercase">Cancelar</button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-3 bg-zinc-800/50 border border-zinc-700 rounded-2xl p-4">
                  <div className="w-10 h-10 bg-zinc-700 rounded-full flex items-center justify-center"><i className="fas fa-user-slash text-zinc-500"></i></div>
                  <div>
                    <p className="text-zinc-400 font-bold text-sm">Sem consultor ativo</p>
                    <p className="text-zinc-600 text-xs">Nenhum consultor tem acesso ao seu plano</p>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── NOTIFICAÇÕES TAB ── */}
        {tab === 'notificacoes' && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
            <h3 className="text-white font-black uppercase italic tracking-tight mb-1 flex items-center gap-2">
              <i className="fas fa-bell text-green-400"></i>Notificações
            </h3>
            <p className="text-zinc-500 text-xs mb-6">Escolha como o Kashim se comunica com você.</p>

            <ToggleRow
              label="Resumo semanal por e-mail"
              sublabel="Receba um resumo do seu mês no seu e-mail"
              value={prefs.weeklyEmail}
              onChange={v => handleSavePrefs({ ...prefs, weeklyEmail: v })}
            />

            {prefs.weeklyEmail && (
              <div className="mb-3 mt-2">
                <button
                  onClick={handleSendDigest}
                  disabled={digestSending || !summary}
                  className={`w-full py-3 rounded-2xl text-sm font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${digestSent ? 'bg-green-600 text-white' : 'bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white hover:border-green-500'}`}
                >
                  {digestSending ? <><i className="fas fa-circle-notch animate-spin"></i> Enviando...</>
                  : digestSent ? <><i className="fas fa-check"></i> Enviado!</>
                  : <><i className="fas fa-paper-plane text-green-400"></i> Enviar resumo agora</>}
                </button>
              </div>
            )}

            <ToggleRow
              label="Alertas de teto de gasto"
              sublabel={`Avisar quando uma categoria atingir ${prefs.alertThresholdPct}% do teto`}
              value={prefs.pushEnabled}
              onChange={v => handleSavePrefs({ ...prefs, pushEnabled: v })}
            />

            {prefs.pushEnabled && (
              <div className="mb-4">
                <label className="text-zinc-500 text-[10px] font-black uppercase tracking-widest block mb-2">
                  Alertar em {prefs.alertThresholdPct}% do teto
                </label>
                <input
                  type="range" min="50" max="100" step="5"
                  value={prefs.alertThresholdPct}
                  onChange={e => handleSavePrefs({ ...prefs, alertThresholdPct: Number(e.target.value) })}
                  className="w-full accent-green-400"
                />
                <div className="flex justify-between text-[9px] text-zinc-600 font-mono mt-0.5">
                  <span>50%</span><span className="text-green-400 font-black">{prefs.alertThresholdPct}%</span><span>100%</span>
                </div>
              </div>
            )}

            <ToggleRow
              label="Lembrete de lançamentos recorrentes"
              sublabel={`Lembrar no dia ${prefs.recurringReminderDay} se itens recorrentes não foram lançados`}
              value={!!prefs.recurringReminderDay}
              onChange={v => handleSavePrefs({ ...prefs, recurringReminderDay: v ? 20 : 0 })}
            />

            {prefs.recurringReminderDay > 0 && (
              <div className="mt-2 mb-2">
                <label className="text-zinc-500 text-[10px] font-black uppercase tracking-widest block mb-2">
                  Lembrar no dia {prefs.recurringReminderDay}
                </label>
                <input
                  type="range" min="1" max="28" step="1"
                  value={prefs.recurringReminderDay}
                  onChange={e => handleSavePrefs({ ...prefs, recurringReminderDay: Number(e.target.value) })}
                  className="w-full accent-green-400"
                />
                <div className="flex justify-between text-[9px] text-zinc-600 font-mono mt-0.5">
                  <span>Dia 1</span><span className="text-green-400 font-black">Dia {prefs.recurringReminderDay}</span><span>Dia 28</span>
                </div>
              </div>
            )}

            {prefsLoading && (
              <div className="flex items-center gap-2 mt-4 text-zinc-500 text-xs">
                <i className="fas fa-circle-notch animate-spin"></i> Salvando...
              </div>
            )}
          </div>
        )}

        {/* ── PARCEIRO TAB ── */}
        {tab === 'parceiro' && (
          <div className="flex flex-col gap-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5">
              <h3 className="text-white font-black uppercase italic tracking-tight mb-2 flex items-center gap-2">
                <i className="fas fa-heart text-red-400"></i>Modo Casal
              </h3>
              <p className="text-zinc-500 text-xs mb-4 leading-relaxed">
                Convide seu parceiro(a) para acessar e lançar gastos no mesmo plano. Vocês compartilham os mesmos dados em tempo real.
              </p>
              <InvitePartner
                db={db}
                householdId={householdId}
                currentUserId={user?.id ?? ''}
                inviterName={`${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || 'Seu parceiro(a)'}
                getToken={() => getToken({ template: 'supabase' })}
              />
            </div>
          </div>
        )}

        {/* ── ASSINATURA TAB ── */}
        {tab === 'assinatura' && (
          <div className="flex flex-col gap-4">
            {subscriptionStatus === 'active' ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
                <div className="flex items-center gap-3 bg-green-500/10 border border-green-500/20 rounded-2xl p-4 mb-5">
                  <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                    <i className="fas fa-crown text-green-400 text-lg"></i>
                  </div>
                  <div>
                    <p className="text-green-400 font-black text-sm uppercase tracking-widest">Kashim Premium</p>
                    <p className="text-green-300/70 text-xs">Plano ativo</p>
                  </div>
                </div>
                {subStartedAt && (
                  <div className="flex items-center gap-3 py-3 border-b border-zinc-800">
                    <i className="fas fa-calendar text-zinc-500 text-sm w-4 text-center flex-shrink-0"></i>
                    <div>
                      <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-widest">Ativo desde</p>
                      <p className="text-white text-sm font-bold">
                        {new Date(subStartedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3 py-3 border-b border-zinc-800">
                  <i className="fas fa-credit-card text-zinc-500 text-sm w-4 text-center flex-shrink-0"></i>
                  <div>
                    <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-widest">Plano</p>
                    <p className="text-white text-sm font-bold">
                      {subExpiresAt && subStartedAt && (new Date(subExpiresAt).getTime() - new Date(subStartedAt).getTime()) > 300 * 24 * 60 * 60 * 1000
                        ? 'Anual — R$ 10,99 / mês (R$ 131,88)'
                        : 'Mensal — R$ 14,99 / mês'}
                    </p>
                  </div>
                </div>
                {subExpiresAt && (
                  <div className="flex items-center gap-3 py-3 border-b border-zinc-800">
                    <i className="fas fa-calendar-check text-zinc-500 text-sm w-4 text-center flex-shrink-0"></i>
                    <div>
                      <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-widest">Válido até</p>
                      <p className="text-white text-sm font-bold">
                        {new Date(subExpiresAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
                      </p>
                    </div>
                  </div>
                )}
                {hasActiveCoach && (
                  <div className="flex items-center gap-3 py-3 border-b border-zinc-800">
                    <i className="fas fa-user-tie text-zinc-500 text-sm w-4 text-center flex-shrink-0"></i>
                    <div>
                      <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-widest">Consultor</p>
                      <p className="text-white text-sm font-bold">Consultor financeiro com acesso ativo</p>
                    </div>
                  </div>
                )}

                {subError && (
                  <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mt-4">
                    <i className="fas fa-exclamation-circle text-red-400 text-sm mt-0.5"></i>
                    <span className="text-red-400 text-sm">{subError}</span>
                  </div>
                )}

                <div className="mt-5 pt-4 border-t border-zinc-800">
                  <p className="text-zinc-600 text-[10px] mb-3 leading-relaxed">
                    Dúvidas? Fale com a gente:{' '}
                    <a href="mailto:kashimappbr@gmail.com" className="text-zinc-400 underline">kashimappbr@gmail.com</a>
                  </p>
                  {!cancelConfirm ? (
                    <button
                      onClick={() => setCancelConfirm(true)}
                      className="w-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-500 hover:text-red-400 font-bold py-2.5 rounded-xl text-[10px] uppercase tracking-widest transition-all"
                    >
                      Cancelar assinatura
                    </button>
                  ) : (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
                      <p className="text-red-400 font-bold text-sm mb-1">Cancelar assinatura?</p>
                      <p className="text-zinc-500 text-xs mb-4 leading-relaxed">
                        Você perderá acesso ao Kashim Premium ao fim do período pago.
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={handleCancelSubscription}
                          disabled={cancelling}
                          className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-black py-2.5 rounded-xl text-xs uppercase transition-all"
                        >
                          {cancelling ? <i className="fas fa-circle-notch animate-spin"></i> : 'Sim, cancelar'}
                        </button>
                        <button
                          onClick={() => setCancelConfirm(false)}
                          className="flex-1 bg-zinc-700 text-white font-black py-2.5 rounded-xl text-xs uppercase"
                        >
                          Manter plano
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : subscriptionStatus === 'past_due' ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
                <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-2xl p-4 mb-5">
                  <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                    <i className="fas fa-exclamation-triangle text-red-400 text-lg"></i>
                  </div>
                  <div>
                    <p className="text-red-400 font-black text-sm">Pagamento com problema</p>
                    <p className="text-zinc-500 text-xs">Renove para continuar usando o Kashim</p>
                  </div>
                </div>
                {subError && (
                  <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-4">
                    <i className="fas fa-exclamation-circle text-red-400 text-sm mt-0.5"></i>
                    <span className="text-red-400 text-sm">{subError}</span>
                  </div>
                )}
                <button
                  onClick={handleSubscribe}
                  disabled={subLoading}
                  className="w-full bg-green-500 hover:bg-green-400 active:scale-[0.98] disabled:opacity-50 text-black font-black py-4 rounded-2xl transition-all text-sm uppercase tracking-widest flex items-center justify-center gap-2"
                >
                  {subLoading
                    ? <i className="fas fa-circle-notch animate-spin"></i>
                    : <><i className="fas fa-redo"></i> Renovar assinatura</>}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {/* Plan selector */}
                <button
                  onClick={() => setSelectedPlan('annual')}
                  className={`relative w-full rounded-3xl p-5 border-2 text-left transition-all ${selectedPlan === 'annual' ? 'border-green-500 bg-green-500/10' : 'border-zinc-700 bg-zinc-900'}`}
                >
                  {selectedPlan === 'annual' && (
                    <div className="absolute top-3 right-3 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                      <i className="fas fa-check text-black text-[9px]"></i>
                    </div>
                  )}
                  <div className="flex items-center gap-2 mb-1">
                    <span className="bg-green-500 text-black text-[9px] font-black uppercase px-2 py-0.5 rounded-full">Mais popular</span>
                  </div>
                  <p className="text-white font-black text-sm uppercase tracking-wide">Plano Anual</p>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <span className="text-green-400 font-black text-2xl">R$ 10,99</span>
                    <span className="text-zinc-500 text-xs">/mês</span>
                    <span className="text-zinc-600 text-xs ml-1">— R$ 131,88 à vista</span>
                  </div>
                  <p className="text-zinc-500 text-[10px] mt-1">Economia de R$ 48 vs. mensal</p>
                </button>

                <button
                  onClick={() => setSelectedPlan('monthly')}
                  className={`relative w-full rounded-3xl p-5 border-2 text-left transition-all ${selectedPlan === 'monthly' ? 'border-green-500 bg-green-500/10' : 'border-zinc-700 bg-zinc-900'}`}
                >
                  {selectedPlan === 'monthly' && (
                    <div className="absolute top-3 right-3 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                      <i className="fas fa-check text-black text-[9px]"></i>
                    </div>
                  )}
                  <p className="text-white font-black text-sm uppercase tracking-wide">Plano Mensal</p>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <span className="text-white font-black text-2xl">R$ 14,99</span>
                    <span className="text-zinc-500 text-xs">/mês</span>
                  </div>
                  <p className="text-zinc-500 text-[10px] mt-1">Cancele quando quiser</p>
                </button>

                {/* Benefits */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-3xl px-5 py-4 flex flex-col gap-2.5">
                  {([
                    ['fa-robot', 'AICoach por voz'],
                    ['fa-chart-line', 'Dashboard completo com tetos'],
                    ['fa-heart', 'Modo Casal'],
                    ['fa-envelope', 'Resumo semanal por e-mail'],
                    ['fa-file-pdf', 'Exportação em PDF'],
                  ] as const).map(([icon, title]) => (
                    <div key={title} className="flex items-center gap-2.5">
                      <i className={`fas ${icon} text-green-400 text-xs w-4 text-center`}></i>
                      <p className="text-zinc-300 text-sm">{title}</p>
                    </div>
                  ))}
                </div>

                {subError && (
                  <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-2xl px-4 py-3">
                    <i className="fas fa-exclamation-circle text-red-400 text-sm mt-0.5"></i>
                    <span className="text-red-400 text-sm">{subError}</span>
                  </div>
                )}
                <button
                  onClick={handleSubscribe}
                  disabled={subLoading}
                  className="w-full bg-green-500 hover:bg-green-400 active:scale-[0.98] disabled:opacity-50 text-black font-black py-4 rounded-3xl transition-all text-sm uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-green-500/20"
                >
                  {subLoading
                    ? <i className="fas fa-circle-notch animate-spin"></i>
                    : <><i className="fas fa-crown"></i> Assinar {selectedPlan === 'annual' ? '— R$ 131,88' : '— R$ 14,99/mês'}</>}
                </button>
                <p className="text-zinc-600 text-[10px] text-center">Cancele quando quiser • Sem fidelidade</p>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
};

export default ClientSettings;
