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

export function limparNomeEstabelecimento(texto: string | null | undefined): string {
  let t = (texto ?? '').trim();
  if (!t) return '';

  // "DLKNET *AC PARQUE INDU" → "AC PARQUE INDU"
  const semMaquininha = t.replace(MAQUININHAS, '');
  if (semMaquininha.trim().length >= 4) t = semMaquininha.trim();
  // Qualquer outro "ALGO*NOME" com nome aproveitável.
  const porAsterisco = t.match(/^[A-Za-z0-9]{2,12}\s*\*+\s*(.{4,})$/);
  if (porAsterisco?.[1]) t = porAsterisco[1].trim();

  // Números de controle do banco, que não significam nada para o cliente.
  t = t.replace(/\s*[-–]?\s*DOCTO:?\s*\d+\s*$/i, '');
  t = t.replace(/\s*[-–]\s*\d{2}\/\d{2}\s*$/, '');
  t = t.replace(/\s{2,}/g, ' ').replace(/[\s\-–.]+$/, '').trim();

  return t;
}
