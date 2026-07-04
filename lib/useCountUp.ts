import { useEffect, useRef, useState } from 'react';

/**
 * Animates a number from 0 up to `target` on mount (easeOutCubic).
 * Purely visual — the caller keeps the real value; this only drives display.
 * Returns `target` immediately when the user prefers reduced motion.
 */
export function useCountUp(target: number, duration = 1600): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced || duration <= 0) {
      setValue(target);
      return;
    }

    startRef.current = null;
    const tick = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      const p = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(target * eased);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setValue(target);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}
