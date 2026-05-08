
import React, { useState, useRef } from 'react';
import { SummaryData, FinanceItem, CategoryType, PartialExpense } from '../types';
import { formatCurrency } from '../constants';

interface AICoachProps {
  summary: SummaryData;
  items: FinanceItem[];
  monthName: string;
  onAddPartial: (itemId: string, expense: PartialExpense) => void;
  tetoColumns?: { id: string; title: string; linkedItemId: string }[];
}

const compressImage = (base64: string, mime: string): Promise<{ data: string; mime: string }> =>
  new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1024;
      let { width: w, height: h } = img;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round((h / w) * MAX); w = MAX; }
        else { w = Math.round((w / h) * MAX); h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      resolve({ data: canvas.toDataURL('image/jpeg', 0.8).split(',')[1], mime: 'image/jpeg' });
    };
    img.onerror = () => resolve({ data: base64, mime });
    img.src = `data:${mime};base64,${base64}`;
  });

const AICoach: React.FC<AICoachProps> = ({ summary, items, monthName, onAddPartial, tetoColumns }) => {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(() => localStorage.getItem('stets_tts') !== 'false');
  const recognitionRef = useRef<any>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const speak = (text: string) => {
    if (!ttsEnabled || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const clean = text.replace(/\*\*/g, '').replace(/[#*_~`]/g, '').replace(/[✅⚠️🔥💰📘🏆]/g, '').trim();
    const short = clean.length > 250 ? clean.slice(0, 250) + '...' : clean;
    const utt = new SpeechSynthesisUtterance(short);
    utt.lang = 'pt-BR'; utt.rate = 1.05;
    const ptVoice = window.speechSynthesis.getVoices().find(v => v.lang.startsWith('pt'));
    if (ptVoice) utt.voice = ptVoice;
    window.speechSynthesis.speak(utt);
  };

  const availableItems = () => {
    // Use TetoGastos column TITLES (user-defined, e.g. "MERCADO", "GASOLINA") as descriptions
    // so the AI matches by what the user named the column, not by the finance item description.
    // Falls back to localStorage if tetoColumns prop not loaded yet.
    const cols: { title: string; linkedItemId: string }[] =
      tetoColumns && tetoColumns.length > 0
        ? tetoColumns
        : (() => {
            try {
              return JSON.parse(localStorage.getItem('teto_columns_v3') || '[]') as { title: string; linkedItemId: string }[];
            } catch { return []; }
          })();

    const linked = cols.filter(c => c.linkedItemId && items.some(i => i.id === c.linkedItemId));

    if (linked.length > 0) {
      return linked.map(c => ({ id: c.linkedItemId, description: c.title }));
    }

    // Last resort fallback — no configured columns
    return items
      .filter(i =>
        i.category === CategoryType.VARIABLE_EXPENSE ||
        i.category === CategoryType.PERSONAL_LEISURE
      )
      .map(i => ({ id: i.id, description: i.description }));
  };

  const buildSystemPrompt = () => {
    const fixedPct = ((summary.totalFixed / summary.totalIncome) * 100).toFixed(1);
    const leisurePct = ((summary.totalLeisure / summary.totalIncome) * 100).toFixed(1);
    return `Seu nome é Stets. Você é o mentor financeiro do método "RICO nessa vida", criado por Eduardo Stetner — consultor financeiro com 9 anos de experiência.
Mês atual: ${monthName} | Renda: ${formatCurrency(summary.totalIncome)} | Fixos: ${fixedPct}% (ideal ≤55%) | Lazer: ${leisurePct}% (ideal ≤15%).

REGRAS DE RESPOSTA (OBRIGATÓRIAS):
- Máximo 2 frases curtas em português conversacional.
- ZERO markdown: sem **, sem #, sem listas, sem tabelas, sem código.
- ZERO emojis.
- Tom direto e encorajador.
- Não mencione ferramentas, funções ou registro técnico — apenas fale naturalmente.`;
  };

  const callStets = async (userMessage: string, imageData?: string, imageMimeType?: string) => {
    const res = await fetch('/api/stets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userMessage,
        imageData,
        imageMimeType,
        systemPrompt: buildSystemPrompt(),
        availableItems: availableItems(),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `Erro ${res.status}` }));
      throw new Error(err.error || `Erro ${res.status}`);
    }
    return res.json() as Promise<{ text: string; expense?: { itemId: string; value: number; description: string } }>;
  };

  const handleResponse = (text: string, expense?: { itemId: string; value: number; description: string } | null) => {
    setResponse(text);
    speak(text);
    if (!expense?.itemId || !expense?.value) return;

    const matchedItem = items.find(i => i.id === expense.itemId);
    if (!matchedItem) {
      setResponse(prev => `${prev}\n\n⚠️ Gasto detectado (${formatCurrency(expense.value)}) mas nenhuma coluna vinculada encontrada. Vá em Gastos e vincule um item.`);
      return;
    }
    const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const partial: PartialExpense = {
      id: crypto.randomUUID(),
      date: today,
      description: expense.description || matchedItem.description,
      value: expense.value,
    };
    const now = new Date();
    onAddPartial(expense.itemId, partial, now.getFullYear(), now.getMonth());
    setResponse(`✅ ${formatCurrency(expense.value)} em ${matchedItem.description} • ${today}`);
  };

  const analyzeText = async (text?: string) => {
    const finalPrompt = text ?? prompt;
    if (!finalPrompt.trim()) return;
    setLoading(true);
    setResponse(null);
    try {
      const { text: txt, expense } = await callStets(finalPrompt);
      handleResponse(txt, expense);
      setPrompt('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao processar.';
      setResponse(`⚠️ ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const analyzePhoto = async (base64: string, mime: string) => {
    setLoading(true);
    setResponse(null);
    try {
      const compressed = await compressImage(base64, mime);
      const { text: txt, expense } = await callStets(
        'Analise este comprovante. Identifique o estabelecimento, valor total e categoria do gasto.',
        compressed.data,
        compressed.mime,
      );
      handleResponse(txt, expense);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao processar foto.';
      setResponse(`⚠️ ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  };

  const startRecording = async () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setResponse('⚠️ Reconhecimento de voz não disponível. Use o teclado.');
      return;
    }

    // Explicitly request microphone permission before SpeechRecognition.
    // Required on iOS WKWebView (Capacitor) — without this the API returns
    // service-not-allowed even when the system microphone permission is on.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
    } catch {
      setResponse('⚠️ Permissão de microfone negada. Ative o microfone nas configurações do aplicativo.');
      return;
    }

    const recognition = new SR();
    recognition.lang = 'pt-BR';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      setPrompt(transcript);
    };
    recognition.onend = () => {
      setIsRecording(false);
      if (prompt.trim()) analyzeText(prompt);
    };
    recognition.onerror = (event: any) => {
      setIsRecording(false);
      if (event.error === 'service-not-allowed' || event.error === 'not-allowed') {
        setResponse('⚠️ Permissão de microfone negada. Ative o microfone nas configurações do aplicativo.');
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setResponse(`⚠️ Erro no microfone: ${event.error}. Use o teclado.`);
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  const toggleRecording = () => {
    if (isRecording) { stopRecording(); return; }
    startRecording();
  };

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      analyzePhoto(base64, file.type || 'image/jpeg');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className="bg-[#0a0a0a] border border-zinc-800 rounded-3xl p-6 mb-8 shadow-2xl relative overflow-hidden group">
      <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
        <i className="fas fa-user-tie text-8xl text-yellow-500"></i>
      </div>
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-white font-black text-xl uppercase italic tracking-tighter leading-none">Stets — Seu Mentor</h3>
            <p className={`text-[10px] font-bold uppercase tracking-widest mt-1 ${isRecording ? 'text-red-400 animate-pulse' : 'text-yellow-500/50'}`}>
              {isRecording ? '● Ouvindo... toque em Parar' : 'Fale, escreva ou envie um comprovante'}
            </p>
          </div>
          {'speechSynthesis' in window && (
            <button
              onClick={() => {
                const v = !ttsEnabled;
                setTtsEnabled(v);
                localStorage.setItem('stets_tts', String(v));
                if (!v) window.speechSynthesis.cancel();
              }}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-colors border ${
                ttsEnabled ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' : 'bg-zinc-800 text-zinc-500 border-zinc-700'
              }`}
            >
              <i className={`fas ${ttsEnabled ? 'fa-volume-up' : 'fa-volume-mute'} text-xs`}></i>
              <span>Voz</span>
            </button>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <input
            type="text"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && analyzeText()}
            placeholder={isRecording ? 'Ouvindo... fale agora' : 'Ex: "gastei 45 reais no mercado" ou "como estou indo?"'}
            disabled={loading}
            className={`w-full bg-zinc-900 border ${isRecording ? 'border-red-500/40' : 'border-zinc-800'} rounded-2xl px-5 py-4 text-white text-sm outline-none focus:border-yellow-500 transition-all shadow-inner disabled:opacity-60`}
          />

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => photoInputRef.current?.click()}
              disabled={loading || isRecording}
              className="flex items-center gap-2 bg-zinc-800 active:bg-zinc-700 text-zinc-300 font-black px-4 py-3 rounded-2xl text-xs uppercase transition-all disabled:opacity-40 border border-zinc-700"
            >
              <i className="fas fa-camera text-sm"></i>
              <span className="hidden sm:inline">Comprovante</span>
            </button>
            <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoCapture} />

            <button
              onClick={toggleRecording}
              disabled={loading}
              className={`flex items-center gap-2 font-black px-4 py-3 rounded-2xl text-xs uppercase transition-all disabled:opacity-40 border ${
                isRecording
                  ? 'bg-red-500 text-white border-red-400 shadow-lg shadow-red-500/30'
                  : 'bg-zinc-800 active:bg-zinc-700 text-zinc-300 border-zinc-700'
              }`}
            >
              <i className={`fas ${isRecording ? 'fa-stop-circle' : 'fa-microphone'} text-sm`}></i>
              <span>{isRecording ? 'Parar' : 'Falar'}</span>
            </button>

            <button
              onClick={() => analyzeText()}
              disabled={loading || !prompt.trim()}
              className="ml-auto flex items-center gap-2 bg-gradient-to-br from-yellow-400 to-yellow-600 active:from-yellow-300 active:to-yellow-500 text-black font-black px-6 py-3 rounded-2xl text-xs uppercase transition-all disabled:opacity-40 shadow-lg active:scale-95"
            >
              {loading
                ? <><i className="fas fa-circle-notch animate-spin"></i><span>Processando</span></>
                : <><i className="fas fa-paper-plane text-sm"></i><span>Enviar</span></>
              }
            </button>
          </div>

          {response && (
            <div className="mt-1 bg-zinc-900/80 border border-zinc-800 p-5 rounded-2xl text-zinc-300 text-sm leading-relaxed animate-in zoom-in-95 duration-300">
              {response.split('\n').map((line, i) => (
                <p key={i} className={line.startsWith('✅') ? 'text-green-400 font-bold' : line.startsWith('⚠️') ? 'text-yellow-400' : ''}>
                  {line.replace(/\*\*(.*?)\*\*/g, '$1')}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AICoach;
