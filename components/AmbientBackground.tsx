import React, { useEffect, useRef } from 'react';

/**
 * Purely decorative ambient layer: soft aurora blobs (CSS) plus a slow
 * particle field (canvas). Fixed, behind all content, pointer-events: none.
 * Renders nothing animated when the user prefers reduced motion.
 *
 * This component holds no app state and touches no app logic — it is a
 * standalone visual layer mounted once at the App root.
 */

interface Particle {
  x: number;
  y: number;
  radius: number;
  speed: number;
  drift: number;
  baseAlpha: number;
  twinklePhase: number;
}

const PARTICLE_COUNT = 40;

const AmbientBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let particles: Particle[] = [];
    let frame = 0;

    const seedParticles = () => {
      particles = Array.from({ length: PARTICLE_COUNT }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: 0.8 + Math.random() * 1.8,
        speed: 0.12 + Math.random() * 0.35,
        drift: (Math.random() - 0.5) * 0.25,
        baseAlpha: 0.08 + Math.random() * 0.22,
        twinklePhase: Math.random() * Math.PI * 2,
      }));
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedParticles();
    };

    const tick = () => {
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        p.y -= p.speed;
        p.x += p.drift;
        p.twinklePhase += 0.02;
        if (p.y < -4) {
          p.y = height + 4;
          p.x = Math.random() * width;
        }
        if (p.x < -4) p.x = width + 4;
        if (p.x > width + 4) p.x = -4;
        const twinkle = 0.6 + 0.4 * Math.sin(p.twinklePhase);
        ctx.beginPath();
        ctx.fillStyle = `rgba(122, 184, 0, ${p.baseAlpha * twinkle})`;
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      frame = requestAnimationFrame(tick);
    };

    resize();
    frame = requestAnimationFrame(tick);
    window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div className="k-ambient" aria-hidden="true">
      <div className="k-aurora k-aurora--1" />
      <div className="k-aurora k-aurora--2" />
      <div className="k-aurora k-aurora--3" />
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
};

export default AmbientBackground;
