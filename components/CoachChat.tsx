import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useDitado } from '../lib/useDitado';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Message { role: 'user' | 'assistant'; content: string; }
interface FinancialSummary {
  totalIncome: number;
  totalCreditCard: number;
  totalFixed: number;
  totalVariable: number;
  totalLeisure: number;
  totalCost: number;
  balance: number;
  jaNaFatura: number;
}

interface CoachChatProps {
  getToken: () => Promise<string | null>;
  householdId: string | null;
  summary: FinancialSummary | null;
  summaries?: FinancialSummary[];
  monthNames?: string[];
  currentMonthIdx?: number;
  /** Texto que já entra digitado, vindo de um atalho de outra tela. */
  perguntaInicial?: string;
  onPerguntaConsumida?: () => void;
}

type Block =
  | { type: 'para'; text: string }
  | { type: 'accordion'; num: string; title: string; body: string[] }
  | { type: 'bullets'; items: string[] };

// ── SVG network background ────────────────────────────────────────────────────
const NetworkBg: React.FC = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none select-none" aria-hidden>
    <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="stets-net" x="0" y="0" width="320" height="320" patternUnits="userSpaceOnUse">
          <line x1="30"  y1="80"  x2="120" y2="30"  stroke="#7ab800" strokeWidth="0.6"/>
          <line x1="120" y1="30"  x2="230" y2="65"  stroke="#7ab800" strokeWidth="0.6"/>
          <line x1="230" y1="65"  x2="300" y2="35"  stroke="#7ab800" strokeWidth="0.6"/>
          <line x1="30"  y1="80"  x2="65"  y2="175" stroke="#7ab800" strokeWidth="0.6"/>
          <line x1="65"  y1="175" x2="155" y2="150" stroke="#7ab800" strokeWidth="0.6"/>
          <line x1="155" y1="150" x2="250" y2="175" stroke="#7ab800" strokeWidth="0.6"/>
          <line x1="250" y1="175" x2="300" y2="35"  stroke="#7ab800" strokeWidth="0.6"/>
          <line x1="120" y1="30"  x2="155" y2="150" stroke="#7ab800" strokeWidth="0.6"/>
          <line x1="230" y1="65"  x2="250" y2="175" stroke="#7ab800" strokeWidth="0.6"/>
          <line x1="65"  y1="175" x2="90"  y2="270" stroke="#7ab800" strokeWidth="0.6"/>
          <line x1="90"  y1="270" x2="185" y2="250" stroke="#7ab800" strokeWidth="0.6"/>
          <line x1="185" y1="250" x2="270" y2="268" stroke="#7ab800" strokeWidth="0.6"/>
          <line x1="155" y1="150" x2="185" y2="250" stroke="#7ab800" strokeWidth="0.6"/>
          <line x1="250" y1="175" x2="270" y2="268" stroke="#7ab800" strokeWidth="0.6"/>
          <line x1="155" y1="150" x2="90"  y2="270" stroke="#7ab800" strokeWidth="0.35"/>
          {/* Glow dots */}
          <circle cx="30"  cy="80"  r="4" fill="#7ab800" opacity="0.15"/>
          <circle cx="30"  cy="80"  r="2" fill="#c8f53a" opacity="0.9"/>
          <circle cx="120" cy="30"  r="4" fill="#7ab800" opacity="0.15"/>
          <circle cx="120" cy="30"  r="2" fill="#c8f53a" opacity="0.9"/>
          <circle cx="230" cy="65"  r="4" fill="#7ab800" opacity="0.15"/>
          <circle cx="230" cy="65"  r="2" fill="#c8f53a" opacity="0.9"/>
          <circle cx="300" cy="35"  r="3" fill="#7ab800" opacity="0.12"/>
          <circle cx="300" cy="35"  r="1.5" fill="#c8f53a" opacity="0.7"/>
          <circle cx="65"  cy="175" r="4" fill="#7ab800" opacity="0.15"/>
          <circle cx="65"  cy="175" r="2" fill="#c8f53a" opacity="0.9"/>
          <circle cx="155" cy="150" r="8" fill="#7ab800" opacity="0.2"/>
          <circle cx="155" cy="150" r="4" fill="#a8e716" opacity="1"/>
          <circle cx="250" cy="175" r="4" fill="#7ab800" opacity="0.15"/>
          <circle cx="250" cy="175" r="2" fill="#c8f53a" opacity="0.9"/>
          <circle cx="90"  cy="270" r="4" fill="#7ab800" opacity="0.15"/>
          <circle cx="90"  cy="270" r="2" fill="#c8f53a" opacity="0.9"/>
          <circle cx="185" cy="250" r="4" fill="#7ab800" opacity="0.15"/>
          <circle cx="185" cy="250" r="2" fill="#c8f53a" opacity="0.9"/>
          <circle cx="270" cy="268" r="3" fill="#7ab800" opacity="0.12"/>
          <circle cx="270" cy="268" r="1.5" fill="#c8f53a" opacity="0.7"/>
        </pattern>
        {/* Central radial glow */}
        <radialGradient id="center-glow" cx="50%" cy="45%" r="50%">
          <stop offset="0%"   stopColor="#3a7000" stopOpacity="0.35"/>
          <stop offset="100%" stopColor="#0c1008" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#stets-net)" opacity="0.18"/>
      <rect width="100%" height="100%" fill="url(#center-glow)"/>
    </svg>
  </div>
);

// ── Inline bold rendering ─────────────────────────────────────────────────────
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**')
          ? <strong key={i} className="font-bold text-white">{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}

// ── Text → blocks parser ──────────────────────────────────────────────────────
function parseBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const numMatch = line.match(/^(\d+)\.\s+(.*)/);
    if (numMatch) {
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const next = lines[i];
        if (!next.trim()) {
          const hasMore = i + 1 < lines.length &&
            (lines[i + 1].match(/^[-•*]\s+/) || lines[i + 1].match(/^\s{2,}/));
          if (!hasMore) break;
          i++; continue;
        }
        if (next.match(/^\d+\.\s+/)) break;
        body.push(next);
        i++;
      }
      blocks.push({ type: 'accordion', num: numMatch[1], title: numMatch[2], body });
      continue;
    }

    if (line.match(/^[-•*]\s+/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[-•*]\s+/)) {
        items.push(lines[i].replace(/^[-•*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'bullets', items });
      continue;
    }

    let para = line;
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].match(/^\d+\.\s+/) &&
      !lines[i].match(/^[-•*]\s+/)
    ) {
      para += '\n' + lines[i];
      i++;
    }
    blocks.push({ type: 'para', text: para });
  }

  return blocks;
}

// ── Accordion item ────────────────────────────────────────────────────────────
const AccordionItem: React.FC<{ num: string; title: string; body: string[] }> = ({ num, title, body }) => {
  const [open, setOpen] = useState(false);
  const hasContent = body.some(l => l.trim());

  return (
    <div className="border border-white/10 rounded-xl overflow-hidden mb-2 bg-white/3">
      <button
        onClick={() => hasContent && setOpen(o => !o)}
        className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors ${hasContent ? 'hover:bg-white/5 cursor-pointer' : 'cursor-default'}`}
      >
        <span className="shrink-0 w-5 h-5 rounded-full bg-[#7ab800]/20 border border-[#7ab800]/40 flex items-center justify-center text-[10px] font-black text-[#7ab800] mt-0.5">
          {num}
        </span>
        <span className="flex-1 text-sm text-zinc-200 leading-snug">{renderInline(title)}</span>
        {hasContent && (
          <i className={`fas ${open ? 'fa-chevron-down text-[#7ab800]' : 'fa-chevron-right text-zinc-600'} text-[10px] mt-1.5 shrink-0 transition-all`} />
        )}
      </button>
      {open && hasContent && (
        <div className="px-3 pb-3 pt-1.5 border-t border-white/8 space-y-1.5">
          {body.filter(l => l.trim()).map((line, j) => {
            const isBullet = /^[-•*]\s+/.test(line);
            const txt = isBullet ? line.replace(/^[-•*]\s+/, '') : line;
            return (
              <div key={j} className="flex gap-2 items-start">
                {isBullet && <span className="mt-2 w-1 h-1 rounded-full bg-[#7ab800]/60 shrink-0" />}
                <span className="text-xs text-zinc-400 leading-relaxed">{renderInline(txt)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Message content renderer ──────────────────────────────────────────────────
const MessageContent: React.FC<{ text: string }> = ({ text }) => (
  <div className="space-y-2">
    {parseBlocks(text).map((b, i) => {
      if (b.type === 'para') return (
        <p key={i} className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">
          {renderInline(b.text)}
        </p>
      );
      if (b.type === 'bullets') return (
        <ul key={i} className="space-y-1.5 mt-1">
          {b.items.map((item, j) => (
            <li key={j} className="flex gap-2 items-start">
              <span className="mt-2 w-1 h-1 rounded-full bg-[#7ab800]/60 shrink-0" />
              <span className="text-xs text-zinc-400 leading-relaxed">{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      if (b.type === 'accordion') return (
        <AccordionItem key={i} num={b.num} title={b.title} body={b.body} />
      );
      return null;
    })}
  </div>
);

// ── Status chips ──────────────────────────────────────────────────────────────
const PHASES = [
  { icon: 'fa-chart-pie',      color: '#a855f7', label: 'Analisando: Fontes de Renda' },
  { icon: 'fa-chart-line',     color: '#7ab800', label: 'Identificando: Despesas Fixas' },
  { icon: 'fa-scale-balanced', color: '#3b82f6', label: 'Avaliando: Distribuição' },
  { icon: 'fa-bolt',           color: '#f59e0b', label: 'Processando: Diagnóstico' },
];

const StatusChips: React.FC = () => {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIdx(p => (p + 1) % PHASES.length), 1800);
    return () => clearInterval(id);
  }, []);

  const curr = PHASES[idx];
  const next = PHASES[(idx + 1) % PHASES.length];

  return (
    <div className="flex gap-2 flex-wrap">
      <span
        key={idx}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold animate-in fade-in duration-300"
        style={{ border: `1px solid ${curr.color}40`, background: `${curr.color}18`, color: curr.color }}
      >
        <i className={`fas ${curr.icon} text-[9px]`} />
        {curr.label}
      </span>
      <span
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold opacity-40"
        style={{ border: `1px solid ${next.color}30`, background: `${next.color}10`, color: next.color }}
      >
        <i className={`fas ${next.icon} text-[9px]`} />
        {next.label}
      </span>
    </div>
  );
};

// ── Suggestions ───────────────────────────────────────────────────────────────
const SUGGESTIONS = [
  'Como lidar com dívida no cartão de crédito?',
  'O que faço quando não sobra nada no fim do mês?',
  'Como começar a investir com pouco?',
];

// ── Main ──────────────────────────────────────────────────────────────────────
export default function CoachChat({ getToken, householdId, summary, summaries, monthNames, currentMonthIdx, perguntaInicial, onPerguntaConsumida }: CoachChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const { gravando, ouvir } = useDitado((msg) => window.alert(msg));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  /**
   * Conversas guardadas.
   *
   * Antes existia uma so: "nova conversa" apagava a anterior sem avisar
   * (Eduardo, 2026-09-20). Agora cada uma tem id proprio, o servidor guarda as
   * 20 ultimas e esta lista e o caminho de volta para elas.
   */
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [conversas, setConversas] = useState<Array<{ id: string; titulo: string; atualizadaEm: string; trocas: number }>>([]);
  const [listaAberta, setListaAberta] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  /**
   * Pergunta que veio de um atalho: entra digitada, não enviada.
   *
   * Enviar sozinho tiraria da pessoa a chance de completar com o caso dela —
   * "isso é fixa ou variável?" vira uma pergunta muito melhor quando ela
   * emenda "comprei uma roupa". O atalho tira o trabalho de começar, não a
   * decisão do que perguntar.
   */
  useEffect(() => {
    if (!perguntaInicial) return;
    setInput(perguntaInicial);
    onPerguntaConsumida?.();
    setTimeout(() => inputRef.current?.focus(), 150);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perguntaInicial]);

  /**
   * O campo cresce com o texto.
   *
   * Com uma linha fixa, uma pergunta longa aparecia cortada no meio — a pessoa
   * lia "pessoal e lazer?" e não tinha como saber que havia mais escrito ali
   * (Eduardo, 2026-09-16). Cresce até o teto do CSS e daí rola.
   */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // Carregar histórico do Supabase ao montar
  useEffect(() => {
    if (!householdId) { setHistoryLoaded(true); return; }
    (async () => {
      try {
        const token = await getToken();
        if (!token) { setHistoryLoaded(true); return; }
        const res = await fetch(`/api/coach-history?householdId=${encodeURIComponent(householdId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json() as {
            messages: Message[];
            conversaId?: string | null;
            conversas?: Array<{ id: string; titulo: string; atualizadaEm: string; trocas: number }>;
          };
          if (Array.isArray(data.messages) && data.messages.length > 0) {
            setMessages(data.messages);
          }
          setConversaId(data.conversaId ?? null);
          setConversas(data.conversas ?? []);
        }
      } catch { /* silently ignore */ }
      setHistoryLoaded(true);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId]);

  // Salvar histórico no Supabase (debounce 2s após última mensagem)
  useEffect(() => {
    if (!historyLoaded || !householdId || messages.length === 0) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const r = await fetch('/api/coach-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ householdId, messages, conversaId }),
        });
        // Conversa nova nasce no servidor; sem guardar o id, cada gravacao
        // seguinte criaria outra.
        if (r.ok) {
          const { conversaId: id } = await r.json() as { conversaId?: string };
          if (id && id !== conversaId) setConversaId(id);
        }
      } catch { /* silently ignore */ }
    }, 2000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, historyLoaded]);

  /** Comeca do zero — a conversa atual ja esta salva e fica na lista. */
  const novaConversa = () => {
    setMessages([]);
    setConversaId(null);
    setListaAberta(false);
  };

  const abrirConversa = async (id: string) => {
    try {
      const token = await getToken();
      if (!token || !householdId) return;
      const res = await fetch(
        `/api/coach-history?householdId=${encodeURIComponent(householdId)}&conversaId=${encodeURIComponent(id)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return;
      const data = await res.json() as { messages: Message[]; conversaId: string };
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setConversaId(data.conversaId);
      setListaAberta(false);
    } catch { /* silently ignore */ }
  };

  const recarregarLista = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token || !householdId) return;
      const res = await fetch(`/api/coach-history?householdId=${encodeURIComponent(householdId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json() as { conversas?: Array<{ id: string; titulo: string; atualizadaEm: string; trocas: number }> };
      setConversas(data.conversas ?? []);
    } catch { /* silently ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId]);

  const DAILY_LIMIT = 15;
  const userCount = messages.filter(m => m.role === 'user').length;
  const pct = Math.round((userCount / DAILY_LIMIT) * 100);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    const count = messages.filter(m => m.role === 'user').length;
    if (count >= DAILY_LIMIT) return;

    const token = await getToken();
    if (!token) {
      setError('Sessão expirada. Clique na aba Stets novamente para renovar.');
      return;
    }

    const newMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/coach-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: newMessages, householdId, summary, summaries, monthNames, currentMonthIdx }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Erro ao chamar o Stets');
      }

      const data = (await res.json()) as { text: string };
      setMessages(prev => [...prev, { role: 'assistant', content: data.text }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro inesperado');
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [input, loading, messages, getToken]);

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div className="relative flex flex-col h-full bg-[#0c1008] overflow-hidden">
      <NetworkBg />

      {/* Header */}
      <div className="relative flex items-center gap-3 px-4 pt-4 pb-3 border-b border-white/8 shrink-0">
        <div className="w-10 h-10 rounded-2xl bg-[#7ab800] flex items-center justify-center shrink-0 shadow-lg shadow-[#7ab800]/30">
          <i className="fas fa-bolt text-[#182200] text-base" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-black text-white tracking-tight">Stets</span>
            <span className="text-[9px] font-black text-[#7ab800] bg-[#7ab800]/15 px-2 py-0.5 rounded-full uppercase tracking-widest border border-[#7ab800]/30">Beta</span>
          </div>
          <p className="text-[11px] text-zinc-500">Consultor financeiro • Método Eduardo Stetner</p>
        </div>
        {/* Dois caminhos visiveis: comecar outra e voltar as antigas. O botao
            de antes era cinza-escuro no canto e quase ninguem achava. */}
        <div className="shrink-0 flex items-center gap-1.5">
          <button
            onClick={() => { setListaAberta(true); void recarregarLista(); }}
            className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-300 bg-white/10 hover:bg-white/15 border border-white/10 transition-colors px-2.5 py-1.5 rounded-xl"
            title="Conversas anteriores"
          >
            <i className="fas fa-clock-rotate-left text-[10px]" />
            <span className="hidden sm:inline">Conversas</span>
          </button>
          <button
            onClick={novaConversa}
            className="flex items-center gap-1.5 text-[11px] font-black text-[#182200] bg-[#a8e716] hover:brightness-105 transition-all px-2.5 py-1.5 rounded-xl shadow-sm"
            title="Nova conversa"
          >
            <i className="fas fa-plus text-[10px]" />
            <span>Nova</span>
          </button>
        </div>
      </div>

      {listaAberta && (
        <div className="absolute inset-0 z-30 flex items-end justify-center" onClick={() => setListaAberta(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            onClick={e => e.stopPropagation()}
            className="relative w-full max-w-lg bg-[#141414] border-t border-zinc-800 rounded-t-3xl p-5 pb-8 max-h-[75%] flex flex-col"
          >
            <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mb-4" />
            <div className="flex items-center justify-between mb-3">
              <p className="text-white font-black text-base">Suas conversas</p>
              <button onClick={novaConversa} className="text-[11px] font-black text-[#a8e716] px-2 py-1">
                + Nova
              </button>
            </div>
            <div className="flex-1 overflow-y-auto flex flex-col gap-1.5">
              {conversas.map(c => {
                const d = new Date(c.atualizadaEm);
                const quando = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
                return (
                  <button
                    key={c.id}
                    onClick={() => abrirConversa(c.id)}
                    className={`text-left px-3.5 py-3 rounded-2xl border transition-colors ${
                      c.id === conversaId
                        ? 'bg-[#7ab800]/15 border-[#7ab800]/40'
                        : 'bg-white/5 border-white/5 hover:bg-white/10'
                    }`}
                  >
                    <p className="text-zinc-100 text-[13.5px] font-bold leading-snug line-clamp-2">{c.titulo}</p>
                    <p className="text-zinc-500 text-[11px] mt-0.5">
                      {quando} · {c.trocas} pergunta{c.trocas === 1 ? '' : 's'}
                      {c.id === conversaId ? ' · aberta agora' : ''}
                    </p>
                  </button>
                );
              })}
              {conversas.length === 0 && (
                <p className="text-zinc-500 text-sm text-center py-8">
                  Nenhuma conversa guardada ainda.
                </p>
              )}
            </div>
            <p className="text-zinc-600 text-[11px] mt-3 text-center">
              As 20 conversas mais recentes ficam guardadas.
            </p>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="relative flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-5 text-center py-4">
            {/* Ícone central com glow */}
            <div className="relative">
              <div className="absolute inset-0 scale-150 rounded-3xl bg-[#7ab800]/20 blur-xl" />
              <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-[#7ab800] to-[#5a8c00] flex items-center justify-center shadow-2xl shadow-[#7ab800]/40">
                <i className="fas fa-bolt text-[#182200] text-3xl" />
              </div>
            </div>
            <div>
              <p className="text-white font-black text-xl mb-1.5 tracking-tight">Como posso ajudar?</p>
              <p className="text-zinc-500 text-sm max-w-xs leading-relaxed">
                Pergunte sobre finanças, dívidas, orçamento ou o<br />método Kashim.
              </p>
            </div>
            <div className="flex flex-col gap-2.5 w-full max-w-sm">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => { setInput(s); inputRef.current?.focus(); }}
                  className="text-left text-sm text-zinc-300 bg-white/5 hover:bg-white/8 border border-white/12 hover:border-[#7ab800]/40 rounded-2xl px-4 py-3.5 transition-all leading-snug"
                >
                  {s}
                </button>
              ))}
            </div>
            {/* Status do consultor */}
            <div className="flex items-center justify-between w-full max-w-sm bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
              <span className="text-sm text-zinc-400">Status do Consultor:</span>
              <span className="flex items-center gap-1.5 text-sm font-semibold text-[#7ab800]">
                <span className="w-2 h-2 rounded-full bg-[#7ab800] shadow-sm shadow-[#7ab800]/60 animate-pulse" />
                Ativo e Pronto
              </span>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-2.5`}>
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-[#7ab800] flex items-center justify-center shrink-0 mt-1 shadow-md shadow-[#7ab800]/30">
                <i className="fas fa-bolt text-[#182200] text-xs" />
              </div>
            )}
            <div className={`max-w-[84%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
              msg.role === 'user'
                ? 'bg-[#1e3a00] border border-[#7ab800]/35 text-white font-medium rounded-tr-sm'
                : 'bg-white/6 border border-white/10 rounded-tl-sm'
            }`}>
              {msg.role === 'assistant'
                ? <MessageContent text={msg.content} />
                : <span className="whitespace-pre-wrap">{msg.content}</span>
              }
            </div>
          </div>
        ))}

        {loading && (
          <div className="space-y-2 pl-9">
            <StatusChips />
            <div className="flex gap-2.5">
              <div className="w-7 h-7 rounded-full bg-[#7ab800] flex items-center justify-center shrink-0 shadow-md shadow-[#7ab800]/30">
                <i className="fas fa-bolt text-[#182200] text-xs" />
              </div>
              <div className="bg-white/6 border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3.5 flex gap-1.5 items-center">
                <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-center">
            <p className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-2.5">{error}</p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="relative px-4 pb-5 pt-2.5 border-t border-white/8 shrink-0">
        {userCount > 0 && (
          <div className="mb-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-zinc-500">
                Limite diário: {userCount}/{DAILY_LIMIT} mensagens
              </span>
              <span className="text-[10px]">
                {userCount >= DAILY_LIMIT
                  ? <span className="text-red-400">limite atingido</span>
                  : userCount >= DAILY_LIMIT - 2
                    ? <span className="text-amber-400">quase no limite</span>
                    : <span className="text-zinc-600">{pct}%</span>}
              </span>
            </div>
            <div className="h-0.5 bg-white/6 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#7ab800] rounded-full transition-all"
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
          </div>
        )}

        {/* Aviso legal */}
        <div className="flex items-center gap-1.5 mb-2 px-0.5">
          <i className="fas fa-circle-info text-[9px] text-amber-500/50" />
          <span className="text-[10px] text-amber-500/50 leading-tight">
            Orientativo — não substitui consultoria financeira profissional
          </span>
        </div>

        {userCount >= DAILY_LIMIT ? (
          <div className="flex items-center justify-center gap-2 bg-white/4 border border-white/10 rounded-2xl px-4 py-3.5">
            <i className="fas fa-lock text-zinc-600 text-xs" />
            <span className="text-xs text-zinc-500">Limite diário atingido. Volte amanhã ou inicie nova conversa.</span>
          </div>
        ) : (
          <div className="flex gap-2 items-end bg-white/6 border border-white/12 rounded-2xl px-4 py-2.5 shadow-inner">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Pergunte qualquer coisa sobre..."
              rows={1}
              className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 resize-none outline-none max-h-32 overflow-y-auto"
              style={{ lineHeight: '1.5' }}
            />
            {/* Ditado: quem transcreve é o aparelho, não uma API paga. */}
            <button
              onClick={() => ouvir((texto) => setInput((atual) => (atual ? `${atual} ${texto}` : texto)))}
              disabled={loading}
              aria-label={gravando ? 'Ouvindo, fale agora' : 'Falar em vez de escrever'}
              title={gravando ? 'Ouvindo…' : 'Falar em vez de escrever'}
              className={`shrink-0 h-9 w-9 rounded-xl flex items-center justify-center transition-all active:scale-95 ${gravando ? 'bg-[#ff3b30] text-white animate-pulse' : 'bg-white/10 text-zinc-300'}`}
            >
              <i className={`fas ${gravando ? 'fa-stop' : 'fa-microphone'} text-xs`} />
            </button>
            <button
              onClick={send}
              disabled={!input.trim() || loading}
              className="shrink-0 h-9 px-4 rounded-xl bg-[#7ab800] disabled:bg-white/8 disabled:text-zinc-600 text-[#182200] font-black text-[11px] uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 shadow-md shadow-[#7ab800]/20"
            >
              <i className="fas fa-paper-plane text-[10px]" />
              <span>Enviar</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
