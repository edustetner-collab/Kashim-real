import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/clerk-react';

interface Pergunta { texto: string; quando: string; household: string }
interface Tema { tema: string; quantidade: number; exemplos: string[]; resumo: string }

const CoachInsights: React.FC = () => {
  const { getToken } = useAuth();
  const [perguntas, setPerguntas] = useState<Pergunta[]>([]);
  const [conversas, setConversas] = useState(0);
  const [temas, setTemas] = useState<Tema[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [gerando, setGerando] = useState(false);
  const [error, setError] = useState('');
  const [busca, setBusca] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const token = await getToken({ template: 'supabase' });
      const res = await fetch('/api/coach-insights', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Erro ao carregar');
      }
      const data = await res.json() as { perguntas: Pergunta[]; conversas: number };
      setPerguntas(data.perguntas ?? []);
      setConversas(data.conversas ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro inesperado');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => { load(); }, [load]);

  async function gerarRanking() {
    setGerando(true);
    setError('');
    try {
      const token = await getToken({ template: 'supabase' });
      const res = await fetch('/api/coach-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Erro ao gerar ranking');
      }
      const data = await res.json() as { temas: Tema[] };
      setTemas(data.temas ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro inesperado');
    } finally {
      setGerando(false);
    }
  }

  const filtradas = busca.trim()
    ? perguntas.filter(p => p.texto.toLowerCase().includes(busca.toLowerCase()))
    : perguntas;

  const maxQtd = temas?.length ? Math.max(...temas.map(t => t.quantidade)) : 1;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-600">
        <i className="fas fa-circle-notch fa-spin mr-2" /> Carregando perguntas...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black uppercase italic tracking-tighter text-white">Perguntas do Stets</h1>
          <p className="text-zinc-500 text-xs mt-0.5">
            {perguntas.length} pergunta{perguntas.length !== 1 ? 's' : ''} em {conversas} conversa{conversas !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={gerarRanking}
          disabled={gerando || perguntas.length === 0}
          className="bg-green-500 active:bg-green-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-black px-4 py-2.5 rounded-xl transition-all shadow-lg flex items-center gap-2 uppercase text-xs"
        >
          {gerando
            ? <><i className="fas fa-circle-notch fa-spin" /> Analisando...</>
            : <><i className="fas fa-wand-magic-sparkles" /> Gerar ranking</>}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>
      )}

      {perguntas.length === 0 && !error && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-5 py-10 text-center">
          <i className="fas fa-comments text-zinc-700 text-3xl mb-3" />
          <p className="text-zinc-500 text-sm">Nenhuma pergunta ainda.</p>
          <p className="text-zinc-600 text-xs mt-1">As perguntas aparecem aqui conforme os clientes usam o Stets.</p>
        </div>
      )}

      {/* Ranking por tema */}
      {temas && temas.length > 0 && (
        <div className="space-y-2.5">
          <h2 className="text-xs font-black uppercase tracking-wide text-zinc-500">Temas mais frequentes</h2>
          {temas.map((t, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
              <div className="flex items-center gap-3 mb-2">
                <span className="shrink-0 w-6 h-6 rounded-lg bg-green-500/15 border border-green-500/30 flex items-center justify-center text-[11px] font-black text-green-400">
                  {i + 1}
                </span>
                <span className="flex-1 font-black text-white text-sm">{t.tema}</span>
                <span className="text-xs font-black text-green-400">{t.quantidade}</span>
              </div>
              <div className="h-1 bg-zinc-800 rounded-full overflow-hidden mb-2.5">
                <div
                  className="h-full bg-green-500 rounded-full transition-all"
                  style={{ width: `${Math.round((t.quantidade / maxQtd) * 100)}%` }}
                />
              </div>
              <p className="text-zinc-400 text-xs leading-relaxed mb-2">{t.resumo}</p>
              {t.exemplos?.length > 0 && (
                <div className="space-y-1 pt-2 border-t border-zinc-800">
                  {t.exemplos.map((ex, j) => (
                    <p key={j} className="text-[11px] text-zinc-600 leading-snug pl-3 border-l border-zinc-700">
                      "{ex}"
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lista bruta */}
      {perguntas.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xs font-black uppercase tracking-wide text-zinc-500">Todas as perguntas</h2>
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar..."
              className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-white placeholder-zinc-600 outline-none focus:border-zinc-700 w-40"
            />
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl divide-y divide-zinc-800 max-h-[28rem] overflow-y-auto">
            {filtradas.map((p, i) => (
              <div key={i} className="px-4 py-2.5">
                <p className="text-zinc-300 text-xs leading-snug">{p.texto}</p>
                <p className="text-zinc-600 text-[10px] mt-1">
                  {new Date(p.quando).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                </p>
              </div>
            ))}
            {filtradas.length === 0 && (
              <p className="px-4 py-6 text-center text-zinc-600 text-xs">Nenhuma pergunta encontrada.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CoachInsights;
