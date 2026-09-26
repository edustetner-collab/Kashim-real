/**
 * Gera o QUADRADO da capa dos Reels do Kashim — e só ele.
 *
 * O Eduardo monta a capa assim: print de um momento bom do vídeo → uma sombra
 * que escurece no centro e clareia nas bordas → o título por cima. O quadrado
 * verde-escuro que o Gemini desenhou entrou no lugar do título, e ele quis
 * manter exatamente esse quadrado em todos os posts, trocando só a frase.
 *
 * A imagem É o quadrado: nada de margem transparente em volta. A sombra e a
 * foto entram depois, no editor dele — e uma margem aqui só atrapalharia o
 * encaixe (2026-09-26).
 *
 * Uso:
 *   node scripts/capa-kashim.mjs "GASTO/PESSOAL/E LAZER" saida.png
 *   node scripts/capa-kashim.mjs "CONTAS FIXAS!/PREENCHA/CORRETAMENTE" c.png --fonte archivo
 *
 * A barra `/` separa as linhas — quem decide onde quebra é você, nunca o
 * navegador. A PRIMEIRA linha sai branca, as demais em verde: é o contraste
 * do desenho original, e é ele que faz a frase ser lida em dois tempos.
 *
 * SEM ícone de propósito: emoji de sistema fica com cara de padrão, longe das
 * ilustrações que o Gemini faz. Se quiser um ícone, cole o dele por cima.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

const LADO = 1080;
/** Respiro mínimo: o texto tem de TOMAR o quadrado, é o que o torna chamativo. */
const PAD_X = 34, PAD_Y = 40;
const VERDE = '#b7f03f';
const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];

/** Fontes de cartaz: pesadas e estreitas, que é o que enche a linha. */
const FONTES = {
  anton:   { css: 'Anton:wght@400',          familia: 'Anton',          peso: 400, espaco: '-.01em' },
  archivo: { css: 'Archivo+Black:wght@400',  familia: '"Archivo Black"', peso: 400, espaco: '-.025em' },
  montserrat: { css: 'Montserrat:wght@900',  familia: 'Montserrat',     peso: 900, espaco: '-.03em' },
};

const [, , fraseCrua, saidaArg, ...resto] = process.argv;
if (!fraseCrua) {
  console.error('uso: node scripts/capa-kashim.mjs "LINHA 1/LINHA 2" saida.png [--fonte anton|archivo|montserrat]');
  process.exit(1);
}
const saida = resolve(saidaArg ?? 'capa.png');
const iF = resto.indexOf('--fonte');
const fonte = FONTES[(iF >= 0 ? resto[iF + 1] : 'anton')] ?? FONTES.anton;
const linhas = fraseCrua.split('/').map((l) => l.trim().toUpperCase()).filter(Boolean);

const html = `<!doctype html>
<html lang="pt-br"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=${fonte.css}&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${LADO}px; height: ${LADO}px; background: transparent; }

  /* A imagem É o quadrado. O único transparente é o canto arredondado. */
  .cartao {
    width: ${LADO}px; height: ${LADO}px;
    border-radius: 96px;
    background:
      /* esfumaçado neon: duas camadas, uma larga e uma fechada, que é o que
         dá a profundidade do desenho original */
      radial-gradient(58% 40% at 50% 48%, rgba(170, 245, 60, .30) 0%, rgba(40, 90, 10, .10) 55%, rgba(10, 22, 4, 0) 78%),
      radial-gradient(92% 70% at 50% 45%, rgba(120, 200, 35, .18) 0%, rgba(10, 22, 4, 0) 72%),
      linear-gradient(158deg, #10200a 0%, #0a1305 56%, #060c03 100%);
    display: grid; place-items: center;
    padding: ${PAD_Y}px ${PAD_X}px;
    position: relative; overflow: hidden;
  }

  .texto {
    position: relative; z-index: 1;
    text-align: center;
    font-family: ${fonte.familia}, system-ui, sans-serif;
    font-weight: ${fonte.peso};
    line-height: .92;
    letter-spacing: ${fonte.espaco};
    text-transform: uppercase;
    font-size: 300px; /* ponto de partida; o ajuste mede e corrige */
  }
  .l   { display: block; white-space: nowrap; color: ${VERDE}; }
  .l:first-child { color: #fff; }
</style></head>
<body>
  <div class="cartao">
    <div class="texto">
      ${linhas.map((l) => `<span class="l">${l}</span>`).join('\n      ')}
    </div>
  </div>
<script>
/*
 * O NAVEGADOR mede; eu não chuto.
 *
 * Uma versão anterior calculava o tamanho por largura média de caractere e
 * errou para os dois lados — texto pequeno num quadrado vazio, depois texto
 * vazando para fora. Medir o bloco pronto e encolher até caber acerta sempre,
 * com qualquer frase e qualquer fonte.
 */
(function () {
  var LIM_X = ${LADO - PAD_X * 2}, LIM_Y = ${LADO - PAD_Y * 2};
  function ajustar() {
    var t = document.querySelector('.texto');
    var tam = 300;
    t.style.fontSize = tam + 'px';
    while (tam > 28 && (t.scrollWidth > LIM_X || t.scrollHeight > LIM_Y)) {
      tam -= 2;
      t.style.fontSize = tam + 'px';
    }
    document.documentElement.setAttribute('data-tamanho', String(tam));
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(ajustar);
  else window.addEventListener('load', ajustar);
})();
</script>
</body></html>`;

const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) { console.error('Chrome não encontrado.'); process.exit(1); }

const trabalho = join(tmpdir(), `capa-kashim-${Date.now()}`);
mkdirSync(trabalho, { recursive: true });
const arquivoHtml = join(trabalho, 'capa.html');
writeFileSync(arquivoHtml, html, 'utf8');

execFileSync(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  // É esta linha que deixa o canto arredondado transparente.
  '--default-background-color=00000000',
  `--window-size=${LADO},${LADO}`,
  `--screenshot=${join(trabalho, 'capa.png')}`,
  // A fonte vem do Google Fonts e o ajuste roda depois dela: sem esta espera,
  // o Chrome fotografa antes e o texto sai na fonte e no tamanho errados.
  '--virtual-time-budget=8000',
  `file:///${arquivoHtml.replace(/\\/g, '/')}`,
], { stdio: 'pipe' });

mkdirSync(dirname(saida), { recursive: true });
renameSync(join(trabalho, 'capa.png'), saida);
rmSync(trabalho, { recursive: true, force: true });
console.log(`✓ ${saida}  (${LADO}×${LADO}, só o quadrado, fonte ${fonte.familia})`);
console.log(`  linhas: ${linhas.join(' | ')}`);
