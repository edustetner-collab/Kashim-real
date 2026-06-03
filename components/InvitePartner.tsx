
import React, { useState, useEffect } from 'react';
import { SupabaseClient } from '@supabase/supabase-js';

interface InvitePartnerProps {
  db: SupabaseClient;
  householdId: string;
  currentUserId: string;
  inviterName?: string;
  getToken?: () => Promise<string | null>;
}

interface Member {
  clerk_user_id: string;
  role: string;
  joined_at: string;
}

interface Invite {
  id: string;
  email: string;
  status: string;
  created_at: string;
}

const InvitePartner: React.FC<InvitePartnerProps> = ({ db, householdId, currentUserId, inviterName, getToken }) => {
  const [email, setEmail] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadMembers();
    loadInvites();
  }, [householdId]);

  async function loadMembers() {
    const { data } = await db
      .from('household_members')
      .select('*')
      .eq('household_id', householdId);
    setMembers(data ?? []);
  }

  async function loadInvites() {
    const { data } = await db
      .from('household_invites')
      .select('*')
      .eq('household_id', householdId)
      .eq('status', 'pending');
    setInvites(data ?? []);
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    if (members.length >= 2) {
      setMessage({ type: 'error', text: 'Limite de 2 membros por conta atingido.' });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      // Gera token único para o convite
      const token = Math.random().toString(36).substr(2, 16) + Date.now().toString(36);

      const { error } = await db.from('household_invites').insert({
        household_id: householdId,
        invited_by: currentUserId,
        email: email.trim().toLowerCase(),
        token,
        status: 'pending',
      });

      if (error) throw error;

      const inviteLink = `${window.location.origin}?invite=${token}`;

      // Envia email automaticamente via API server-side
      const token2 = getToken ? await getToken() : null;
      const emailRes = await fetch('/api/invite-partner', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token2 ? { Authorization: `Bearer ${token2}` } : {}),
        },
        body: JSON.stringify({ email: email.trim(), token, householdId, inviterName }),
      });

      if (!emailRes.ok) {
        // Fallback: abre mailto se o email automático falhar
        const subject = encodeURIComponent('Convite para o Kashim — Finanças do Casal');
        const body = encodeURIComponent(`Olá!\n\nVocê foi convidado(a) para o Kashim.\n\nAceite aqui: ${inviteLink}\n\n— Kashim`);
        window.open(`mailto:${email.trim()}?subject=${subject}&body=${body}`);
      }

      setPendingLink(inviteLink);
      setMessage({ type: 'success', text: `Convite enviado para ${email.trim()} por e-mail!` });
      setEmail('');
      loadInvites();
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Erro ao criar convite. Tente novamente.' });
    } finally {
      setLoading(false);
    }
  }

  async function cancelInvite(id: string) {
    await db.from('household_invites').update({ status: 'cancelled' }).eq('id', id);
    loadInvites();
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 mb-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-green-400/10 rounded-full flex items-center justify-center">
          <i className="fas fa-user-friends text-green-400"></i>
        </div>
        <div>
          <h3 className="text-white font-black text-lg uppercase italic tracking-tighter">Acesso do Casal</h3>
          <p className="text-zinc-500 text-[10px] uppercase tracking-widest">Até 2 pessoas na mesma conta</p>
        </div>
      </div>

      {/* Membros atuais */}
      <div className="mb-6">
        <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mb-3">Membros ativos</p>
        <div className="flex flex-col gap-2">
          {members.map((m, i) => (
            <div key={m.clerk_user_id} className="flex items-center gap-3 bg-zinc-800/50 rounded-2xl px-4 py-3">
              <div className="w-8 h-8 bg-green-500/20 rounded-full flex items-center justify-center">
                <i className="fas fa-user text-green-400 text-xs"></i>
              </div>
              <div>
                <p className="text-white text-sm font-bold">
                  {m.clerk_user_id === currentUserId ? 'Você' : 'Parceiro(a)'}
                </p>
                <p className="text-zinc-500 text-[10px] uppercase">{m.role}</p>
              </div>
              {m.clerk_user_id === currentUserId && (
                <span className="ml-auto text-[9px] bg-green-500/20 text-green-400 px-2 py-1 rounded-full font-black uppercase">Você</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Convites pendentes */}
      {invites.length > 0 && (
        <div className="mb-6">
          <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mb-3">Convites pendentes</p>
          {invites.map(inv => (
            <div key={inv.id} className="flex items-center justify-between bg-green-400/5 border border-green-400/20 rounded-2xl px-4 py-3 mb-2">
              <div>
                <p className="text-green-300 text-sm font-bold">{inv.email}</p>
                <p className="text-zinc-500 text-[10px]">Aguardando aceite</p>
              </div>
              <button
                onClick={() => cancelInvite(inv.id)}
                className="text-zinc-600 hover:text-red-500 transition-colors p-2"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Formulário de convite */}
      {members.length < 2 && (
        <form onSubmit={handleInvite} className="flex flex-col gap-3">
          <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest">Convidar parceiro(a)</p>
          <div className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="email@exemplo.com"
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-3 text-white text-sm outline-none focus:border-green-400 transition-all"
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-green-500 hover:bg-green-400 text-black font-black px-6 py-3 rounded-2xl transition-all disabled:opacity-50 text-xs uppercase"
            >
              {loading ? <i className="fas fa-circle-notch animate-spin"></i> : 'Convidar'}
            </button>
          </div>

          {message && (
            <div className={`p-4 rounded-2xl text-sm leading-relaxed ${
              message.type === 'success'
                ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                : 'bg-red-500/10 border border-red-500/20 text-red-400'
            }`}>
              {message.type === 'success' && <i className="fas fa-check-circle mr-2"></i>}
              {message.type === 'error' && <i className="fas fa-exclamation-circle mr-2"></i>}
              {message.text}
            </div>
          )}
          {pendingLink && (
            <div className="flex flex-col gap-2">
              <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest">Link do convite (caso o e-mail não abra)</p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={pendingLink}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-2xl px-3 py-2 text-zinc-400 text-xs outline-none truncate"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(pendingLink).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    });
                  }}
                  className="bg-zinc-700 hover:bg-zinc-600 text-white font-black px-4 py-2 rounded-2xl text-xs uppercase transition-all shrink-0"
                >
                  {copied ? <i className="fas fa-check text-green-400"></i> : <i className="fas fa-copy"></i>}
                </button>
              </div>
            </div>
          )}
        </form>
      )}

      {members.length >= 2 && (
        <div className="bg-zinc-800/50 rounded-2xl px-4 py-3 text-center">
          <p className="text-zinc-500 text-xs">Limite de 2 membros atingido</p>
        </div>
      )}
    </div>
  );
};

export default InvitePartner;
