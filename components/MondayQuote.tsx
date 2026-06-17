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
  conforto: 'text-blue-400',
  exortacao: 'text-green-400',
  instrucao: 'text-yellow-400',
};

const MondayQuote: React.FC<MondayQuoteProps> = ({ quote, onClose }) => {
  const [copied, setCopied] = useState(false);

  function handleShare() {
    const text = `💚 Reflexão financeira da semana\n\n"${quote.frase}"\n\n📊 Kashim — Organize. Invista. Evolua.\napp.kashim.com.br`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => {
      // fallback for environments without clipboard API
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Top accent bar */}
        <div className="h-1 w-full bg-gradient-to-r from-green-500 via-green-400 to-green-600" />

        <div className="p-7 flex flex-col gap-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-green-400 text-base">💚</span>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Segunda-feira</p>
                <p className={`text-[10px] font-black uppercase tracking-widest ${CATEGORY_COLOR[quote.categoria]}`}>
                  {CATEGORY_LABEL[quote.categoria]} da semana
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center text-zinc-600 hover:text-zinc-400 transition-colors rounded-full hover:bg-zinc-800"
            >
              <i className="fas fa-times text-xs"></i>
            </button>
          </div>

          {/* Quote */}
          <div className="bg-zinc-800/60 rounded-2xl p-5 border border-zinc-700/50">
            <i className="fas fa-quote-left text-green-500/30 text-2xl mb-3 block"></i>
            <p className="text-white text-sm leading-relaxed font-medium">
              {quote.frase}
            </p>
          </div>

          {/* Share CTA */}
          <button
            onClick={handleShare}
            className="w-full bg-green-500 hover:bg-green-400 active:scale-95 text-black font-black py-3.5 rounded-2xl text-sm uppercase tracking-widest transition-all flex items-center justify-center gap-2"
          >
            {copied ? (
              <><i className="fas fa-check"></i> Copiado! Cole no Instagram</>
            ) : (
              <><i className="fas fa-share-alt"></i> Compartilhar no Instagram</>
            )}
          </button>

          {/* Dismiss */}
          <button
            onClick={onClose}
            className="text-zinc-600 hover:text-zinc-500 text-xs text-center transition-colors -mt-2"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};

export default MondayQuote;
