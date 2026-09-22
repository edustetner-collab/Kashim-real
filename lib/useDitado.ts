import { useCallback, useState } from 'react';
import { SpeechRecognition as NativeSpeech } from '@capacitor-community/speech-recognition';
import { isNativeApp } from './onboarding/platform';

/**
 * Ouvir e transcrever, sem custo: quem reconhece a fala é o próprio aparelho.
 *
 * São APIs diferentes com o mesmo propósito — no app o WebView não entrega
 * reconhecimento confiável, e no navegador o plugin nativo não existe. Antes
 * isso vivia dentro do `useCapturaGasto` e o texto ouvido virava gasto
 * obrigatoriamente; o Stets precisa do mesmo microfone para conversar.
 */
export function useDitado(onErro?: (msg: string) => void) {
  const [gravando, setGravando] = useState(false);

  const ouvir = useCallback(async (onTexto: (texto: string) => void) => {
    if (gravando) return;

    /** Caminho do navegador — também serve de reserva quando o app falha. */
    const pelaWeb = (aviso: string) => {
      const SR = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike })
        .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
      if (!SR) { onErro?.(aviso); return; }
      const rec = new SR();
      rec.lang = 'pt-BR';
      rec.interimResults = false;
      rec.onresult = (ev: { results: Array<Array<{ transcript: string }>> }) => {
        const texto = ev.results?.[0]?.[0]?.transcript;
        if (texto) onTexto(texto);
      };
      rec.onerror = () => { setGravando(false); onErro?.('Não consegui ouvir. Tente de novo.'); };
      rec.onend = () => setGravando(false);
      setGravando(true);
      rec.start();
    };

    try {
      if (isNativeApp) {
        /**
         * O caminho do app pode falhar sem nenhum pedido de permissão aparecer
         * (Eduardo, 2026-09-22). Quando falha, cai para o navegador em vez de
         * só avisar, e a mensagem diz o motivo REAL — sem isso vira adivinhação.
         */
        try {
          const perm = await NativeSpeech.checkPermissions();
          if (perm.speechRecognition !== 'granted') {
            const pedido = await NativeSpeech.requestPermissions();
            if (pedido.speechRecognition !== 'granted') {
              onErro?.('Preciso da permissão de microfone. Ajustes → Kashim → Microfone e Reconhecimento de Fala.');
              return;
            }
          }
          setGravando(true);
          const r = await NativeSpeech.start({ language: 'pt-BR', maxResults: 1, partialResults: false, popup: false });
          setGravando(false);
          const texto = r?.matches?.[0];
          if (texto) onTexto(texto);
          return;
        } catch (e) {
          setGravando(false);
          const motivo = e instanceof Error ? e.message : String(e);
          pelaWeb(`O microfone do app não respondeu (${motivo}). Escreva a pergunta por enquanto.`);
          return;
        }
      }

      pelaWeb('Seu navegador não reconhece voz. Use o app ou escreva.');
    } catch (e) {
      setGravando(false);
      onErro?.(`Não consegui acessar o microfone (${e instanceof Error ? e.message : String(e)}).`);
    }
  }, [gravando, onErro]);

  return { gravando, ouvir };
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: (ev: { results: Array<Array<{ transcript: string }>> }) => void;
  onerror: () => void;
  onend: () => void;
  start: () => void;
}
