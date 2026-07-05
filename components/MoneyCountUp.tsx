import React, { useEffect, useRef, useState } from 'react';
import { formatCurrency } from '../constants';

interface MoneyCountUpProps {
  value: number;
  className?: string;
  duration?: number;
}

/**
 * Renders a currency value that counts up from 0 to `value` once, on mount.
 * After the intro finishes it tracks the live `value` directly (so month
 * navigation updates instantly without re-animating). Purely presentational —
 * `value` remains the source of truth. Skips the animation under reduced motion.
 */
const MoneyCountUp: React.FC<MoneyCountUpProps> = ({ value, className, duration = 1100 }) => {
  const prefersReduced =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // null → follow the live value; number → show this intro-tween value
  const [display, setDisplay] = useState<number | null>(prefersReduced ? null : 0);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (prefersReduced || duration <= 0) return;
    const target = value; // captured once, at mount
    const tick = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const p = Math.min((now - startRef.current) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      if (p < 1) {
        setDisplay(target * eased);
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(null); // hand off to live value
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // Intentionally mount-only: the intro plays once, then live value takes over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = display === null ? value : display;
  return <span className={className}>{formatCurrency(shown)}</span>;
};

export default MoneyCountUp;
