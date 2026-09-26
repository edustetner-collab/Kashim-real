/*
 * Empurrao de layout na PRIMEIRA abertura do app nativo.
 *
 * O WKWebView pinta antes de terminar de calcular as areas seguras: a tela
 * nasce com a altura errada e o conteudo aparece cortado. Reabrir resolve
 * porque na segunda vez o valor ja existe.
 *
 * Mexer na altura da raiz e desfazer no quadro seguinte obriga o navegador a
 * refazer a conta com os valores certos. Invisivel (o usuario nao ve piscar) e
 * sem efeito nenhum na web, onde o bug nao existe. Roda uma vez, e de novo
 * apos 300ms para o caso de o inset chegar depois.
 *
 * POR QUE E UM ARQUIVO, E NAO UM <script> NO index.html:
 * o CSP de producao tem `script-src 'self'` sem `unsafe-inline` nem nonce.
 * Enquanto isto vivia embutido no HTML, o navegador BLOQUEAVA — o console
 * acusava "Executing inline script violates the following Content Security
 * Policy directive" em toda abertura, e a correcao nunca rodou uma vez
 * sequer em producao (achado em 2026-09-26). Como arquivo servido pelo
 * proprio dominio, ele passa no `'self'` e finalmente executa.
 */
(function () {
  if (!window.Capacitor || !window.Capacitor.isNativePlatform || !window.Capacitor.isNativePlatform()) return;
  function recalcular() {
    var raiz = document.documentElement;
    raiz.style.height = '100.1%';
    requestAnimationFrame(function () {
      raiz.style.height = '';
      window.dispatchEvent(new Event('resize'));
    });
  }
  window.addEventListener('load', function () {
    recalcular();
    setTimeout(recalcular, 300);
  });
})();
