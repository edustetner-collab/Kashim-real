
import React, { useState, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { SpeechRecognition as NativeSpeech } from '@capacitor-community/speech-recognition';
import { SummaryData, FinanceItem, CategoryType } from '../types';
import { formatCurrency } from '../constants';
import { DetectedExpense } from './ExpenseSheet';

const isNativeApp = () => !!(window as any).Capacitor?.isNativePlatform?.();

interface AICoachProps {
  summary: SummaryData;
  items: FinanceItem[];
  monthName: string;
  onExpenseDetected: (data: DetectedExpense) => void;
  tetoColumns?: { id: string; title: string; linkedItemId: string }[];
}

interface RawExpense {
  itemId: string;
  value: number;
  description: string;
  installments: number;
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

const AICoach: React.FC<AICoachProps> = ({ summary, items, monthName, onExpenseDetected, tetoColumns }) => {
  const { getToken } = useAuth();
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(() => localStorage.getItem('stets_tts') !== 'false');
  const [pendingExpenses, setPendingExpenses] = useState<RawExpense[]>([]);
  const recognitionRef = useRef<any>(null);
  const nativeTranscriptRef = useRef('');
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
    const token = await getToken();
    const res = await fetch('/api/stets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
    return res.json() as Promise<{ text: string; expenses?: RawExpense[] }>;
  };

  const handleResponse = (text: string, expenses?: RawExpense[] | null) => {
    setResponse(text);
    speak(text);
    const valid = (expenses ?? []).filter(e => e.value > 0);
    if (valid.length > 0) {
      setPendingExpenses(valid);
    }
  };

  const dismissExpense = (idx: number) =>
    setPendingExpenses(prev => prev.filter((_, i) => i !== idx));

  const launchExpense = (exp: RawExpense, idx: number) => {
    onExpenseDetected({ ...exp, isCredit: false });
    dismissExpense(idx);
  };

  const redirectToManual = (exp: RawExpense, idx: number) => {
    onExpenseDetected({ itemId: '', value: exp.value, description: exp.description, installments: exp.installments, isCredit: false });
    dismissExpense(idx);
  };

  const analyzeText = async (text?: string) => {
    const finalPrompt = text ?? prompt;
    if (!finalPrompt.trim()) return;
    setLoading(true);
    setResponse(null);
    setPendingExpenses([]);
    try {
      const { text: txt, expenses } = await callStets(finalPrompt);
      handleResponse(txt, expenses);
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
    setPendingExpenses([]);
    try {
      const compressed = await compressImage(base64, mime);
      const { text: txt, expenses } = await callStets(
        'Analise este comprovante ou extrato. Identifique todas as despesas, estabelecimentos e valores.',
        compressed.data,
        compressed.mime,
      );
      handleResponse(txt, expenses);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao processar foto.';
      setResponse(`⚠️ ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const stopRecording = async () => {
    if (isNativeApp()) {
      await NativeSpeech.stop().catch(() => {});
      await NativeSpeech.removeAllListeners();
      setIsRecording(false);
      const transcript = nativeTranscriptRef.current;
      nativeTranscriptRef.current = '';
      if (transcript.trim()) analyzeText(transcript);
    } else {
      recognitionRef.current?.stop();
      setIsRecording(false);
    }
  };

  const startRecordingNative = async () => {
    try {
      const perms = await NativeSpeech.requestPermissions();
      if (perms.speechRecognition !== 'granted') {
        setResponse('⚠️ Permissão negada. Vá em Ajustes > Kashim e ative Microfone e Reconhecimento de Voz.');
        return;
      }
    } catch {
      startRecordingWeb();
      return;
    }

    nativeTranscriptRef.current = '';
    await NativeSpeech.removeAllListeners();

    NativeSpeech.addListener('partialResults', (data: { matches: string[] | null }) => {
      const text = data.matches?.[0] ?? '';
      if (text) { nativeTranscriptRef.current = text; setPrompt(text); }
    });

    await NativeSpeech.start({ language: 'pt-BR', maxResults: 1, popup: false, partialResults: true });
    setIsRecording(true);
  };

  const startRecordingWeb = async () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setResponse('⚠️ Reconhecimento de voz não disponível. Use o teclado.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
    } catch {
      setResponse('⚠️ Permissão de microfone negada. Clique no cadeado na barra de endereço e ative o microfone.');
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
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setResponse('⚠️ Permissão negada. Ajustes > Kashim → ative Microfone e Reconhecimento de Voz.');
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setResponse(`⚠️ Microfone indisponível (${event.error}). Use o teclado ou envie uma foto.`);
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  const startRecording = () => isNativeApp() ? startRecordingNative() : startRecordingWeb();

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
    <div className="bg-white border border-[#e8e8ed] rounded-3xl p-5 mb-8 shadow-sm relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#f0fad0] rounded-2xl flex items-center justify-center shrink-0">
            <i className="fas fa-user-tie text-[#7ab800] text-base"></i>
          </div>
          <div>
            <h3 className="text-[#1d1d1f] font-black text-base uppercase italic tracking-tight leading-none">Stets</h3>
            <p className={`text-[10px] font-bold uppercase tracking-widest mt-0.5 ${isRecording ? 'text-[#ff3b30] animate-pulse' : 'text-[#aeaeb2]'}`}>
              {isRecording ? '● Ouvindo...' : 'Fale, escreva ou envie um comprovante'}
            </p>
          </div>
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
              ttsEnabled
                ? 'bg-[#f0fad0] text-[#7ab800] border-[rgba(122,184,0,0.25)]'
                : 'bg-[#f5f5f7] text-[#aeaeb2] border-[#e8e8ed]'
            }`}
          >
            <i className={`fas ${ttsEnabled ? 'fa-volume-up' : 'fa-volume-mute'} text-xs`}></i>
            <span>Voz</span>
          </button>
        )}
      </div>

      {/* Input row */}
      <div className="flex flex-col gap-2.5">
        <input
          type="text"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && analyzeText()}
          placeholder={isRecording ? 'Ouvindo... fale agora' : 'Ex: "gastei 45 reais no mercado"'}
          disabled={loading}
          className={`w-full bg-[#f5f5f7] border ${isRecording ? 'border-[#ff3b30]/40' : 'border-[#e8e8ed]'} rounded-2xl px-4 py-3.5 text-[#1d1d1f] text-sm outline-none focus:border-[rgba(122,184,0,0.5)] transition-all disabled:opacity-60 placeholder:text-[#aeaeb2]`}
        />

        <div className="flex gap-2">
          {/* Camera */}
          <button
            onClick={() => photoInputRef.current?.click()}
            disabled={loading || isRecording}
            className="flex items-center gap-2 bg-[#f5f5f7] active:bg-[#e8e8ed] text-[#6e6e73] font-black px-4 py-3 rounded-2xl text-xs uppercase transition-all disabled:opacity-40 border border-[#e8e8ed]"
          >
            <i className="fas fa-camera text-sm"></i>
            <span className="hidden sm:inline">Foto</span>
          </button>
          <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoCapture} />

          {/* Mic */}
          <button
            onClick={toggleRecording}
            disabled={loading}
            className={`flex items-center gap-2 font-black px-4 py-3 rounded-2xl text-xs uppercase transition-all disabled:opacity-40 border ${
              isRecording
                ? 'bg-[#ff3b30] text-white border-[#ff3b30] shadow-lg shadow-[#ff3b30]/20'
                : 'bg-[#f5f5f7] active:bg-[#e8e8ed] text-[#6e6e73] border-[#e8e8ed]'
            }`}
          >
            <i className={`fas ${isRecording ? 'fa-stop-circle' : 'fa-microphone'} text-sm`}></i>
            <span>{isRecording ? 'Parar' : 'Falar'}</span>
          </button>

          {/* Send */}
          <button
            onClick={() => analyzeText()}
            disabled={loading || !prompt.trim()}
            className="ml-auto flex items-center gap-2 k-btn-lime font-black px-6 py-3 rounded-2xl text-xs uppercase transition-all disabled:opacity-40"
          >
            {loading
              ? <><i className="fas fa-circle-notch animate-spin"></i><span>Pensando</span></>
              : <><i className="fas fa-paper-plane text-sm"></i><span>Enviar</span></>
            }
          </button>
        </div>

        {/* Response text */}
        {response && (
          <div className="mt-1 bg-[#fafafa] border border-[#e8e8ed] p-4 rounded-2xl text-[#1d1d1f] text-sm leading-relaxed animate-in zoom-in-95 duration-300">
            {response.split('\n').map((line, i) => (
              <p key={i} className={line.startsWith('⚠️') ? 'text-[#ff3b30]' : ''}>
                {line.replace(/\*\*(.*?)\*\*/g, '$1')}
              </p>
            ))}
          </div>
        )}

        {/* Detected expense cards */}
        {pendingExpenses.length > 0 && (
          <div className="mt-1 space-y-2 animate-in slide-in-from-bottom-2 duration-300">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#aeaeb2]">
              {pendingExpenses.length} despesa{pendingExpenses.length > 1 ? 's' : ''} detectada{pendingExpenses.length > 1 ? 's' : ''}
            </p>
            {pendingExpenses.map((exp, idx) => {
              const matchedItem = items.find(i => i.id === exp.itemId);
              const label = matchedItem?.description || exp.description || 'Despesa';
              return (
                <div
                  key={idx}
                  className="flex flex-col gap-2.5 bg-[#f0fad0] border border-[rgba(122,184,0,0.25)] rounded-2xl px-4 py-3"
                >
                  {/* Info row */}
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-white rounded-xl flex items-center justify-center shrink-0 border border-[rgba(122,184,0,0.2)]">
                      <i className="fas fa-receipt text-[#7ab800] text-xs"></i>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[#1d1d1f] font-black text-sm truncate leading-tight">{label}</p>
                      <p className="text-[#7ab800] font-black text-xs k-num leading-tight">
                        {formatCurrency(exp.value)}
                        {exp.installments > 1 && <span className="text-[#aeaeb2] font-semibold"> · {exp.installments}x</span>}
                      </p>
                    </div>
                    <button
                      onClick={() => dismissExpense(idx)}
                      className="w-7 h-7 rounded-lg bg-white/70 border border-[rgba(122,184,0,0.2)] flex items-center justify-center active:scale-95 shrink-0"
                    >
                      <i className="fas fa-times text-[#aeaeb2] text-xs"></i>
                    </button>
                  </div>
                  {/* Action row */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => redirectToManual(exp, idx)}
                      className="flex-1 py-2 rounded-xl bg-white border border-[rgba(122,184,0,0.3)] text-[#6e6e73] text-[10px] font-black uppercase tracking-wide active:scale-95 transition-all"
                    >
                      É outro gasto
                    </button>
                    <button
                      onClick={() => launchExpense(exp, idx)}
                      className="flex-[2] k-btn-lime py-2 rounded-xl text-xs font-black active:scale-95"
                    >
                      Lançar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default AICoach;
