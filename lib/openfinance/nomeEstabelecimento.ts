/**
 * Tira o lixo da maquininha do nome que o banco manda.
 *
 * "DLKNET *AC PARQUE INDU" é o nome do INTERMEDIÁRIO (a maquininha) grudado no
 * nome do lugar; "APLIC.INVEST FACIL - DOCTO: 326055" traz um número de
 * documento que não diz nada ao cliente (Eduardo, 2026-09-23).
 *
 * O que dá para limpar é o ruído. O NOME do lugar, quando o banco não manda,
 * ninguém consegue adivinhar — quem resolve é a pergunta "qual é o nome deste
 * estabelecimento?", que alimenta o dicionário compartilhado.
 */

/** Intermediários que aparecem colados no nome, quase sempre antes de "*". */
const MAQUININHAS = /^(dlknet|pag|pags|pagseguro|pagsegur|mp|mercadopago|mercpago|cielo|rede|stone|sumup|getnet|ton|picpay|paypal|ebanx|pagarme|iugu|infinitepay|zoop|safrapay|vero|granito|adyen|ec)\s*\*+\s*/i;

/**
 * Como a maquininha se chama para uma pessoa.
 *
 * Quando o que vem depois do "*" é código puro, o nome do intermediário é a
 * melhor informação verdadeira que temos: "Mercado Pago" diz alguma coisa,
 * "50295201NICOL" não diz nada (Eduardo, 2026-09-25 — "não existe aparecer uma
 * transação com o nome de 50295201nicol, isso é inadmissível").
 */
const NOME_DA_MAQUININHA: Record<string, string> = {
  mp: 'Mercado Pago',
  mercadopago: 'Mercado Pago',
  mercpago: 'Mercado Pago',
  pag: 'PagSeguro',
  pags: 'PagSeguro',
  pagseguro: 'PagSeguro',
  pagsegur: 'PagSeguro',
  picpay: 'PicPay',
  paypal: 'PayPal',
  cielo: 'Cielo',
  rede: 'Rede',
  stone: 'Stone',
  sumup: 'SumUp',
  getnet: 'GetNet',
  ton: 'Ton',
  infinitepay: 'InfinitePay',
  pagarme: 'Pagar.me',
  ebanx: 'EBANX',
  iugu: 'Iugu',
  zoop: 'Zoop',
  safrapay: 'SafraPay',
  adyen: 'Adyen',
};

/**
 * É código de sistema, não nome de lugar?
 *
 * Identificador de maquininha vem com número demais para ser nome de gente ou
 * de loja. "GIOVANIFIGUEIREOA" passa (é um nome grudado, e mostrar isso é
 * melhor que esconder); "50295201NICOL" não passa.
 */
function pareceCodigo(texto: string): boolean {
  const semEspaco = texto.replace(/\s/g, '');
  if (semEspaco.length < 3) return true;
  const digitos = (semEspaco.match(/\d/g) ?? []).length;
  if (digitos / semEspaco.length > 0.4) return true;
  // Sem nenhuma sequência de 3 letras seguidas não há palavra alguma ali.
  return !/[a-zà-ú]{3}/i.test(texto);
}

export function limparNomeEstabelecimento(texto: string | null | undefined): string {
  let t = (texto ?? '').trim();
  if (!t) return '';

  // "DLKNET *AC PARQUE INDU" → "AC PARQUE INDU"; guarda quem era a maquininha
  // para poder voltar a ela se o que sobrar não servir.
  const casou = t.match(MAQUININHAS);
  const maquininha = casou ? NOME_DA_MAQUININHA[casou[1].toLowerCase()] ?? null : null;
  const semMaquininha = t.replace(MAQUININHAS, '');
  if (semMaquininha.trim().length >= 4) t = semMaquininha.trim();
  // Qualquer outro "ALGO*NOME" com nome aproveitável.
  const porAsterisco = t.match(/^[A-Za-z0-9]{2,12}\s*\*+\s*(.{4,})$/);
  if (porAsterisco?.[1]) t = porAsterisco[1].trim();

  // Números de controle do banco, que não significam nada para o cliente.
  // O ":" pode vir sem número nenhum quando o banco corta a descrição —
  // "Edp Sp 21/09 - Docto:" ficava exatamente assim na tela.
  t = t.replace(/\s*[-–]?\s*DOCTO:?\s*\d*\s*$/i, '');
  // A data de compra sobra no fim com ou sem travessão: "Edp Sp 21/09".
  t = t.replace(/\s*[-–]?\s*\d{2}\/\d{2}\s*$/, '');
  t = t.replace(/\s{2,}/g, ' ').replace(/[\s\-–.:]+$/, '').trim();

  // Sobrou código de maquininha: o nome dela é mais honesto que o código.
  if (maquininha && pareceCodigo(t)) return maquininha;

  return t;
}
