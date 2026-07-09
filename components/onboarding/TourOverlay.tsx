// Overlay do tour interativo: máscara escura em 4 painéis ao redor do
// elemento-alvo (o "buraco" deixa o elemento 100% clicável), anel de destaque
// pulsando e card de conteúdo posicionado dinamicamente.
// Mobile (<1024px): card vira um sheet fixo na parte de baixo da tela.

import React, { useEffect, useState } from 'react';
import { Tour, TourStep } from '../../lib/onboarding/types';
import { useTourEngine, useTargetRect, TargetRect } from '../../lib/onboarding/engine';

interface TourOverlayProps {
  tour: Tour;
  initialStep?: number;
  onStepChange: (index: number) => void;
  onComplete: () => void;
  onSkip: () => void;
  // Chamado quando o usuário aceita a oferta de IA — o App leva ao Stets
  onAiPrompt: (prompt: string) => void;
}

const OVERLAY_Z = 'z-[80]';
const CARD_Z = 'z-[85]';
const CARD_WIDTH = 372;
const CARD_MARGIN = 16;
const DESKTOP_BREAKPOINT = 1024;

// Posição do card no desktop: abaixo do alvo se couber, senão acima; sempre
// dentro da viewport. Sem alvo → centralizado.
function computeCardStyle(rect: TargetRect | null, isDesktop: boolean): React.CSSProperties {
  if (!isDesktop) return {}; // mobile: classes fixas do sheet inferior
  if (!rect) {
    return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: CARD_WIDTH };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const estimatedCardHeight = 320;

  let left = rect.left + rect.width / 2 - CARD_WIDTH / 2;
  left = Math.max(CARD_MARGIN, Math.min(left, vw - CARD_WIDTH - CARD_MARGIN));

  const spaceBelow = vh - (rect.top + rect.height);
  if (spaceBelow >= estimatedCardHeight + CARD_MARGIN) {
    return { top: rect.top + rect.height + 12, left, width: CARD_WIDTH };
  }
  if (rect.top >= estimatedCardHeight + CARD_MARGIN) {
    return { top: rect.top - estimatedCardHeight - 12, left, width: CARD_WIDTH };
  }
  // Alvo ocupa a tela toda — canto superior direito (regra do prompt: 32px)
  return { top: 32, right: 32, width: CARD_WIDTH };
}

interface SpotlightProps {
  rect: TargetRect | null;
}

// 4 painéis escuros ao redor do buraco — o alvo continua clicável.
const Spotlight: React.FC<SpotlightProps> = ({ rect }) => {
  const shade = 'fixed bg-black/70 transition-all duration-300';
  if (!rect) {
    return <div className={`${shade} inset-0 ${OVERLAY_Z}`} />;
  }
  const bottom = rect.top + rect.height;
  const right = rect.left + rect.width;
  return (
    <>
      <div className={`${shade} ${OVERLAY_Z}`} style={{ top: 0, left: 0, right: 0, height: Math.max(rect.top, 0) }} />
      <div className={`${shade} ${OVERLAY_Z}`} style={{ top: bottom, left: 0, right: 0, bottom: 0 }} />
      <div className={`${shade} ${OVERLAY_Z}`} style={{ top: rect.top, left: 0, width: Math.max(rect.left, 0), height: rect.height }} />
      <div className={`${shade} ${OVERLAY_Z}`} style={{ top: rect.top, left: right, right: 0, height: rect.height }} />
      {/* Anel de destaque pulsando — decorativo, não bloqueia cliques */}
      <div
        className={`fixed ${OVERLAY_Z} pointer-events-none rounded-2xl border-2 border-[#a8e716] transition-all duration-300`}
        style={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          boxShadow: '0 0 0 4px rgba(168,231,22,0.25), 0 0 24px rgba(168,231,22,0.35)',
          animation: 'kashim-tour-pulse 2s ease-in-out infinite',
        }}
      />
      <style>{`
        @keyframes kashim-tour-pulse {
          0%, 100% { box-shadow: 0 0 0 4px rgba(168,231,22,0.25), 0 0 24px rgba(168,231,22,0.35); }
          50% { box-shadow: 0 0 0 8px rgba(168,231,22,0.12), 0 0 32px rgba(168,231,22,0.5); }
        }
      `}</style>
    </>
  );
};

interface StepCardProps {
  step: TourStep;
  stepIndex: number;
  totalSteps: number;
  isFirst: boolean;
  isLast: boolean;
  style: React.CSSProperties;
  isDesktop: boolean;
  mobileOnTop: boolean;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
  onAiAccept: (prompt: string) => void;
}

const StepCard: React.FC<StepCardProps> = ({
  step, stepIndex, totalSteps, isFirst, isLast, style, isDesktop, mobileOnTop,
  onPrev, onNext, onSkip, onAiAccept,
}) => {
  // Mobile: card fixo embaixo — mas sobe para o topo quando o alvo está na
  // parte de baixo da tela (ex.: bottom bar), para não cobrir o destaque
  const positionClasses = isDesktop
    ? 'fixed'
    : mobileOnTop
      ? 'fixed left-3 right-3 top-3 safe-top'
      : 'fixed left-3 right-3 bottom-3 safe-bottom';

  return (
    <div
      className={`${positionClasses} ${CARD_Z} bg-zinc-900 border border-zinc-800 rounded-3xl p-5 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300`}
      style={style}
    >
      {/* Progresso */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500">
          Etapa {stepIndex + 1} de {totalSteps}
        </span>
        <button
          onClick={onSkip}
          className="text-zinc-500 hover:text-white text-[9px] font-bold uppercase tracking-[0.2em] transition-colors px-2 py-1"
        >
          Pular tour
        </button>
      </div>
      <div className="w-full h-1 bg-zinc-800 rounded-full mb-4 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${((stepIndex + 1) / totalSteps) * 100}%`,
            background: 'linear-gradient(90deg, #c5f23a, #8cc400)',
          }}
        />
      </div>

      {/* Conteúdo */}
      <div className="flex items-start gap-3 mb-3">
        {step.icon && (
          <div className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center bg-green-400/10 border border-green-400/20">
            <i className={`fas ${step.icon} text-green-400 text-base`} />
          </div>
        )}
        <h3 className="text-white text-lg font-black italic uppercase tracking-tighter leading-tight pt-1">
          {step.title}
        </h3>
      </div>
      <p className="text-zinc-400 text-sm leading-relaxed mb-3">{step.body}</p>

      {step.demoAction && (
        <div className="flex items-start gap-2 bg-zinc-800/70 border border-zinc-700 rounded-xl px-3 py-2.5 mb-3">
          <i className="fas fa-hand-pointer text-[#a8e716] text-xs mt-0.5" />
          <p className="text-zinc-300 text-xs leading-snug">{step.demoAction}</p>
        </div>
      )}

      {step.aiOffer && (
        <button
          onClick={() => onAiAccept(step.aiOffer!.prompt)}
          className="w-full flex items-center justify-center gap-2 bg-green-400/10 border border-green-400/30 text-green-400 font-black py-3 rounded-2xl text-[11px] uppercase tracking-widest mb-3 active:scale-95 transition-all"
        >
          <i className="fas fa-wand-magic-sparkles text-xs" />
          {step.aiOffer.label}
        </button>
      )}

      {/* Navegação */}
      <div className="flex items-center gap-2">
        <button
          onClick={onPrev}
          disabled={isFirst}
          className="w-12 h-12 shrink-0 rounded-2xl bg-zinc-800 text-zinc-400 disabled:opacity-30 active:scale-95 transition-all"
          aria-label="Etapa anterior"
        >
          <i className="fas fa-arrow-left text-sm" />
        </button>
        <button
          onClick={onNext}
          className="flex-1 text-black font-black py-3.5 rounded-2xl text-xs uppercase tracking-widest active:scale-95 transition-all shadow-lg"
          style={{ background: 'linear-gradient(90deg, #c5f23a, #8cc400)' }}
        >
          {isLast ? 'Concluir' : 'Próximo'}
          {!isLast && <i className="fas fa-arrow-right text-[10px] ml-2" />}
        </button>
      </div>
    </div>
  );
};

const TourOverlay: React.FC<TourOverlayProps> = ({
  tour, initialStep = 0, onStepChange, onComplete, onSkip, onAiPrompt,
}) => {
  const engine = useTourEngine(tour, { initialStep, onStepChange, onComplete });
  const rect = useTargetRect(engine.step?.targetId);
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= DESKTOP_BREAKPOINT);

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT);
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!engine.step) return null;

  // Passo com alvo ainda não encontrado: mostra só a máscara cheia até o
  // useTargetRect achar o elemento (ou desistir → card centralizado)
  const effectiveRect = engine.step.targetId ? rect : null;
  // Mobile: o card vai SEMPRE para o lado com mais espaço livre, para nunca
  // cobrir o elemento destacado (ex.: etapas dentro do lançador, que ficam
  // no meio/baixo da tela → card sobe para o topo)
  const mobileOnTop = (() => {
    if (!effectiveRect) return false;
    const spaceAbove = effectiveRect.top;
    const spaceBelow = window.innerHeight - (effectiveRect.top + effectiveRect.height);
    return spaceAbove > spaceBelow;
  })();

  return (
    <>
      <Spotlight rect={effectiveRect} />
      <StepCard
        step={engine.step}
        stepIndex={engine.stepIndex}
        totalSteps={engine.totalSteps}
        isFirst={engine.isFirst}
        isLast={engine.isLast}
        style={computeCardStyle(effectiveRect, isDesktop)}
        isDesktop={isDesktop}
        mobileOnTop={mobileOnTop}
        onPrev={engine.prev}
        onNext={engine.next}
        onSkip={onSkip}
        onAiAccept={onAiPrompt}
      />
    </>
  );
};

export default TourOverlay;
