import React from 'react';
import { useCountUp } from '../lib/useCountUp';

interface ScoreRingProps {
  score: number;
  max?: number;
  size?: number;
}

/**
 * Decorative SVG progress ring for the financial score. The number counts up
 * in the center and the ring fills in sync. `score` is the source of truth —
 * this component only renders it.
 */
const ScoreRing: React.FC<ScoreRingProps> = ({ score, max = 1000, size = 104 }) => {
  const animated = useCountUp(score, 1700);
  const stroke = 9;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(animated / max, 1));
  const offset = circumference * (1 - pct);
  const display = Math.round(animated);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="k-glow-lime" style={{ transform: 'rotate(-90deg)' }}>
        <defs>
          <linearGradient id="k-score-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#c5f23a" />
            <stop offset="100%" stopColor="#7ab800" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#k-score-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-white text-3xl font-black k-num leading-none">{display}</span>
        <span className="text-white/30 text-[9px] k-num mt-0.5">/{max}</span>
      </div>
    </div>
  );
};

export default ScoreRing;
