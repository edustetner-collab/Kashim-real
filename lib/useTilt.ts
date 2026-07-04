import { useCallback, useRef } from 'react';

interface TiltHandlers {
  ref: React.RefObject<HTMLDivElement>;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerLeave: () => void;
}

/**
 * Subtle 3D tilt that follows the pointer, plus two CSS vars (--k-gx/--k-gy)
 * marking the pointer position so a decorative glow can track it.
 * Writes transform imperatively (no re-render). No-op under reduced motion.
 *
 * Only attach this to elements that do NOT contain position:fixed descendants —
 * the persistent transform would become their containing block.
 */
export function useTilt(maxDeg = 8): TiltHandlers {
  const ref = useRef<HTMLDivElement>(null);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const rx = (0.5 - py) * maxDeg * 2;
    const ry = (px - 0.5) * maxDeg * 2;
    el.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    el.style.setProperty('--k-gx', `${(px * 100).toFixed(1)}%`);
    el.style.setProperty('--k-gy', `${(py * 100).toFixed(1)}%`);
  }, [maxDeg]);

  const onPointerLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = '';
  }, []);

  return { ref, onPointerMove, onPointerLeave };
}
