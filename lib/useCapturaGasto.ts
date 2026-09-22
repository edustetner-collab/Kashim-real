import type { ChangeEvent } from 'react';
import { useRef, useState, useCallback } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useDitado } from './useDitado';

/**
 * Captura de gasto por foto, imagem ou voz — a parte que os dois pontos de
 * entrada precisam.
 *
 * Vivia só dentro do AICoach, e quando o pop-up de lançamento passou a oferecer
 * os mesmos atalhos a escolha era duplicar ou extrair. Duplicar significaria
 * duas versões da mesma conversa com a IA, divergindo a cada correção.
 *
 * O hook não decide NADA sobre a tela: devolve os disparadores e o resultado
 * cru da IA, e quem chama resolve o que fazer com ele.
 */

export interface GastoDetectado {
  description: string;
  value: number;
  category?: string;
  itemId?: string | null;
  installments?: number;
  isCredit?: boolean;
}

interface Opcoes {
  /** Contexto que a IA recebe para interpretar o gasto. */
  systemPrompt: () => string;
  /** Linhas do plano onde o gasto pode cair. */
  availableItems: () => Array<{ id: string; description: string }>;
  onResultado: (texto: string, gastos?: GastoDetectado[] | null) => void;
  onErro?: (mensagem: string) => void;
}

export function useCapturaGasto({ systemPrompt, availableItems, onResultado, onErro }: Opcoes) {
  const { getToken } = useAuth();
  const [ocupado, setOcupado] = useState(false);
  const { gravando, ouvir } = useDitado(onErro);
  const inputFoto = useRef<HTMLInputElement>(null);
  const inputGaleria = useRef<HTMLInputElement>(null);

  const chamarIA = useCallback(async (mensagem: string, imagem?: string, mime?: string) => {
    setOcupado(true);
    try {
      const token = await getToken({ template: 'supabase' });
      const res = await fetch('/api/stets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          userMessage: mensagem,
          imageData: imagem,
          imageMimeType: mime,
          systemPrompt: systemPrompt(),
          availableItems: availableItems(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `Erro ${res.status}` }));
        throw new Error(err.error || `Erro ${res.status}`);
      }
      const json = await res.json() as { text: string; expenses?: GastoDetectado[] };
      onResultado(json.text, json.expenses);
    } catch (e) {
      onErro?.(e instanceof Error ? e.message : 'Não consegui ler isso. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  }, [getToken, systemPrompt, availableItems, onResultado, onErro]);

  const aoEscolherArquivo = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      void chamarIA('Analise este comprovante e registre o gasto.', base64, file.type || 'image/jpeg');
    };
    reader.readAsDataURL(file);
    // Zerar permite escolher o MESMO arquivo de novo; sem isso o onChange não
    // dispara na segunda vez e o botão parece quebrado.
    e.target.value = '';
  }, [chamarIA]);

  const tirarFoto = useCallback(() => inputFoto.current?.click(), []);
  const anexarImagem = useCallback(() => inputGaleria.current?.click(), []);

  /** A escuta mora no `useDitado`; aqui o texto ouvido vira gasto. */
  const falar = useCallback(() => ouvir((texto) => { void chamarIA(texto); }), [ouvir, chamarIA]);

  return {
    ocupado,
    gravando,
    tirarFoto,
    anexarImagem,
    falar,
    chamarIA,
    /** Os dois inputs precisam existir na árvore para os cliques funcionarem. */
    inputsOcultos: { inputFoto, inputGaleria, aoEscolherArquivo },
  };
}


