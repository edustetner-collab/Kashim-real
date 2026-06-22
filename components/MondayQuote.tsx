import React, { useState } from 'react';
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

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src + '?t=' + Date.now();
  });
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineH: number
): number {
  const words = text.split(' ');
  let line = '';
  let count = 0;
  for (const word of words) {
    const test = line + word + ' ';
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line.trim(), x, y + count * lineH);
      line = word + ' ';
      count++;
    } else {
      line = test;
    }
  }
  ctx.fillText(line.trim(), x, y + count * lineH);
  return count + 1;
}

async function generateCard(quote: Quote): Promise<Blob> {
  const S = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;

  // Dark background
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, S, S);

  // Subtle green glow
  const glow = ctx.createRadialGradient(S / 2, 380, 0, S / 2, 380, 600);
  glow.addColorStop(0, 'rgba(34,197,94,0.09)');
  glow.addColorStop(1, 'rgba(5,5,5,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, S, S);

  // Top gradient bar
  const bar = ctx.createLinearGradient(0, 0, S, 0);
  bar.addColorStop(0, '#16a34a');
  bar.addColorStop(0.5, '#4ade80');
  bar.addColorStop(1, '#16a34a');
  ctx.fillStyle = bar;
  ctx.fillRect(0, 0, S, 10);

  // Kashim icon
  const iconSize = 128;
  const iconX = (S - iconSize) / 2;
  const iconY = 72;
  try {
    const img = await loadImg('/kashim-icon.png');
    ctx.save();
    ctx.beginPath();
    const r = 28;
    ctx.moveTo(iconX + r, iconY);
    ctx.lineTo(iconX + iconSize - r, iconY);
    ctx.arcTo(iconX + iconSize, iconY, iconX + iconSize, iconY + r, r);
    ctx.lineTo(iconX + iconSize, iconY + iconSize - r);
    ctx.arcTo(iconX + iconSize, iconY + iconSize, iconX + iconSize - r, iconY + iconSize, r);
    ctx.lineTo(iconX + r, iconY + iconSize);
    ctx.arcTo(iconX, iconY + iconSize, iconX, iconY + iconSize - r, r);
    ctx.lineTo(iconX, iconY + r);
    ctx.arcTo(iconX, iconY, iconX + r, iconY, r);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, iconX, iconY, iconSize, iconSize);
    ctx.restore();
  } catch {
    // Fallback: green square with K
    ctx.fillStyle = '#16a34a';
    ctx.beginPath();
    ctx.roundRect(iconX, iconY, iconSize, iconSize, 28);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '900 72px -apple-system, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('K', S / 2, iconY + 92);
  }

  // KASHIM title
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 46px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('K A S H I M', S / 2, iconY + iconSize + 56);

  // Thin separator
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(130, iconY + iconSize + 80);
  ctx.lineTo(S - 130, iconY + iconSize + 80);
  ctx.stroke();

  // Category label
  ctx.fillStyle = CATEGORY_COLOR[quote.categoria] || '#4ade80';
  ctx.font = '700 22px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    `♥  ${(CATEGORY_LABEL[quote.categoria] || 'Motivação').toUpperCase()} DA SEMANA`,
    S / 2,
    iconY + iconSize + 130
  );

  // Decorative opening quote
  ctx.fillStyle = 'rgba(34,197,94,0.14)';
  ctx.font = '900 160px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'left';
  ctx.fillText('“', 68, iconY + iconSize + 256);

  // Quote text
  const fLen = quote.frase.length;
  const fontSize = fLen > 170 ? 30 : fLen > 120 ? 36 : 42;
  const lineH = Math.round(fontSize * 1.52);
  ctx.fillStyle = '#f0f0f2';
  ctx.font = `500 ${fontSize}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = 'center';
  const quoteY = iconY + iconSize + 270;
  const lines = wrapText(ctx, quote.frase, S / 2, quoteY, 830, lineH);

  // Bottom separator
  const divY = quoteY + lines * lineH + 56;
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(130, divY);
  ctx.lineTo(S - 130, divY);
  ctx.stroke();

  // Tagline
  ctx.fillStyle = 'rgba(161,161,170,0.75)';
  ctx.font = '400 24px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Organize · Invista · Evolua', S / 2, divY + 50);

  // URL
  ctx.fillStyle = 'rgba(74,222,128,0.80)';
  ctx.font = '700 21px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif';
  ctx.fillText('app.kashim.com.br', S / 2, divY + 88);

  return new Promise<Blob>((res, rej) =>
    canvas.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png', 0.95)
  );
}

const MondayQuote: React.FC<MondayQuoteProps> = ({ quote, onClose }) => {
  const [sharing, setSharing] = useState(false);
  const [done, setDone] = useState(false);

  async function handleShare() {
    setSharing(true);
    try {
      const blob = await generateCard(quote);
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
      // user cancelled or error — silently ignore
    } finally {
      setSharing(false);
    }
  }

  const catColor = CATEGORY_COLOR[quote.categoria];
  const catLabel = CATEGORY_LABEL[quote.categoria];

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center p-5 bg-black/85 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-[32px] overflow-hidden shadow-2xl"
        style={{ background: 'linear-gradient(150deg,#0a0f0a 0%,#060d06 100%)', border: '1px solid rgba(34,197,94,0.18)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Top accent bar */}
        <div className="h-1.5 w-full" style={{ background: 'linear-gradient(90deg,#16a34a,#4ade80,#16a34a)' }} />

        <div className="flex flex-col items-center px-8 pt-8 pb-7 gap-5">

          {/* Icon + name */}
          <div className="flex flex-col items-center gap-2">
            <img src="/kashim-icon.png" alt="Kashim" className="w-16 h-16 rounded-2xl shadow-xl" style={{ boxShadow: '0 0 32px rgba(34,197,94,0.25)' }} />
            <p className="text-white font-black text-sm uppercase tracking-[0.28em]">Kashim</p>
          </div>

          {/* Category */}
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: catColor }} />
            <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: catColor }}>
              {catLabel} da semana
            </span>
          </div>

          {/* Divider */}
          <div className="w-full h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />

          {/* Quote */}
          <div className="relative w-full">
            <span className="absolute -top-2 -left-2 text-5xl font-black leading-none select-none" style={{ color: 'rgba(34,197,94,0.18)', fontFamily: 'Georgia, serif' }}>&ldquo;</span>
            <p className="text-center px-3 pt-3" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif', fontSize: '15px', fontWeight: 600, lineHeight: '1.65', color: 'rgba(244,244,245,0.95)', letterSpacing: '-0.01em' }}>
              {quote.frase}
            </p>
          </div>

          {/* Divider */}
          <div className="w-full h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />

          {/* Footer brand */}
          <p className="text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: 'rgba(113,113,122,0.8)' }}>
            Organize · Invista · Evolua
          </p>

          {/* Share button */}
          <button
            onClick={handleShare}
            disabled={sharing}
            className="w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-70"
            style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#000' }}
          >
            {sharing ? (
              <><i className="fas fa-circle-notch animate-spin" /> Gerando imagem...</>
            ) : done ? (
              <><i className="fas fa-check" /> Imagem gerada!</>
            ) : (
              <><i className="fas fa-image" /> Gerar card para Instagram</>
            )}
          </button>

          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-500 text-xs transition-colors">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};

export default MondayQuote;
