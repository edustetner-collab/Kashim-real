// Tour da aba Desempenho — conteúdo novo, baseado na mecânica real do score
// (lib/gamification.ts): 0-1000 pontos, 6 níveis, 8 badges, streak.

import { Tour } from '../types';

export const desempenhoTour: Tour = {
  id: 'desempenho',
  screen: 'desempenho',
  label: 'Desempenho',
  steps: [
    {
      id: 'intro',
      title: 'Seu jogo financeiro',
      body: 'Organizar dinheiro sem feedback é como treinar sem ver resultado — desanima. Esta tela transforma sua vida financeira em um jogo: score de 0 a 1000, níveis, conquistas e sequência de meses positivos.',
      icon: 'fa-chart-pie',
    },
    {
      id: 'score',
      title: 'Como o score funciona',
      body: 'O que mais pontua: guardar dinheiro (300 pts) e manter contas fixas + cartão sob controle (200 pts). Lazer dentro dos 15% vale 150, variáveis controladas 100, mês positivo 100 e metas em dia 150. O score recompensa exatamente o que enriquece.',
      icon: 'fa-trophy',
    },
    {
      id: 'levels',
      title: 'Da Fase Despertar ao RICO Nessa Vida',
      body: 'São 6 níveis de evolução. Cada mês dentro do plano te sobe de fase — e a sequência de meses positivos (streak) mostra sua consistência. Consistência vale mais que um mês perfeito.',
      icon: 'fa-ranking-star',
    },
    {
      id: 'bars',
      title: 'Onde você está vs o ideal',
      body: 'As barras comparam seus gastos reais com os percentuais ideais do método: Fixos até 55% da renda, Lazer até 15%, Poupança de 20% ou mais. Se alguma barra passar do ideal, ela mostra exatamente onde agir.',
      icon: 'fa-chart-bar',
    },
  ],
};
