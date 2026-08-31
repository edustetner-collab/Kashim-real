import React, { useRef, useState } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';

/**
 * Suporte — o cliente abre um chamado de dentro do app.
 *
 * O print é comprimido AQUI antes de subir: screenshot de celular moderno
 * passa de 3 MB, o que estouraria o limite de corpo da rota e faria o cliente
 * perder o que escreveu. Reduzido para 1400px e JPEG 0.7, um print típico cai
 * para algumas centenas de KB sem ficar ilegível.
 */

interface Props {
  onClose: () => void;
  /** Onde o cliente estava quando abriu o chamado — vai junto no contexto. */
  telaAtual?: string;
}

const MAX_LADO = 1400;

async function comprimirImagem(file: File): Promise<string> {
  const dataUrl: string = await new Promise((ok, err) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result));
    fr.onerror = () => err(new Error('Não consegui ler a imagem'));
    fr.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((ok, err) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => err(new Error('Arquivo não parece uma imagem'));
    i.src = dataUrl;
  });

  const escala = Math.min(1, MAX_LADO / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * escala);
  canvas.height = Math.round(img.height * escala);
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl; // sem canvas: manda como veio
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.7);
}

const Suporte: React.FC<Props> = ({ onClose, telaAtual }) => {
  const { getToken } = useAuth();
  const { user } = useUser();
  const fileRef = useRef<HTMLInputElement>(null);

  const [mensagem, setMensagem] = useState('');
  const [print, setPrint] = useState<string | null>(null);
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [enviado, setEnviado] = useState(false);

  const escolherArquivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErro('');
    try {
      setPrint(await comprimirImagem(file));
      setNomeArquivo(file.name);
    } catch {
      setErro('Não consegui usar essa imagem. Tente outro print.');
    }
  };

  const enviar = async () => {
    if (!mensagem.trim()) { setErro('Escreva o que aconteceu.'); return; }
    setEnviando(true);
    setErro('');
    try {
      const token = await getToken({ template: 'supabase' });
      const res = await fetch('/api/support-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          mensagem: mensagem.trim(),
          nome: user?.fullName ?? user?.firstName ?? '',
          email: user?.primaryEmailAddress?.emailAddress ?? '',
          screenshot: print,
          // Contexto técnico automático: evita as idas e vindas para descobrir
          // onde o erro aconteceu.
          contexto: {
            tela: telaAtual ?? 'desconhecida',
            versao: (import.meta as any).env?.VITE_BUILD_TIME ?? 'dev',
            plataforma: (window as any).Capacitor?.getPlatform?.() ?? 'web',
            navegador: navigator.userAgent,
            tamanhoTela: `${window.innerWidth}x${window.innerHeight}`,
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Não conseguimos enviar agora.');
      setEnviado(true);
    } catch (e: any) {
      setErro(e.message || 'Não conseguimos enviar agora. Tente de novo em instantes.');
    } finally {
      setEnviando(false);
    }
  };

  if (enviado) {
    return (
      <div className="fixed inset-0 z-[340] bg-black/70 backdrop-blur-sm flex items-center justify-center p-5">
        <div className="w-full max-w-sm bg-white rounded-[26px] p-7 text-center shadow-2xl">
          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <i className="fas fa-check text-green-600 text-xl" />
          </div>
          <h2 className="font-black italic uppercase text-xl text-zinc-900 mb-2">Recebemos</h2>
          <p className="text-[13.5px] text-zinc-500 leading-relaxed mb-6">
            Seu chamado chegou e vamos responder no e-mail{' '}
            <b className="text-zinc-800">{user?.primaryEmailAddress?.emailAddress}</b>.
          </p>
          <button
            onClick={onClose}
            className="w-full rounded-2xl py-3.5 font-black uppercase text-[13px] tracking-wide text-white"
            style={{ background: 'linear-gradient(180deg,#7ab800,#5c8a06)' }}
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[340] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-5 overflow-y-auto">
      <div className="w-full sm:max-w-md bg-white rounded-t-[26px] sm:rounded-[26px] p-5 pt-4 my-auto shadow-2xl">
        <div className="w-9 h-1 rounded-full bg-zinc-200 mx-auto mb-4 sm:hidden" />

        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-green-700">Suporte</p>
            <h2 className="font-black italic text-[21px] leading-tight text-zinc-900">Fale com a gente</h2>
          </div>
          <button onClick={onClose} aria-label="Fechar"
            className="w-9 h-9 rounded-full bg-zinc-100 text-zinc-500 flex items-center justify-center active:scale-95 shrink-0">
            <i className="fas fa-times" />
          </button>
        </div>

        <p className="text-[13px] text-zinc-500 leading-snug mb-4">
          Deu erro, um número não bateu ou ficou com dúvida? Conte o que aconteceu — se puder,
          mande um print da tela.
        </p>

        <textarea
          value={mensagem}
          onChange={e => setMensagem(e.target.value)}
          rows={5}
          maxLength={4000}
          placeholder="Ex.: o total de setembro está diferente do que eu lancei..."
          className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 p-3.5 text-[14px] text-zinc-800 outline-none focus:border-green-500 focus:bg-white transition-colors resize-none"
        />

        {/* Anexo */}
        <input ref={fileRef} type="file" accept="image/*" onChange={escolherArquivo} className="hidden" />
        {print ? (
          <div className="mt-3 flex items-center gap-3 rounded-2xl border border-green-200 bg-green-50 p-2.5">
            <img src={print} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block text-[12px] font-bold text-zinc-800 truncate">{nomeArquivo}</span>
              <span className="block text-[11px] text-green-700">print anexado</span>
            </span>
            <button onClick={() => { setPrint(null); setNomeArquivo(''); if (fileRef.current) fileRef.current.value = ''; }}
              className="w-8 h-8 rounded-full bg-white text-zinc-400 flex items-center justify-center shrink-0" aria-label="Remover print">
              <i className="fas fa-times text-xs" />
            </button>
          </div>
        ) : (
          <button onClick={() => fileRef.current?.click()}
            className="mt-3 w-full rounded-2xl border border-dashed border-zinc-300 py-3 text-[13px] font-bold text-zinc-500 hover:border-green-400 hover:text-green-700 transition-colors">
            <i className="fas fa-image mr-2" />Anexar um print
          </button>
        )}

        {erro && <p className="text-[12.5px] text-red-600 mt-3 leading-snug"><i className="fas fa-circle-exclamation mr-1" />{erro}</p>}

        <button
          onClick={enviar}
          disabled={enviando || !mensagem.trim()}
          className="mt-4 w-full rounded-2xl py-3.5 font-black uppercase text-[13px] tracking-wide text-white disabled:opacity-50 transition-all active:scale-[.98]"
          style={{ background: 'linear-gradient(180deg,#7ab800,#5c8a06)' }}
        >
          {enviando ? <i className="fas fa-circle-notch animate-spin" /> : 'Enviar chamado'}
        </button>

        <p className="text-[11px] text-zinc-400 text-center mt-3 leading-snug">
          Enviamos junto a tela em que você estava e a versão do app, para acharmos o problema mais rápido.
        </p>
      </div>
    </div>
  );
};

export default Suporte;
