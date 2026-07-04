const COLORS = ['#c5f23a', '#a8e716', '#7ab800', '#ffffff'];

/**
 * Fires a short lime confetti burst from the center of the viewport.
 * DOM-only and self-cleaning — holds no React state and touches no app logic.
 * No-op when the user prefers reduced motion.
 */
export function fireConfetti(count = 26): void {
  if (typeof document === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    piece.className = 'k-confetti-piece';
    const angle = Math.random() * Math.PI * 2;
    const dist = 80 + Math.random() * 180;
    const x = Math.cos(angle) * dist;
    const y = Math.sin(angle) * dist - 40; // bias upward
    piece.style.setProperty('--k-x', `${x.toFixed(0)}px`);
    piece.style.setProperty('--k-y', `${y.toFixed(0)}px`);
    piece.style.setProperty('--k-r', `${(Math.random() * 720 - 360).toFixed(0)}deg`);
    piece.style.setProperty('--k-dur', `${(900 + Math.random() * 600).toFixed(0)}ms`);
    piece.style.background = COLORS[i % COLORS.length];
    document.body.appendChild(piece);
    piece.addEventListener('animationend', () => piece.remove());
  }
}
