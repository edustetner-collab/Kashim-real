// Tour "Cartões de crédito" — cadastro do cartão, fechamento/vencimento e a
// dedução automática de fatura. Não auto-inicia: acessível pelo botão de ajuda.

import { Tour } from '../types';

export const cartoesTour: Tour = {
  id: 'cartoes',
  screen: 'plan',
  label: 'Cartões de crédito',
  steps: [
    {
      id: 'why',
      targetId: 'block-faturas',
      title: 'Por que cadastrar seus cartões',
      body: 'Cartão de crédito é onde o orçamento mais escapa. Cadastrando cada cartão aqui, toda compra no crédito cai na fatura certa e o plano mostra a fatura fechada antes de ela chegar — sem surpresa no fim do mês.',
      icon: 'fa-credit-card',
    },
    {
      id: 'add-card',
      targetId: 'block-faturas',
      title: 'Cadastre cada cartão',
      body: 'Um cartão = uma linha neste bloco. Dê o nome do cartão (Nubank, Inter, Itaú...) e lance o valor TOTAL da fatura de cada mês — não detalhe as compras aqui.',
      icon: 'fa-plus',
      demoAction: 'Toque no "+" do bloco Faturas de Cartão e crie o seu primeiro cartão agora.',
    },
    {
      id: 'card-config',
      targetId: 'card-config',
      cardPosition: 'top',
      title: 'Fechamento e vencimento',
      body: '"Fecha" é o dia que a fatura fecha: compras depois desse dia caem na fatura SEGUINTE. "Vence" é o dia de pagar. Com o fechamento configurado, o Kashim sabe exatamente em qual mês cada compra parcelada ou à vista vai cair.',
      icon: 'fa-calendar-days',
      demoAction: 'Preencha os dias de fechamento e vencimento do seu cartão.',
    },
    {
      id: 'deduction',
      title: 'Sem contar duas vezes',
      body: 'Ao lançar um gasto no crédito (pelo lançador ou pelo Stets), você escolhe o cartão e o valor entra na fatura certa automaticamente. Gastos rastreados em Gastos Frequentes vinculados ao cartão são abatidos da fatura — o mesmo dinheiro nunca é somado duas vezes.',
      icon: 'fa-shield-halved',
    },
    {
      id: 'next',
      title: 'Agora é só usar',
      body: 'Quer ver na prática? Abra o tutorial "Como lançar gastos" no menu de ajuda e faça um lançamento no crédito de ponta a ponta.',
      icon: 'fa-graduation-cap',
    },
  ],
};
