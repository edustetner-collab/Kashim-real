
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { SummaryData, FinanceItem, CategoryType, PartialExpense } from '../types';
import { IDEAL_LIMITS, formatCurrency } from '../constants';

interface AICoachProps {
  summary: SummaryData;
  items: FinanceItem[];
  monthName: string;
  onAddPartial: (itemId: string, expense: PartialExpense) => void;
}

const AICoach: React.FC<AICoachProps> = ({ summary, items, monthName, onAddPartial }) => {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  // Ref to always call the latest analyzeOrAction from stale speech callbacks
  const analyzeOrActionRef = useRef<(text?: string) => void>(() => {});

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.continuous = false;
    recognitionRef.current.lang = 'pt-BR';
    recognitionRef.current.interimResults = true;

    recognitionRef.current.onresult = (event: any) => {
      const results = Array.from(event.results) as any[];
      const transcript = results.map((r: any) => r[0].transcript).join('');
      setPrompt(transcript);
      // Check the last result for isFinal — earlier interim results stay false
      const lastResult = results[results.length - 1];
      if (lastResult?.[0]?.isFinal) {
        setIsListening(false);
        setTimeout(() => analyzeOrActionRef.current(transcript), 300);
      }
    };
    recognitionRef.current.onend = () => setIsListening(false);
    recognitionRef.current.onerror = (event: any) => {
      console.error('Speech error:', event.error);
      setIsListening(false);
    };
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setPrompt('');
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  const analyzeOrAction = async (textToProcess?: string) => {
    const finalPrompt = textToProcess || prompt;
    if (!finalPrompt.trim()) return;

    const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      setResponse('⚠️ Stets está temporariamente offline. Chave de API não configurada.');
      return;
    }

    setLoading(true);
    setResponse(null);

    const ai = new GoogleGenAI({ apiKey });
    
    const fixedPercent = (summary.totalFixed / summary.totalIncome) * 100;
    const leisurePercent = (summary.totalLeisure / summary.totalIncome) * 100;
    
    // Agora incluímos também itens de Lazer para o Stets poder lançar gastos neles
    const availableItems = items
      .filter(i => 
        i.category === CategoryType.FIXED_EXPENSE || 
        i.category === CategoryType.VARIABLE_EXPENSE || 
        i.category === CategoryType.PERSONAL_LEISURE
      )
      .map(i => ({ id: i.id, description: i.description, category: i.category }));

    const systemInstruction = `
      Seu nome é Stets. Você é o mentor e assistente pessoal de finanças do método "RICO nessa vida".
      Sua missão é:
      1. ANALISAR: Se o usuário perguntar sobre a vida financeira (ex: "Stets, como estou indo?"), use os dados: Renda ${formatCurrency(summary.totalIncome)}, Fixos ${fixedPercent.toFixed(1)}% (ideal 55%), Lazer ${leisurePercent.toFixed(1)}% (ideal 15%). 
      2. LANÇAR GASTOS: Se o usuário disser que gastou algo (ex: "Stets, gastei 50 reais com cinema"), identifique o VALOR e a CATEGORIA/ITEM mais provável entre os IDs disponíveis: ${JSON.stringify(availableItems)}.
      
      IMPORTANTE: Para lançamentos de gastos detectados no texto, chame SEMPRE a função 'registrar_gasto'.
      Ao responder, apresente-se como Stets. Seu tom deve ser sofisticado, direto e encorajador. Você não apenas organiza, você lidera o usuário rumo à riqueza.
    `;

    const registrarGastoTool = {
      name: 'registrar_gasto',
      parameters: {
        type: Type.OBJECT,
        description: 'Registra um novo gasto nas planilhas de lançamento diário (Gastos Frequentes)',
        properties: {
          itemId: { type: Type.STRING, description: 'O ID do item/coluna correspondente da lista disponível' },
          valor: { type: Type.NUMBER, description: 'O valor numérico do gasto sem R$' },
          categoriaEncontrada: { type: Type.STRING, description: 'Nome do item ou categoria identificada para feedback amigável' }
        },
        required: ['itemId', 'valor', 'categoriaEncontrada']
      }
    };

    try {
      const result = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: finalPrompt,
        config: {
          systemInstruction: systemInstruction,
          tools: [{ functionDeclarations: [registrarGastoTool] }],
        }
      });

      const functionCalls = result.functionCalls;
      
      if (functionCalls && functionCalls.length > 0) {
        const call = functionCalls[0];
        if (call.name === 'registrar_gasto') {
          const { itemId, valor, categoriaEncontrada } = call.args as any;
          
          const expense: PartialExpense = {
            id: Math.random().toString(36).substr(2, 9),
            date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
            description: 'Lançamento via Stets',
            value: valor
          };

          onAddPartial(itemId, expense);
          setResponse(`✅ **Aqui é o Stets.**\n\nLançamento de **${formatCurrency(valor)}** processado com sucesso em **${categoriaEncontrada}**. Sua disciplina é o caminho para o topo!`);
          setPrompt('');
        }
      } else {
        setResponse(result.text || "Estou à disposição. Como posso ajudar no seu planejamento hoje?");
      }
    } catch (error: any) {
      console.error('Stets error:', error);
      setResponse('Tive um problema momentâneo em processar essa informação. Pode repetir o comando para o Stets?');
    } finally {
      setLoading(false);
    }
  };

  // Keep ref in sync so speech recognition callbacks always call the latest version
  analyzeOrActionRef.current = analyzeOrAction;

  return (
    <div className="bg-[#0a0a0a] border border-zinc-800 rounded-3xl p-6 mb-8 shadow-2xl relative overflow-hidden group">
      <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
        <i className="fas fa-user-tie text-8xl text-yellow-500"></i>
      </div>
      
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 ${isListening ? 'bg-red-500 animate-ping' : 'bg-yellow-500'} rounded-full flex items-center justify-center transition-colors shadow-lg shadow-yellow-500/20`}>
              <i className={`fas ${isListening ? 'fa-microphone' : 'fa-brain'} text-black`}></i>
            </div>
            <div>
              <h3 className="text-white font-black text-xl uppercase italic tracking-tighter leading-none">Stets - Seu Mentor</h3>
              <p className="text-yellow-500/50 text-[10px] font-bold uppercase tracking-widest mt-1">
                {isListening ? 'Stets está ouvindo com atenção...' : 'Envie um comando para Stets'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="relative flex gap-2">
            <div className="relative flex-grow">
              <input 
                type="text" 
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && analyzeOrAction()}
                placeholder={isListening ? 'Pode falar...' : 'Ex: "Lançar 50 reais em cinema", ou peça um diagnóstico financeiro.'}
                className={`w-full bg-zinc-900 border ${isListening ? 'border-red-500/50 ring-1 ring-red-500/20' : 'border-zinc-800'} rounded-2xl px-5 py-4 pr-14 text-white text-sm outline-none focus:border-yellow-500 transition-all shadow-inner`}
              />
              <button 
                onClick={toggleListening}
                className={`absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl flex items-center justify-center transition-all ${isListening ? 'bg-red-500 text-white shadow-lg shadow-red-500/40' : 'text-zinc-500 hover:text-yellow-500 hover:bg-zinc-800'}`}
                title="Falar com Stets"
              >
                <i className={`fas ${isListening ? 'fa-stop' : 'fa-microphone'} text-lg`}></i>
              </button>
            </div>
            
            <button 
              onClick={() => analyzeOrAction()}
              disabled={loading || isListening}
              className="bg-gradient-to-br from-yellow-400 to-yellow-600 hover:from-yellow-300 hover:to-yellow-500 text-black font-black px-8 rounded-2xl text-xs uppercase transition-all disabled:opacity-50 shadow-lg active:scale-95"
            >
              {loading ? <i className="fas fa-circle-notch animate-spin"></i> : <i className="fas fa-paper-plane"></i>}
            </button>
          </div>

          {response && (
            <div className="mt-2 bg-zinc-900/80 border border-zinc-800 p-5 rounded-2xl text-zinc-300 text-sm leading-relaxed animate-in zoom-in-95 duration-300">
              <div className="prose prose-invert max-w-none prose-p:my-1">
                {response.split('\n').map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AICoach;
