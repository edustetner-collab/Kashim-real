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
// Elemento pode renderizar depois do passo abrir (aba trocando, lazy render)
const FIND_RETRY_MS = 150;
const FIND_MAX_RETRIES = 20; // ~3s antes de desistir e centralizar o card

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
// (ou se o passo não tem alvo — card centralizado).
// Performance: atualiza via rAF apenas em eventos (scroll/resize/mutação),
// sem polling contínuo.
export function useTargetRect(targetId: string | undefined): TargetRect | null {
  const [rect, setRect] = useState<TargetRect | null>(null);
  const rectRef = useRef<TargetRect | null>(null);

  useEffect(() => {
    rectRef.current = null;
    setRect(null);
    if (!targetId) return;

    let el: Element | null = null;
    let rafId = 0;
    let retryId = 0;
    let retries = 0;
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    const update = () => {
      rafId = 0;
      if (cancelled || !el || !el.isConnected) return;
      const next = readRect(el);
      if (rectsDiffer(rectRef.current, next)) {
        rectRef.current = next;
        setRect(next);
      }
    };

    const scheduleUpdate = () => {
      if (!rafId) rafId = requestAnimationFrame(update);
    };

    const attach = () => {
      el = findTargetElement(targetId);
      if (!el) {
        if (retries++ < FIND_MAX_RETRIES) {
          retryId = window.setTimeout(attach, FIND_RETRY_MS);
        }
        return;
      }
      // Traz o alvo para a área visível antes de medir
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      scheduleUpdate();
      // Reposiciona durante o smooth scroll e depois dele
      window.setTimeout(scheduleUpdate, 350);
      window.setTimeout(scheduleUpdate, 700);

      window.addEventListener('scroll', scheduleUpdate, { capture: true, passive: true });
      window.addEventListener('resize', scheduleUpdate, { passive: true });
      resizeObserver = new ResizeObserver(scheduleUpdate);
      resizeObserver.observe(el);
    };

    attach();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (retryId) clearTimeout(retryId);
      window.removeEventListener('scroll', scheduleUpdate, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', scheduleUpdate);
      resizeObserver?.disconnect();
    };
  }, [targetId]);

  return rect;
}
