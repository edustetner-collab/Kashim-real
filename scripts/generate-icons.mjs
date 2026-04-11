// Gera ícones PWA usando canvas
// Run: node scripts/generate-icons.mjs

import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Fundo preto
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, size, size);

  // Círculo dourado
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.42;
  const grad = ctx.createRadialGradient(cx, cy - r * 0.2, r * 0.1, cx, cy, r);
  grad.addColorStop(0, '#fde68a');
  grad.addColorStop(1, '#b45309');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Letra R
  ctx.fillStyle = '#050505';
  ctx.font = `900 ${size * 0.52}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('R', cx, cy + size * 0.03);

  return canvas.toBuffer('image/png');
}

try {
  writeFileSync(join(publicDir, 'icon-192.png'), drawIcon(192));
  writeFileSync(join(publicDir, 'icon-512.png'), drawIcon(512));
  console.log('Icons generated!');
} catch (e) {
  console.error('canvas module not available, skipping icon generation:', e.message);
}
