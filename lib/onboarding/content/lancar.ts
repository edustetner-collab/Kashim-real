// Tour "Como lançar gastos" — guia o cliente DENTRO do lançador (ExpenseSheet
// fica em z-60, abaixo da máscara do tour em z-80, então o spotlight funciona
// sobre os elementos internos do sheet enquanto ele está aberto).
// Não auto-inicia: acessível pelo botão de ajuda.

import { Tour } from '../types';

export const lancarTour: Tour = {
  id: 'lancar',
  screen: 'plan',
  label: 'Como lançar gastos',
  steps: [
    {
      id: 'launch-btn-mobile',
      targetId: 'tab-launch',
      title: 'O botão de lançar',
      body: 'Todo gasto do dia a dia entra por aqui. Quanto mais rápido você lança, menos você esquece — e gasto esquecido é plano furado.',
      icon: 'fa-plus',
      demoAction: 'Toque no botão verde AGORA para abrir o lançador — o tour continua lá dentro.',
      mobileOnly: true,
    },
    {
      id: 'launch-btn-desktop',
      targetId: 'block-variaveis',
      title: 'Onde lançar um gasto',
      body: 'No computador, o lançador abre pelo "+" do bloco Contas Variáveis (ou pelo "+" verde de qualquer bloco). Todo gasto do dia a dia entra por ali.',
      icon: 'fa-plus',
      demoAction: 'Clique no "+" do bloco AGORA para abrir o lançador — o tour continua lá dentro.',
      desktopOnly: true,
    },
    {
      id: 'sheet-categories',
      targetId: 'sheet-categories',
      cardPosition: 'top',
      title: 'Passo 1: o tipo de despesa',
      body: 'Gasto Variável é o imprevisto (conserto, farmácia). Lazer & Pessoal é estilo de vida (restaurante, presente). Conta Fixa é o que você já paga todo mês. Escolher certo mantém o diagnóstico do plano correto.',
      icon: 'fa-list',
      demoAction: 'Escolha a categoria, o item e digite o valor. Depois toque em Próximo aqui.',
    },
    {
      id: 'sheet-payment',
      targetId: 'sheet-payment',
      cardPosition: 'top',
      title: 'Passo 2: débito ou crédito?',
      body: 'DÉBITO: o dinheiro saiu na hora — o gasto conta no mês da compra. CRÉDITO: vai para a fatura do cartão — o Kashim joga o valor para a fatura certa e não conta duas vezes.',
      icon: 'fa-money-bill-wave',
      demoAction: 'Toque em Débito ou Crédito conforme você pagou.',
    },
    {
      id: 'sheet-card',
      targetId: 'sheet-card',
      cardPosition: 'top',
      title: 'Crédito? Diga qual cartão',
      body: 'Se pagou no crédito, escolha em QUAL cartão — é assim que a compra cai na fatura certa, respeitando o dia de fechamento de cada um. Se ainda não cadastrou seus cartões, veja o tutorial "Cartões de crédito" no menu de ajuda.',
      icon: 'fa-credit-card',
    },
    {
      id: 'sheet-credit-type',
      targetId: 'sheet-credit-type',
      cardPosition: 'top',
      title: 'À vista ou parcelado?',
      body: 'À vista no crédito: o valor inteiro cai na próxima fatura. Parcelado: escolha em quantas vezes e o Kashim distribui as parcelas automaticamente pelos meses seguintes, a partir da data da compra.',
      icon: 'fa-divide',
    },
    {
      id: 'confirm',
      targetId: 'sheet-confirm',
      cardPosition: 'top',
      title: 'Confirme e pronto',
      body: 'Toque em LANÇAR e o gasto entra no mês certo do plano. Dica: dá para mudar a "Data da compra" e lançar algo de dias atrás (lançamento retroativo). E lembre: o Stets lança por você — basta falar "gastei 50 no mercado no crédito do Nubank".',
      icon: 'fa-check-circle',
      demoAction: 'Toque no botão verde LANÇAR para concluir seu primeiro lançamento.',
    },
  ],
};
