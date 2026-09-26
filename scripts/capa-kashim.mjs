/**
 * Gera o QUADRADO da capa dos Reels do Kashim — fundo transparente.
 *
 * O Eduardo monta a capa assim: print de um momento bom do vídeo → uma sombra
 * que escurece no centro e clareia nas bordas → o título por cima. O quadrado
 * verde-escuro que o Gemini desenhou entrou no lugar do título, e ele quis
 * manter exatamente esse quadrado em todos os posts, trocando só a frase.
 *
 * Por isso a saída é SÓ o quadrado, com o resto transparente: a sombra e a
 * foto entram depois, no editor dele. Gerar a capa inteira aqui tiraria dele
 * justamente a parte que ele faz melhor.
 *
 * Uso:
 *   node scripts/capa-kashim.mjs "GASTO/PESSOAL/E LAZER" saida.png
 *   node scripts/capa-kashim.mjs "COMO SAIR/DAS DÍVIDAS" d.png --emoji "💸,🔥"
 *
 * A barra `/` separa as linhas — quem decide onde quebra é você, nunca o
 * navegador. A PRIMEIRA linha sai branca, as demais em verde: é o contraste
 * do desenho original, e é ele que faz a frase ser lida em dois tempos.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

const LADO = 1080;      // a imagem inteira
const CARTAO = 820;     // o quadrado dentro dela
const PAD_X = 58, PAD_Y = 64;
const VERDE = '#b7f03f';
const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];

const [, , fraseCrua, saidaArg, ...resto] = process.argv;
if (!fraseCrua) {
  console.error('uso: node scripts/capa-kashim.mjs "LINHA 1/LINHA 2" saida.png [--emoji "🛍️,🍸"]');
  process.exit(1);
}
const saida = resolve(saidaArg ?? 'capa.png');
const iEmoji = resto.indexOf('--emoji');
const emojis = iEmoji >= 0 ? (resto[iEmoji + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean) : [];
const linhas = fraseCrua.split('/').map((l) => l.trim().toUpperCase()).filter(Boolean);

const html = `<!doctype html>
<html lang="pt-br"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@800;900&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${LADO}px; height: ${LADO}px; background: transparent; }
  body { display: grid; place-items: center; }

  /* O quadrado: quase preto com um fundo de verde, que é o que dá o tom
     Kashim sem competir com o texto. */
  .cartao {
    width: ${CARTAO}px; height: ${CARTAO}px;
    border-radius: 76px;
    background:
      radial-gradient(70% 52% at 50% 50%, rgba(150, 225, 45, .16) 0%, rgba(12, 26, 5, 0) 68%),
      linear-gradient(158deg, #0e1a07 0%, #080f04 58%, #050a03 100%);
    display: grid; place-items: center;
    padding: ${PAD_Y}px ${PAD_X}px;
    position: relative; overflow: hidden;
  }
  /* Brilho suave atrás do texto — o mesmo do desenho original. */
  .cartao::after {
    content: ''; position: absolute; inset: 0;
    background: radial-gradient(46% 30% at 50% 50%, rgba(183, 240, 63, .16) 0%, transparent 72%);
    pointer-events: none;
  }

  .texto {
    position: relative; z-index: 1;
    text-align: center;
    font-family: Montserrat, system-ui, sans-serif;
    font-weight: 900;
    line-height: .98;
    letter-spacing: -.028em;
    text-transform: uppercase;
    font-size: 180px; /* ponto de partida; o ajuste mede e corrige */
  }
  .l   { display: block; white-space: nowrap; color: ${VERDE}; }
  .l:first-child { color: #fff; }
  .emo { font-size: .72em; letter-spacing: 0; }
</style></head>
<body>
  <div class="cartao">
    <div class="texto">
      ${linhas.map((l, i) => {
        const esq = i === 0 && emojis[0] ? `<span class="emo">${emojis[0]}</span> ` : '';
        const dir = i === 0 && emojis[1] ? ` <span class="emo">${emojis[1]}</span>` : '';
        return `<span class="l">${esq}${l}${dir}</span>`;
      }).join('\n      ')}
    </div>
  </div>
<script>
/*
 * O NAVEGADOR mede; eu não chuto.
 *
 * A primeira versão calculava o tamanho por uma largura média de caractere.
 * Errou para os dois lados — texto pequeno num quadrado vazio, depois texto
 * vazando para fora — porque Montserrat 900 não tem largura média estável e
 * o emoji da primeira linha nem entrava na conta. Medir o bloco pronto e
 * encolher até caber acerta sempre, com qualquer frase.
 */
(function () {
  var LIM_X = ${CARTAO - PAD_X * 2}, LIM_Y = ${CARTAO - PAD_Y * 2};
  function ajustar() {
    var t = document.querySelector('.texto');
    var tam = 180;
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
  // É esta linha que deixa o FORA do quadrado transparente.
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
console.log(`✓ ${saida}  (${LADO}×${LADO}, fundo transparente)`);
console.log(`  linhas: ${linhas.join(' | ')}${emojis.length ? `   emojis: ${emojis.join(' ')}` : ''}`);
