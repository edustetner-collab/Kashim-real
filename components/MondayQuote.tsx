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

function rr(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
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
  const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';

  // Outer background
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, S, S);

  // Card dimensions — matches the modal card look
  const PAD = 68;
  const CW = S - PAD * 2;
  const CH = S - PAD * 2;
  const CX = PAD;
  const CY = PAD;
  const CR = 56;

  // Card shadow glow
  ctx.save();
  ctx.shadowColor = 'rgba(34,197,94,0.18)';
  ctx.shadowBlur = 70;
  const cardBg = ctx.createLinearGradient(CX, CY, CX, CY + CH);
  cardBg.addColorStop(0, '#0a110a');
  cardBg.addColorStop(1, '#060d06');
  ctx.fillStyle = cardBg;
  rr(ctx, CX, CY, CW, CH, CR);
  ctx.fill();
  ctx.restore();

  // Card border
  ctx.strokeStyle = 'rgba(34,197,94,0.22)';
  ctx.lineWidth = 2;
  rr(ctx, CX, CY, CW, CH, CR);
  ctx.stroke();

  // Green top bar (clipped to card top corners)
  ctx.save();
  rr(ctx, CX, CY, CW, CH, CR);
  ctx.clip();
  const barGrad = ctx.createLinearGradient(CX, 0, CX + CW, 0);
  barGrad.addColorStop(0, '#16a34a');
  barGrad.addColorStop(0.5, '#4ade80');
  barGrad.addColorStop(1, '#16a34a');
  ctx.fillStyle = barGrad;
  ctx.fillRect(CX, CY, CW, 10);
  ctx.restore();

  // ── Content ──────────────────────────────────────────
  let y = CY + 62;

  // Kashim icon
  const iconSize = 116;
  const iconX = (S - iconSize) / 2;
  try {
    const img = await loadImg('/kashim-icon.png');
    ctx.save();
    rr(ctx, iconX, y, iconSize, iconSize, 24);
    ctx.clip();
    ctx.drawImage(img, iconX, y, iconSize, iconSize);
    ctx.restore();
  } catch {
    ctx.fillStyle = '#16a34a';
    rr(ctx, iconX, y, iconSize, iconSize, 24);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `900 68px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText('K', S / 2, y + 84);
  }
  y += iconSize + 32;

  // KASHIM
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 42px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText('K A S H I M', S / 2, y);
  y += 44;

  // Separator
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(CX + 70, y);
  ctx.lineTo(CX + CW - 70, y);
  ctx.stroke();
  y += 34;

  // Category label
  ctx.fillStyle = CATEGORY_COLOR[quote.categoria] || '#4ade80';
  ctx.font = `700 20px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText(
    `♥  ${(CATEGORY_LABEL[quote.categoria] || 'Motivação').toUpperCase()} DA SEMANA`,
    S / 2,
    y
  );
  y += 52;

  // Decorative quote mark
  ctx.fillStyle = 'rgba(34,197,94,0.13)';
  ctx.font = '900 130px Georgia, serif';
  ctx.textAlign = 'left';
  ctx.fillText('“', CX + 44, y + 10);

  // Quote text — Helvetica Neue semibold
  const fLen = quote.frase.length;
  const fontSize = fLen > 170 ? 28 : fLen > 120 ? 33 : 38;
  const lineH = Math.round(fontSize * 1.56);
  ctx.fillStyle = 'rgba(244,244,245,0.96)';
  ctx.font = `600 ${fontSize}px ${SANS}`;
  ctx.textAlign = 'center';
  const lines = wrapText(ctx, quote.frase, S / 2, y, 780, lineH);
  y += lines * lineH + 44;

  // Separator
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(CX + 70, y);
  ctx.lineTo(CX + CW - 70, y);
  ctx.stroke();
  y += 38;

  // Tagline
  ctx.fillStyle = 'rgba(161,161,170,0.72)';
  ctx.font = `400 22px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText('Organize · Invista · Evolua', S / 2, y);
  y += 32;

  // URL
  ctx.fillStyle = 'rgba(74,222,128,0.85)';
  ctx.font = `700 20px ${SANS}`;
  ctx.fillText('app.kashim.com.br', S / 2, y);

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

          {/* Share button — no icon, just text */}
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
    </div>
  );
};

export default MondayQuote;
