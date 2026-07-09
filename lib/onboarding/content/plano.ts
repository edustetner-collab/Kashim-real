// Tour da aba Plano (Gastos Mensais) — conteúdo migrado do OnboardingTutorial
// antigo + tooltips do BlockSection. Pedagogia: problema → benefício → prática.

import { Tour } from '../types';

export const planoTour: Tour = {
  id: 'plano',
  screen: 'plan',
  label: 'Gastos Mensais',
  steps: [
    {
      id: 'welcome',
      title: 'Bem-vindo ao seu novo estilo de vida!',
      body: 'Este é o Kashim. A maioria das pessoas não sabe para onde o dinheiro vai — e é por isso que ele nunca sobra. Aqui você enxerga seus 12 meses de uma vez e assume o controle de verdade.',
      icon: 'fa-rocket',
    },
    {
      id: 'stets',
      targetId: 'stets',
      title: 'Conheça o Stets',
      body: 'O Stets é seu professor digital. Lançar gastos manualmente toma tempo — com o Stets, você fala ou digita ("gastei 50 no mercado") e ele lança pra você. Também aceita foto de nota fiscal e dá diagnóstico da sua saúde financeira.',
      icon: 'fa-brain',
      demoAction: 'Experimente: toque no campo e diga o que você gastou hoje.',
      aiOffer: {
        label: 'Quer que o Stets lance um gasto pra você agora?',
        prompt: 'Gastei ',
      },
    },
    {
      id: 'month-navigator',
      targetId: 'month-navigator',
      title: 'Navegue pelos seus 12 meses',
      body: 'Seu plano cobre 12 meses. Use as setas para ver qualquer mês — passado ou futuro. Assim você planeja dezembro em janeiro, e nunca mais é pego de surpresa por IPTU ou material escolar.',
      icon: 'fa-calendar-days',
      mobileOnly: true,
    },
    {
      id: 'blocks',
      targetId: 'blocks',
      title: 'Os 5 blocos do seu plano',
      body: 'Entradas (salário e rendas), Faturas de Cartão (valor total da fatura, sem detalhar itens), Contas Fixas (recorrentes, como aluguel), Contas Variáveis (boletos únicos ou parcelas curtas) e Lazer (ideal: até 15% da renda). Toque no "?" de cada bloco para relembrar a regra.',
      icon: 'fa-layer-group',
      demoAction: 'Toque no "+" de um bloco para fazer seu primeiro lançamento.',
    },
    {
      id: 'replicate',
      title: 'Ganhe tempo com um clique',
      body: 'Reparou no botão amarelo circular ao lado dos valores? Ele replica o valor atual para todos os meses seguintes automaticamente. Ideal para aluguel, internet e parcelas fixas — preencha uma vez, não doze.',
      icon: 'fa-rotate',
    },
    {
      id: 'summary-mobile',
      targetId: 'summary-mobile',
      title: 'Seu Acumulado',
      body: 'Esta é a bússola do seu enriquecimento: quanto dinheiro você terá acumulado se seguir o plano. Ver esse número crescer mês a mês é o que mantém a disciplina.',
      icon: 'fa-vault',
      mobileOnly: true,
    },
    {
      id: 'summary-desktop',
      targetId: 'summary-section',
      title: 'Resumo e Acumulado',
      body: 'No final da página, a bússola do seu enriquecimento: total de custos, saldo mensal e o ACUMULADO. Descubra exatamente quanto dinheiro terá daqui a 12 meses se seguir o plano.',
      icon: 'fa-vault',
      desktopOnly: true,
    },
    {
      id: 'next-teto-desktop',
      targetId: 'tab-gastos-frequentes',
      title: 'Próxima parada: Gastos Frequentes',
      body: 'É aqui que a mágica acontece no dia a dia. Você define um "teto" para mercado, gasolina, delivery — e o Kashim te avisa antes de estourar o limite.',
      icon: 'fa-wallet',
      desktopOnly: true,
    },
    {
      id: 'next-teto-mobile',
      targetId: 'tab-teto-mobile',
      title: 'Próxima parada: Gastos Frequentes',
      body: 'É aqui que a mágica acontece no dia a dia. Você define um "teto" para mercado, gasolina, delivery — e o Kashim te avisa antes de estourar o limite.',
      icon: 'fa-wallet',
      mobileOnly: true,
    },
  ],
};
