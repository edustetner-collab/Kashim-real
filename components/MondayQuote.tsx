import React, { useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { Quote } from '../lib/quotes';

interface MondayQuoteProps {
  quote: Quote;
  onClose: () => void;
}

const CATEGORY_LABEL: Record<Quote['categoria'], string> = {
  conforto: 'Conforto',
  exortacao: 'Motivação',
  instrucao: 'Aprendizado',
};

const CATEGORY_COLOR: Record<Quote['categoria'], string> = {
  conforto: '#60a5fa',
  exortacao: '#4ade80',
  instrucao: '#facc15',
};

const MondayQuote: React.FC<MondayQuoteProps> = ({ quote, onClose }) => {
  const captureRef = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState(false);
  const [done, setDone] = useState(false);

  const catColor = CATEGORY_COLOR[quote.categoria];
  const catLabel = CATEGORY_LABEL[quote.categoria];

  async function handleShare() {
    if (!captureRef.current) return;
    setSharing(true);
    try {
      const canvas = await html2canvas(captureRef.current, {
        scale: 3,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#050505',
        logging: false,
      });

      const blob = await new Promise<Blob | null>(res =>
        canvas.toBlob(res, 'image/png', 0.95)
      );
      if (!blob) return;

      const file = new File([blob], 'kashim-reflexao.png', { type: 'image/png' });
      const canShareFiles =
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file] });

      if (canShareFiles) {
        await navigator.share({ files: [file], title: 'Reflexão financeira da semana — Kashim' });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'kashim-reflexao.png';
        a.click();
        URL.revokeObjectURL(url);
      }
      setDone(true);
    } catch {
      // user cancelled or error
    } finally {
      setSharing(false);
    }
  }

  // Inline styles matching the modal card exactly — used for both display and capture
  const cardStyle: React.CSSProperties = {
    background: 'linear-gradient(150deg,#0a0f0a 0%,#060d06 100%)',
    border: '1px solid rgba(34,197,94,0.18)',
    borderRadius: '32px',
    overflow: 'hidden',
    width: '100%',
  };

  const innerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '32px 32px 28px',
    gap: '20px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
  };

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center p-5 bg-black/85 backdrop-blur-md"
      onClick={onClose}
    >
      {/* ── Visible modal card ── */}
      <div
        className="relative w-full max-w-sm shadow-2xl"
        style={cardStyle}
        onClick={e => e.stopPropagation()}
      >
        <div className="h-1.5 w-full" style={{ background: 'linear-gradient(90deg,#16a34a,#4ade80,#16a34a)' }} />
        <div style={innerStyle}>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <img src="/kashim-icon.png" alt="Kashim" style={{ width: '64px', height: '64px', borderRadius: '16px', boxShadow: '0 0 32px rgba(34,197,94,0.25)' }} />
            <p style={{ margin: 0, color: '#fff', fontWeight: 900, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.28em' }}>Kashim</p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: catColor, display: 'inline-block' }} />
            <span style={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', color: catColor }}>{catLabel} da semana</span>
          </div>

          <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.06)' }} />

          <div style={{ position: 'relative', width: '100%' }}>
            <span style={{ position: 'absolute', top: '-8px', left: '-8px', fontSize: '48px', fontWeight: 900, lineHeight: 1, color: 'rgba(34,197,94,0.18)', fontFamily: 'Georgia, serif', userSelect: 'none' }}>&ldquo;</span>
            <p style={{ margin: 0, paddingTop: '12px', paddingLeft: '12px', paddingRight: '12px', textAlign: 'center', fontSize: '15px', fontWeight: 600, lineHeight: 1.65, color: 'rgba(244,244,245,0.95)', letterSpacing: '-0.01em' }}>
              {quote.frase}
            </p>
          </div>

          <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.06)' }} />

          <p style={{ margin: 0, fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.3em', color: 'rgba(113,113,122,0.8)' }}>
            Organize · Invista · Evolua
          </p>

          {/* Share button — only in visible modal, not in capture */}
          <button
            onClick={handleShare}
            disabled={sharing}
            className="w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all active:scale-95 disabled:opacity-70"
            style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#000' }}
          >
            {sharing ? 'Gerando imagem...' : done ? 'Imagem gerada!' : 'Gerar card para Instagram'}
          </button>

          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-500 text-xs transition-colors">
            Fechar
          </button>
        </div>
      </div>

      {/* ── Hidden capture target — identical card but with #kashimapp instead of button ── */}
      <div
        ref={captureRef}
        style={{
          ...cardStyle,
          position: 'fixed',
          left: '-9999px',
          top: 0,
          width: '360px',
          borderRadius: '32px',
        }}
      >
        <div style={{ height: '6px', width: '100%', background: 'linear-gradient(90deg,#16a34a,#4ade80,#16a34a)' }} />
        <div style={innerStyle}>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <img src="/kashim-icon.png" alt="Kashim" crossOrigin="anonymous" style={{ width: '64px', height: '64px', borderRadius: '16px' }} />
            <p style={{ margin: 0, color: '#fff', fontWeight: 900, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.28em' }}>Kashim</p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: catColor, display: 'inline-block' }} />
            <span style={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', color: catColor }}>{catLabel} da semana</span>
          </div>

          <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.06)' }} />

          <div style={{ position: 'relative', width: '100%' }}>
            <span style={{ position: 'absolute', top: '-8px', left: '-8px', fontSize: '48px', fontWeight: 900, lineHeight: 1, color: 'rgba(34,197,94,0.18)', fontFamily: 'Georgia, serif' }}>&ldquo;</span>
            <p style={{ margin: 0, paddingTop: '12px', paddingLeft: '12px', paddingRight: '12px', textAlign: 'center', fontSize: '15px', fontWeight: 600, lineHeight: 1.65, color: 'rgba(244,244,245,0.95)', letterSpacing: '-0.01em' }}>
              {quote.frase}
            </p>
          </div>

          <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.06)' }} />

          <p style={{ margin: 0, fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.3em', color: 'rgba(113,113,122,0.8)' }}>
            Organize · Invista · Evolua
          </p>

          {/* Hashtag replaces the button in the shared image */}
          <p style={{ margin: 0, fontSize: '18px', fontWeight: 900, color: '#22c55e', letterSpacing: '0.04em' }}>
            #kashimapp
          </p>

        </div>
      </div>
    </div>
  );
};

export default MondayQuote;
