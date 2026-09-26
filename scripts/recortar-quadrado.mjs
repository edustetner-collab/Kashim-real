/**
 * Recorta uma arte deixando SÓ o quadrado — e devolve PNG com canto vazado.
 *
 * O Gemini entrega a arte com uma borda em volta do quadrado. Na hora de
 * montar a capa isso atrapalha: o Eduardo quer encostar o quadrado onde ele
 * decidir, e uma margem invisível empurra tudo (2026-09-26).
 *
 * Como acha o quadrado: varre a imagem procurando o primeiro e o último pixel
 * ESCURO de cada eixo. O cartão do Kashim é verde quase preto e a borda é
 * clara — seja branca, seja o xadrez que os editores desenham no lugar do
 * transparente. É isso que separa um do outro.
 *
 * Uso:
 *   node scripts/recortar-quadrado.mjs entrada.jpg saida.png
 *   node scripts/recortar-quadrado.mjs entrada.png saida.png --raio 72
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];
/** Abaixo disto é cartão; acima é borda. O cartão é bem escuro, a borda é clara. */
const LIMITE_ESCURO = 120;

const [, , entradaArg, saidaArg, ...resto] = process.argv;
if (!entradaArg) {
  console.error('uso: node scripts/recortar-quadrado.mjs entrada.jpg saida.png [--raio 88]');
  process.exit(1);
}
const entrada = resolve(entradaArg);
const saida = resolve(saidaArg ?? entrada.replace(/\.[^.]+$/, '-recortado.png'));
const iR = resto.indexOf('--raio');
const raio = iR >= 0 ? Number(resto[iR + 1]) : null; // null = proporcional

if (!existsSync(entrada)) { console.error(`não achei: ${entrada}`); process.exit(1); }
const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) { console.error('Chrome não encontrado.'); process.exit(1); }

const trabalho = join(tmpdir(), `recorte-${Date.now()}`);
mkdirSync(trabalho, { recursive: true });
const urlEntrada = `file:///${entrada.replace(/\\/g, '/')}`;

// ── Passo 1: descobrir onde o quadrado começa e termina ─────────────────────
const medir = `<!doctype html><html><body><div id="r">erro</div><script>
var img = new Image();
img.onload = function () {
  var c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  var x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  var d = x.getImageData(0, 0, c.width, c.height).data;
  var x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (var y = 0; y < c.height; y++) {
    for (var xx = 0; xx < c.width; xx++) {
      var i = (y * c.width + xx) * 4;
      // pixel transparente tambem e borda
      if (d[i + 3] < 40) continue;
      var lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (lum < ${LIMITE_ESCURO}) {
        if (xx < x0) x0 = xx; if (xx > x1) x1 = xx;
        if (y < y0) y0 = y;  if (y > y1) y1 = y;
      }
    }
  }
  document.getElementById('r').textContent =
    (x1 < 0) ? 'nada' : [x0, y0, x1 - x0 + 1, y1 - y0 + 1, c.width, c.height].join(',');
};
img.onerror = function () { document.getElementById('r').textContent = 'falhou'; };
img.src = ${JSON.stringify(urlEntrada)};
</script></body></html>`;
const htmlMedir = join(trabalho, 'medir.html');
writeFileSync(htmlMedir, medir, 'utf8');

const dom = execFileSync(chrome, [
  '--headless=new', '--disable-gpu', '--allow-file-access-from-files',
  '--virtual-time-budget=8000', '--dump-dom',
  `file:///${htmlMedir.replace(/\\/g, '/')}`,
], { encoding: 'utf8' });

const achado = /<div id="r">([^<]*)<\/div>/.exec(dom)?.[1] ?? '';
if (!/^\d+,/.test(achado)) {
  console.error(`não consegui medir a imagem (resposta: "${achado}")`);
  rmSync(trabalho, { recursive: true, force: true });
  process.exit(1);
}
const [cx, cy, cw, ch, origW, origH] = achado.split(',').map(Number);
const raioFinal = raio ?? Math.round(Math.min(cw, ch) * 0.085);

// ── Passo 2: mostrar só aquele pedaço, com o canto vazado ───────────────────
const cortar = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; }
  html, body { width:${cw}px; height:${ch}px; background:transparent; overflow:hidden; }
  .q {
    width:${cw}px; height:${ch}px;
    border-radius:${raioFinal}px;
    background-image:url("${urlEntrada}");
    background-position:-${cx}px -${cy}px;
    background-repeat:no-repeat;
  }
</style></head><body><div class="q"></div></body></html>`;
const htmlCortar = join(trabalho, 'cortar.html');
writeFileSync(htmlCortar, cortar, 'utf8');

execFileSync(chrome, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
  '--default-background-color=00000000',
  `--window-size=${cw},${ch}`,
  `--screenshot=${join(trabalho, 'out.png')}`,
  '--virtual-time-budget=8000',
  `file:///${htmlCortar.replace(/\\/g, '/')}`,
], { stdio: 'pipe' });

mkdirSync(dirname(saida), { recursive: true });
renameSync(join(trabalho, 'out.png'), saida);
rmSync(trabalho, { recursive: true, force: true });
console.log(`✓ ${saida}`);
console.log(`  original ${origW}×${origH}  →  quadrado ${cw}×${ch}  (borda cortada: ${cx}px esq, ${cy}px topo)`);
console.log(`  canto arredondado em ${raioFinal}px, vazado`);
