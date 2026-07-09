// Tour da aba Gastos Frequentes (TetoGastos) — conteúdo novo, baseado na
// lógica de negócio documentada (teto por categoria + dedução de fatura).

import { Tour } from '../types';

export const gastosFrequentesTour: Tour = {
  id: 'gastos-frequentes',
  screen: 'teto',
  label: 'Gastos Frequentes',
  steps: [
    {
      id: 'intro',
      title: 'O controle do dia a dia',
      body: 'O plano mensal mostra o todo — mas é no mercado, na gasolina e no delivery que o orçamento estoura sem você perceber. Aqui você define um TETO para cada gasto frequente e lança cada compra. O Kashim te avisa antes de passar do limite, não depois.',
      icon: 'fa-wallet',
    },
    {
      id: 'teto-cards',
      title: 'Cada card é um teto',
      body: 'Crie um card para cada gasto do dia a dia: Mercado, Gasolina, Farmácia... Defina o limite mensal e lance cada compra no card. A barra mostra quanto do teto você já usou no mês.',
      icon: 'fa-gauge-high',
      demoAction: 'Toque em um card para lançar um gasto — ou crie um card novo.',
      aiOffer: {
        label: 'Quer que o Stets lance um gasto frequente pra você?',
        prompt: 'Gastei 50 reais no mercado hoje',
      },
    },
    {
      id: 'card-deduction',
      title: 'Sem contar duas vezes',
      body: 'Comprou no cartão de crédito? O Kashim abate automaticamente esse gasto da fatura do mês seguinte. Você acompanha o gasto aqui E a fatura lá no plano — sem somar duas vezes o mesmo dinheiro. É automático, você não precisa fazer nada.',
      icon: 'fa-credit-card',
    },
    {
      id: 'reorder',
      title: 'Organize do seu jeito',
      body: 'Segure e arraste um card para reordenar. Deixe no topo os gastos que você lança com mais frequência.',
      icon: 'fa-arrows-up-down',
    },
  ],
};
