// Tour da aba Metas — conteúdo novo.

import { Tour } from '../types';

export const metasTour: Tour = {
  id: 'metas',
  screen: 'metas',
  label: 'Metas',
  steps: [
    {
      id: 'intro',
      title: 'Dinheiro sem destino desaparece',
      body: 'Poupar "o que sobrar" não funciona — nunca sobra. Metas dão um destino concreto ao seu dinheiro: a viagem, a reserva de emergência, a entrada do apartamento. Quem vê o progresso, continua.',
      icon: 'fa-bullseye',
    },
    {
      id: 'create',
      title: 'Crie sua primeira meta',
      body: 'Defina um nome, um emoji, o valor total e o prazo. O anel de progresso mostra o quanto falta — e cada contribuição te aproxima visivelmente do objetivo.',
      icon: 'fa-circle-plus',
      demoAction: 'Toque em "Nova Meta" e crie a sua — pode ser a reserva de emergência.',
    },
    {
      id: 'contribute',
      title: 'Alimente a meta todo mês',
      body: 'O ideal do método é guardar pelo menos 20% da renda. Sempre que guardar dinheiro, registre a contribuição aqui — a meta cresce e o seu score na aba Desempenho também.',
      icon: 'fa-piggy-bank',
    },
  ],
};
