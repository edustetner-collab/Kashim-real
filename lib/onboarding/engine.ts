// Motor do tour: filtragem de passos por plataforma/viewport, navegação
// (avançar/voltar/pular) e rastreamento da posição do elemento-alvo na tela
// (spotlight acompanha scroll, resize e mudanças de layout).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tour, TourStep } from './types';
import { isNativeApp } from './platform';

const DESKTOP_BREAKPOINT = 1024; // lg do Tailwind — elementos hidden lg:block

export function filterSteps(steps: TourStep[]): TourStep[] {
  const isDesktop = window.innerWidth >= DESKTOP_BREAKPOINT;
  return steps.filter(step => {
    const platform = step.platform ?? 'all';
    if (platform === 'web' && isNativeApp) return false;
    if (platform === 'native' && !isNativeApp) return false;
    if (step.desktopOnly && !isDesktop) return false;
    if (step.mobileOnly && isDesktop) return false;
    return true;
  });
}

export interface TourEngine {
  step: TourStep | null;
  stepIndex: number;
  totalSteps: number;
  isFirst: boolean;
  isLast: boolean;
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
}

interface UseTourEngineOptions {
  initialStep?: number;
  onStepChange?: (index: number) => void;
  onComplete: () => void;
}

export function useTourEngine(tour: Tour, options: UseTourEngineOptions): TourEngine {
  const { initialStep = 0, onStepChange, onComplete } = options;
  // Passos filtrados uma vez por execução do tour (plataforma não muda em runtime)
  const steps = useMemo(() => filterSteps(tour.steps), [tour]);
  const [stepIndex, setStepIndex] = useState(() =>
    Math.min(Math.max(initialStep, 0), Math.max(steps.length - 1, 0))
  );

  const goTo = useCallback(
    (index: number) => {
      if (index >= steps.length) {
        onComplete();
        return;
      }
      const clamped = Math.max(index, 0);
      setStepIndex(clamped);
      onStepChange?.(clamped);
    },
    [steps.length, onComplete, onStepChange]
  );

  const next = useCallback(() => goTo(stepIndex + 1), [goTo, stepIndex]);
  const prev = useCallback(() => goTo(stepIndex - 1), [goTo, stepIndex]);

  return {
    step: steps[stepIndex] ?? null,
    stepIndex,
    totalSteps: steps.length,
    isFirst: stepIndex === 0,
    isLast: stepIndex === steps.length - 1,
    next,
    prev,
    goTo,
  };
}

// ─── Rastreamento do elemento-alvo ───────────────────────────────────────────

export interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

// Margem de respiro do spotlight ao redor do elemento
const SPOTLIGHT_PADDING = 8;

function isVisible(el: Element): boolean {
  const h = el as HTMLElement;
  return h.offsetWidth > 0 && h.offsetHeight > 0;
}

// Procura o alvo por id e, se não achar (ou estiver invisível), por
// [data-tour="..."] — útil para elementos repetidos (ex.: botão de replicar),
// onde destacamos a primeira instância visível.
function findTargetElement(targetId: string): Element | null {
  const byId = document.getElementById(targetId);
  if (byId && isVisible(byId)) return byId;
  const candidates = document.querySelectorAll(`[data-tour="${targetId}"]`);
  for (const el of candidates) {
    if (isVisible(el)) return el;
  }
  return null;
}

function readRect(el: Element): TargetRect {
  const r = el.getBoundingClientRect();
  return {
    top: r.top - SPOTLIGHT_PADDING,
    left: r.left - SPOTLIGHT_PADDING,
    width: r.width + SPOTLIGHT_PADDING * 2,
    height: r.height + SPOTLIGHT_PADDING * 2,
  };
}

function rectsDiffer(a: TargetRect | null, b: TargetRect): boolean {
  if (!a) return true;
  return (
    Math.abs(a.top - b.top) > 0.5 ||
    Math.abs(a.left - b.left) > 0.5 ||
    Math.abs(a.width - b.width) > 0.5 ||
    Math.abs(a.height - b.height) > 0.5
  );
}

// Segue o elemento `targetId` na tela. Retorna null enquanto não encontrado
// (ou se o passo não tem alvo — card centralizado). Reage a scroll, resize e
// mutações do DOM — alvos podem aparecer/sumir depois (modais, sheets, abas).
// Performance: tudo passa por um único rAF-throttle; nada roda em loop.
export function useTargetRect(targetId: string | undefined): TargetRect | null {
  const [rect, setRect] = useState<TargetRect | null>(null);
  const rectRef = useRef<TargetRect | null>(null);

  useEffect(() => {
    rectRef.current = null;
    setRect(null);
    if (!targetId) return;

    let el: Element | null = null;
    let rafId = 0;
    let cancelled = false;
    const resizeObserver = new ResizeObserver(() => scheduleUpdate());

    const publish = (next: TargetRect | null) => {
      if (next === null ? rectRef.current !== null : rectsDiffer(rectRef.current, next)) {
        rectRef.current = next;
        setRect(next);
      }
    };

    const update = () => {
      rafId = 0;
      if (cancelled) return;
      // Alvo sumiu (ex.: sheet trocou de etapa) ou ainda não existe → re-busca
      if (!el || !el.isConnected) {
        const found = findTargetElement(targetId);
        if (found !== el) {
          resizeObserver.disconnect();
          el = found;
          if (el) {
            resizeObserver.observe(el);
            // Traz o alvo novo para a área visível e re-mede após o scroll
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            window.setTimeout(scheduleUpdate, 350);
            window.setTimeout(scheduleUpdate, 700);
          }
        }
      }
      publish(el ? readRect(el) : null);
    };

    const scheduleUpdate = () => {
      if (!rafId && !cancelled) rafId = requestAnimationFrame(update);
    };

    window.addEventListener('scroll', scheduleUpdate, { capture: true, passive: true });
    window.addEventListener('resize', scheduleUpdate, { passive: true });
    // Detecta o alvo aparecendo/sumindo (modais, troca de etapa em sheets)
    const mutationObserver = new MutationObserver(scheduleUpdate);
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    scheduleUpdate();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', scheduleUpdate, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', scheduleUpdate);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [targetId]);

  return rect;
}
