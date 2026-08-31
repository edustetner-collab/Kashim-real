import React, { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';

/**
 * Chamados de suporte — visão do Eduardo.
 *
 * Lista, responde e fecha. Responder envia e-mail ao cliente e muda o status
 * sozinho, para não existir chamado respondido que continua marcado como
 * aberto no sino.
 */

interface Ticket {
  id: string;
  nome: string | null;
  email: string | null;
  mensagem: string;
  printUrl: string | null;
  contexto: Record<string, unknown> | null;
  status: 'aberto' | 'respondido' | 'resolvido';
  resposta: string | null;
  created_at: string;
}

const STATUS = {
  aberto:     { label: 'Aberto',     cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
  respondido: { label: 'Respondido', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  resolvido:  { label: 'Resolvido',  cls: 'bg-green-500/15 text-green-400 border-green-500/30' },
} as const;

const quando = (iso: string) => {
  const d = new Date(iso);
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 60) return `há ${Math.max(1, min)} min`;
  if (min < 1440) return `há ${Math.floor(min / 60)}h`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
};

const SuporteAdmin: React.FC<{ onClose: () => void; onMudou?: () => void }> = ({ onClose, onMudou }) => {
  const { getToken } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<'todos' | 'aberto'>('aberto');

  const carregar = async () => {
    try {
      const token = await getToken({ template: 'supabase' });
      const res = await fetch('/api/support-admin', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Não consegui carregar os chamados.');
      const body = await res.json();
      setTickets(body.tickets ?? []);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  const atualizar = async (id: string, patch: { status?: string; resposta?: string }) => {
    setSalvando(id);
    try {
      const token = await getToken({ template: 'supabase' });
      const res = await fetch('/api/support-admin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, ...patch }),
      });
      if (!res.ok) throw new Error('Não consegui salvar.');
      setRascunho(r => ({ ...r, [id]: '' }));
      await carregar();
      onMudou?.();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setSalvando(null);
    }
  };

  const lista = filtro === 'aberto' ? tickets.filter(t => t.status === 'aberto') : tickets;
  const nAbertos = tickets.filter(t => t.status === 'aberto').length;

  return (
    <div className="fixed inset-0 z-[330] bg-black/80 backdrop-blur-sm flex items-start justify-center p-0 sm:p-6 overflow-y-auto">
      <div className="w-full sm:max-w-3xl bg-zinc-950 border border-zinc-800 sm:rounded-3xl min-h-full sm:min-h-0 sm:my-4">

        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 bg-zinc-950/95 backdrop-blur border-b border-zinc-800">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-green-500/10 border border-green-500/25 flex items-center justify-center shrink-0">
              <i className="fas fa-life-ring text-green-400 text-sm" />
            </span>
            <div className="min-w-0">
              <h2 className="text-white font-black uppercase italic text-lg leading-none">Chamados</h2>
              <p className="text-zinc-500 text-[11px] mt-0.5">
                {nAbertos > 0 ? `${nAbertos} em aberto` : 'nenhum em aberto'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex bg-zinc-900 rounded-full p-1 border border-zinc-800">
              {(['aberto', 'todos'] as const).map(f => (
                <button key={f} onClick={() => setFiltro(f)}
                  className={`text-[11px] font-black uppercase px-3 py-1 rounded-full transition-colors ${filtro === f ? 'bg-green-600 text-white' : 'text-zinc-500'}`}>
                  {f === 'aberto' ? 'Abertos' : 'Todos'}
                </button>
              ))}
            </div>
            <button onClick={onClose} aria-label="Fechar"
              className="w-9 h-9 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 flex items-center justify-center">
              <i className="fas fa-times" />
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          {carregando && <p className="text-zinc-500 text-sm text-center py-10"><i className="fas fa-circle-notch animate-spin mr-2" />Carregando…</p>}
          {erro && <p className="text-red-400 text-sm text-center py-4">{erro}</p>}
          {!carregando && lista.length === 0 && (
            <div className="text-center py-14">
              <i className="fas fa-inbox text-zinc-700 text-3xl mb-3" />
              <p className="text-zinc-500 text-sm">{filtro === 'aberto' ? 'Nenhum chamado em aberto.' : 'Nenhum chamado ainda.'}</p>
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            {lista.map(t => {
              const expandido = aberto === t.id;
              const st = STATUS[t.status] ?? STATUS.aberto;
              return (
                <div key={t.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
                  <button onClick={() => setAberto(expandido ? null : t.id)} className="w-full text-left px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-white font-bold text-[13.5px]">{t.nome || 'Cliente'}</span>
                          <span className={`text-[9px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                          <span className="text-zinc-600 text-[11px]">{quando(t.created_at)}</span>
                          {t.printUrl && <i className="fas fa-paperclip text-zinc-600 text-[10px]" />}
                        </div>
                        <p className={`text-zinc-400 text-[12.5px] leading-snug ${expandido ? '' : 'line-clamp-2'}`}>{t.mensagem}</p>
                      </div>
                      <i className={`fas fa-chevron-${expandido ? 'up' : 'down'} text-zinc-600 text-xs mt-1 shrink-0`} />
                    </div>
                  </button>

                  {expandido && (
                    <div className="px-4 pb-4 border-t border-zinc-800 pt-3.5">
                      {t.email && (
                        <p className="text-[11.5px] text-zinc-500 mb-3">
                          <i className="fas fa-envelope mr-1.5" />
                          <a href={`mailto:${t.email}`} className="text-sky-400 hover:underline">{t.email}</a>
                        </p>
                      )}

                      {t.printUrl && (
                        <a href={t.printUrl} target="_blank" rel="noopener noreferrer" className="block mb-3">
                          <img src={t.printUrl} alt="Print enviado pelo cliente"
                            className="max-h-64 w-auto rounded-xl border border-zinc-800 hover:border-zinc-600 transition-colors" />
                          <span className="text-[10px] text-zinc-600 mt-1 block">clique para abrir em tamanho real</span>
                        </a>
                      )}

                      {t.contexto && Object.keys(t.contexto).length > 0 && (
                        <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-3 mb-3">
                          <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-1.5">Onde aconteceu</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                            {Object.entries(t.contexto).map(([k, v]) => (
                              <p key={k} className="text-[10.5px] text-zinc-500 font-mono truncate" title={String(v)}>
                                <span className="text-zinc-700">{k}:</span> {String(v)}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}

                      {t.resposta && (
                        <div className="rounded-xl bg-green-500/5 border border-green-500/20 p-3 mb-3">
                          <p className="text-[9px] font-black uppercase tracking-widest text-green-500 mb-1">Sua resposta</p>
                          <p className="text-[12.5px] text-zinc-300 leading-snug whitespace-pre-wrap">{t.resposta}</p>
                        </div>
                      )}

                      <textarea
                        value={rascunho[t.id] ?? ''}
                        onChange={e => setRascunho(r => ({ ...r, [t.id]: e.target.value }))}
                        rows={3}
                        placeholder={t.resposta ? 'Escrever outra resposta…' : 'Responder ao cliente…'}
                        className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-[13px] text-zinc-200 outline-none focus:border-green-600 resize-none"
                      />
                      <p className="text-[10.5px] text-zinc-600 mt-1.5 mb-3">
                        <i className="fas fa-circle-info mr-1" />O cliente recebe a resposta por e-mail e o chamado passa a "respondido".
                      </p>

                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          disabled={salvando === t.id || !(rascunho[t.id] ?? '').trim()}
                          onClick={() => atualizar(t.id, { resposta: rascunho[t.id] })}
                          className="rounded-xl px-4 py-2 text-[12px] font-black uppercase tracking-wide text-white disabled:opacity-40"
                          style={{ background: 'linear-gradient(180deg,#7ab800,#5c8a06)' }}
                        >
                          {salvando === t.id ? <i className="fas fa-circle-notch animate-spin" /> : 'Responder'}
                        </button>
                        {t.status !== 'resolvido' && (
                          <button disabled={salvando === t.id} onClick={() => atualizar(t.id, { status: 'resolvido' })}
                            className="rounded-xl px-4 py-2 text-[12px] font-bold text-zinc-400 border border-zinc-700 hover:text-white transition-colors">
                            Marcar resolvido
                          </button>
                        )}
                        {t.status === 'resolvido' && (
                          <button disabled={salvando === t.id} onClick={() => atualizar(t.id, { status: 'aberto' })}
                            className="rounded-xl px-4 py-2 text-[12px] font-bold text-zinc-500 border border-zinc-800 hover:text-zinc-300 transition-colors">
                            Reabrir
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SuporteAdmin;
