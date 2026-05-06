
import React, { useState, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { SummaryData, FinanceItem, CategoryType, PartialExpense } from '../types';
import { formatCurrency } from '../constants';

interface AICoachProps {
  summary: SummaryData;
  items: FinanceItem[];
  monthName: string;
  onAddPartial: (itemId: string, expense: PartialExpense) => void;
}

interface StetsResponse {
  acao: 'registrar' | 'responder';
  itemId?: string;
  valor?: number;
  categoriaEncontrada?: string;
  mensagem: string;
}

const hasSpeechRecognition = () =>
  typeof window !== 'undefined' && !!(
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  );

const AICoach: React.FC<AICoachProps> = ({ summary, items, monthName, onAddPartial }) => {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingMode, setRecordingMode] = useState<'speech' | 'audio'>('speech');
  const [ttsEnabled, setTtsEnabled] = useState(() => localStorage.getItem('stets_tts') !== 'false');
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const analyzeAudioRef = useRef<(b64: string, mime: string) => void>(() => {});
  const analyzePhotoRef = useRef<(b64: string, mime: string) => void>(() => {});

  const speak = (text: string) => {
    if (!ttsEnabled || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const clean = text.replace(/\*\*/g, '').replace(/[#*_~`]/g, '').replace(/[✅⚠️🔥💰📘🏆]/g, '').trim();
    const short = clean.length > 250 ? clean.slice(0, 250) + '...' : clean;
    const utt = new SpeechSynthesisUtterance(short);
    utt.lang = 'pt-BR';
    utt.rate = 1.05;
    const ptVoice = window.speechSynthesis.getVoices().find(v => v.lang.startsWith('pt'));
    if (ptVoice) utt.voice = ptVoice;
    window.speechSynthesis.speak(utt);
  };

  const buildContext = () => {
    const fixedPercent = (summary.totalFixed / summary.totalIncome) * 100;
    const leisurePercent = (summary.totalLeisure / summary.totalIncome) * 100;
    const availableItems = items
      .filter(i =>
        i.category === CategoryType.FIXED_EXPENSE ||
        i.category === CategoryType.VARIABLE_EXPENSE ||
        i.category === CategoryType.PERSONAL_LEISURE
      )
      .map(i => ({ id: i.id, description: i.description, category: i.category }));

    const systemInstruction = `Seu nome é Stets. Você é o mentor financeiro pessoal do método "RICO nessa vida".

RESPONDA SEMPRE E SOMENTE com um objeto JSON, sem markdown, sem texto fora do JSON.

Se detectar gasto (voz, texto, comprovante, cupom, recibo):
{"acao":"registrar","itemId":"ID_DA_LISTA","valor":NUMERO,"categoriaEncontrada":"NOME","mensagem":"mensagem motivacional"}

Se for pergunta ou análise:
{"acao":"responder","mensagem":"resposta completa"}

ITENS DISPONÍVEIS: ${JSON.stringify(availableItems)}
DADOS: Renda ${formatCurrency(summary.totalIncome)} | Fixos ${fixedPercent.toFixed(1)}% (≤55%) | Lazer ${leisurePercent.toFixed(1)}% (≤15%)
Use somente IDs da lista acima. Tom sofisticado e encorajador.`;

    return { systemInstruction };
  };

  const getAi = () => {
    const apiKey = (process.env as any).API_KEY || (process.env as any).GEMINI_API_KEY;
    if (!apiKey) throw new Error('Chave de API não configurada.');
    return new GoogleGenAI({ apiKey });
  };

  const processJsonResult = (result: any) => {
    const raw = result.text ?? '';
    let parsed: StetsResponse | null = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*?\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch { /* ignore */ } }
    }

    if (!parsed) {
      setResponse(raw || 'Estou à disposição. Como posso ajudar?');
      speak(raw);
      return;
    }

    if (parsed.acao === 'registrar' && parsed.itemId && parsed.valor) {
      const expense: PartialExpense = {
        id: crypto.randomUUID(),
        date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        description: 'Lançamento via Stets',
        value: parsed.valor,
      };
      onAddPartial(parsed.itemId, expense);
      const msg = `✅ Lançamento de ${formatCurrency(parsed.valor)} registrado em **${parsed.categoriaEncontrada || parsed.itemId}**. ${parsed.mensagem}`;
      setResponse(msg);
      speak(parsed.mensagem);
      setPrompt('');
      return;
    }

    setResponse(parsed.mensagem);
    speak(parsed.mensagem);
  };

  const geminiCall = async (contents: any) => {
    const { systemInstruction } = buildContext();
    const ai = getAi();
    return ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: { systemInstruction },
    });
  };

  const analyzeText = async (text?: string) => {
    const finalPrompt = text || prompt;
    if (!finalPrompt.trim()) return;
    setLoading(true);
    setResponse(null);
    try {
      const result = await geminiCall(finalPrompt);
      processJsonResult(result);
    } catch (error: any) {
      setResponse(`⚠️ ${error?.message || 'Erro ao processar. Tente novamente.'}`);
    } finally {
      setLoading(false);
    }
  };

  const analyzeAudio = async (base64Audio: string, mimeType: string) => {
    setLoading(true);
    setResponse(null);
    try {
      const result = await geminiCall([{
        role: 'user',
        parts: [
          { text: 'Áudio com comando financeiro. Transcreva e processe.' },
          { inlineData: { mimeType, data: base64Audio } },
        ],
      }]);
      processJsonResult(result);
    } catch (error: any) {
      setResponse(`⚠️ ${error?.message || 'Erro ao processar áudio.'}`);
    } finally {
      setLoading(false);
    }
  };

  const analyzePhoto = async (base64Image: string, mimeType: string) => {
    setLoading(true);
    setResponse(null);
    try {
      const result = await geminiCall([{
        role: 'user',
        parts: [
          { text: 'Comprovante ou recibo. Identifique o valor total e a categoria.' },
          { inlineData: { mimeType, data: base64Image } },
        ],
      }]);
      processJsonResult(result);
    } catch (error: any) {
      setResponse(`⚠️ ${error?.message || 'Erro ao processar foto.'}`);
    } finally {
      setLoading(false);
    }
  };

  analyzeAudioRef.current = analyzeAudio;
  analyzePhotoRef.current = analyzePhoto;

  const stopRecording = () => {
    recognitionRef.current?.stop();
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const startSpeechRecognition = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SR();
    recognition.lang = 'pt-BR';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setPrompt(transcript);
    };

    recognition.onend = () => setIsRecording(false);
    recognition.onerror = (event: any) => {
      setIsRecording(false);
      if (event.error === 'service-not-allowed' || event.error === 'not-allowed') {
        startMediaRecorder();
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setResponse(`⚠️ Erro no reconhecimento de voz: ${event.error}. Tente digitar.`);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setRecordingMode('speech');
    setIsRecording(true);
  };

  const startMediaRecorder = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const baseMime = mimeType.split(';')[0];
        const blob = new Blob(audioChunksRef.current, { type: baseMime });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          analyzeAudioRef.current(base64, baseMime);
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingMode('audio');
      setIsRecording(true);
    } catch {
      setResponse('⚠️ Microfone não disponível. Verifique as permissões do dispositivo.');
    }
  };

  const toggleRecording = () => {
    if (isRecording) { stopRecording(); return; }
    if (hasSpeechRecognition()) { startSpeechRecognition(); } else { startMediaRecorder(); }
  };

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      analyzePhotoRef.current(base64, file.type || 'image/jpeg');
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
              {isRecording
                ? recordingMode === 'audio'
                  ? '● Gravando áudio — toque em Parar e o Stets processa'
                  : '● Ouvindo... toque em Parar quando terminar'
                : 'Fale, escreva ou envie um comprovante'}
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
                ttsEnabled
                  ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
                  : 'bg-zinc-800 text-zinc-500 border-zinc-700'
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
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && analyzeText()}
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
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handlePhotoCapture}
            />

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
