import React, { useEffect, useRef, useState } from 'react';

// Pop-up "você tem X transações a categorizar" — aparece ao abrir o app quando
// há transações do Open Finance ainda pendentes. Gamificado de propósito:
// número grande, contagem animada, chamada única de ação.
//
// VISIBILIDADE: quem decide se este pop-up existe é hasOpenFinanceAccess(user)
// em App.tsx. Este componente NÃO conhece a regra — só é montado quando já foi
// liberado. Mantém o portão num lugar só (lib/ofAccess.ts).

interface CategorizePopupProps {
  count: number;
  onCategorize: () => void;
  onDismiss: () => void;
}

const CategorizePopup: React.FC<CategorizePopupProps> = ({ count, onCategorize, onDismiss }) => {
  const [shown, setShown] = useState(false);
  const [display, setDisplay] = useState(count);
  const reduce = useRef(false);

  useEffect(() => {
    reduce.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Entrada: monta invisível e sobe no próximo frame.
    const t = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(t);
  }, []);

  // Contagem animada de 0 até count.
  useEffect(() => {
    if (reduce.current) { setDisplay(count); return; }
    let raf = 0;
    const dur = 650;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(count * eased));
      if (p < 1) raf = requestAnimationFrame(step);
      else setDisplay(count);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [count]);

  const plural = count === 1 ? 'Transação esperando você' : 'Transações esperando você';

  return (
    <div
      className="fixed inset-0 z-[300] flex items-end justify-center bg-black/75 backdrop-blur-sm"
      onClick={onDismiss}
      role="dialog"
      aria-modal="true"
      aria-label={`${count} transações a categorizar`}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          transform: shown ? 'translateY(0)' : 'translateY(24px)',
          opacity: shown ? 1 : 0,
          transition: 'transform .5s cubic-bezier(.16,1,.3,1), opacity .5s cubic-bezier(.16,1,.3,1)',
        }}
        className="w-full max-w-md m-2.5 rounded-[30px] border border-white/15 bg-gradient-to-b from-zinc-800 to-zinc-900 p-6 pt-5 shadow-2xl"
      >
        <div className="w-9 h-1 rounded-full bg-white/15 mx-auto mb-5" />

        {/* Badge */}
        <div className="relative w-[74px] h-[74px] mx-auto mb-4">
          <div className="absolute inset-0 rounded-[22px] bg-green-500/25 blur-md animate-pulse" />
          <div className="absolute inset-[9px] rounded-[18px] bg-gradient-to-b from-zinc-700 to-zinc-900 border border-white/15 flex items-center justify-center text-3xl">
            🧾
          </div>
          <div className="absolute -top-1.5 -right-1.5 min-w-[24px] h-6 px-1.5 rounded-xl bg-amber-400 text-amber-950 font-black text-xs flex items-center justify-center shadow-lg">
            {count}
          </div>
        </div>

        <p className="text-center text-green-400 font-black text-[10.5px] uppercase tracking-[0.2em] mb-2">
          Bora organizar
        </p>
        <p
          className="text-center text-white font-black italic tabular-nums leading-none"
          style={{ fontSize: 96, letterSpacing: '-0.04em', textShadow: '0 0 40px rgba(34,197,94,.28)' }}
        >
          {display}
        </p>
        <h2 className="text-center text-white font-black italic uppercase text-xl leading-tight mt-2 text-balance">
          {plural}
        </h2>
        <p className="text-center text-zinc-400 text-sm leading-relaxed mt-2.5 mb-5 mx-auto max-w-[30ch]">
          Categorize essas despesas para se manter <b className="text-zinc-200 font-bold">organizado</b> e
          saber se está atingindo seus limites de gastos. É bem rápido.
        </p>

        <button
          onClick={onCategorize}
          className="w-full flex items-center justify-center gap-2 bg-gradient-to-b from-green-500 to-green-600 text-green-950 font-black uppercase text-[15px] rounded-2xl py-4 shadow-lg active:scale-[.98] transition-transform"
        >
          Categorizar agora <i className="fas fa-arrow-right text-sm" />
        </button>
        <button
          onClick={onDismiss}
          className="block w-full text-center text-zinc-500 hover:text-zinc-300 font-bold text-[13px] pt-3.5 pb-1 transition-colors"
        >
          Agora não, depois eu faço
        </button>
      </div>
    </div>
  );
};

export default CategorizePopup;
