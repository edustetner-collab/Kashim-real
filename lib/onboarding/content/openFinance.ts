// Tour de Open Finance — o caminho da conexão bancária.
//
// Todo passo é ILUSTRADO: mostra a tela desenhada em vez de mandar clicar. O
// motivo está em types.ts (TourIlustracaoId). Aqui vale registrar a pedagogia:
//
// 1. avisar ANTES do que assusta, não consertar depois. Os dois momentos de
//    desistência mapeados nos prints do Eduardo são a marca do Kashim sumir da
//    tela (telas 4 a 9 do fluxo) e a lista de consentimento do banco, que
//    oferece muito mais do que a gente lê. Os dois têm passo próprio.
// 2. a espera não é falha. O passo do prazo vem antes do passo de categorizar,
//    porque na vida real a espera vem antes também.
// 3. o fim do tour é o único lugar com ação real — e com a tela livre.

import { Tour } from '../types';

export const openFinanceTour: Tour = {
  id: 'open-finance',
  screen: 'extrato',
  label: 'Conectar seu banco',
  steps: [
    {
      id: 'porque',
      title: 'Seus gastos, sem digitar',
      body: 'Conectando seu banco, o Kashim recebe suas compras sozinho — do jeito que o banco enviar. Você deixa de lançar cada gasto na mão e passa só a organizar o que já chegou.',
      icon: 'fa-building-columns',
    },
    {
      id: 'so-leitura',
      title: 'Ler é tudo que dá para fazer',
      body: 'O Kashim só enxerga o extrato. Não movimenta dinheiro, não paga conta, não transfere — nem se quisesse: a autorização do Open Finance é de leitura, e quem guarda sua senha é o banco. Nós nunca a vemos.',
      icon: 'fa-lock',
    },
    {
      id: 'seus-dados',
      ilustracao: 'of-seus-dados',
      title: 'Passo 1: quem é você',
      body: 'Nome, CPF e endereço. É o que o Open Finance exige para o banco saber quem está autorizando. Fica só entre você e o seu banco.',
      icon: 'fa-id-card',
    },
    {
      id: 'dados-banco',
      ilustracao: 'of-dados-banco',
      title: 'Passo 2: qual conta',
      body: 'Escolha o banco e informe agência e conta. Confira com calma: o banco confere esses números, e um dígito errado impede a conexão sem dizer o motivo.',
      icon: 'fa-university',
    },
    {
      id: 'autorize',
      ilustracao: 'of-autorize',
      title: 'Agora é com o seu banco',
      body: 'O Kashim te leva até a autorização. Sempre que puder, faça pelo navegador, entrando na conta pelo site do banco — pelo aplicativo a autorização costuma travar no meio.',
      icon: 'fa-key',
    },
    {
      id: 'saindo',
      ilustracao: 'of-saindo-do-app',
      title: 'O Kashim vai sumir da tela',
      body: 'Por algumas etapas você verá outros endereços e o nome Pluggy, que é a empresa que faz a ponte com os bancos. Estranha, mas é o caminho oficial do Open Finance. Continue até o fim.',
      icon: 'fa-arrow-right-from-bracket',
    },
    {
      id: 'consentimento',
      ilustracao: 'of-consentimento',
      title: 'O banco vai oferecer demais',
      body: 'Ele lista tudo que poderia compartilhar — inclusive investimentos e operações de crédito. O Kashim lê apenas conta e cartão, que é o que faz o seu plano funcionar. E você pode cancelar quando quiser, pelo banco ou aqui.',
      icon: 'fa-shield-halved',
    },
    {
      id: 'sucesso',
      ilustracao: 'of-sucesso',
      title: 'Vai aparecer um código',
      body: 'No fim o banco mostra um identificador com botão de copiar. Você não precisa dele. É só a confirmação de que deu certo — o Kashim busca esse código sozinho. Pode fechar.',
      icon: 'fa-circle-check',
    },
    {
      id: 'espera',
      ilustracao: 'of-esperando',
      title: 'Os gastos não chegam na hora',
      body: 'O banco leva de 6 a 24 horas para liberar seu histórico. É regra do Open Finance, não lentidão nossa. Pode fechar o app: quando chegar, a gente te avisa.',
      icon: 'fa-clock',
    },
    {
      id: 'nao-abriu',
      ilustracao: 'of-falhou',
      title: 'Se pedir para baixar o app',
      body: 'Acontece quando o celular não reconhece o aplicativo do banco, mesmo instalado. Não toque em "baixar". Copie o link da autorização e abra no Chrome ou no Safari pela tela inicial. Em aparelho antigo, vale tentar em outro celular.',
      icon: 'fa-triangle-exclamation',
    },
    {
      id: 'categorizar',
      ilustracao: 'of-categorizar',
      title: 'Seu trabalho agora é só organizar',
      body: 'Cada gasto que chega ganha uma etiqueta de categoria. O Kashim chuta a partir do nome do estabelecimento, e você corrige tocando na etiqueta. Feito uma vez, ele aprende e passa a acertar sozinho.',
      icon: 'fa-tags',
      demoAction: 'Toque em Conectar banco quando quiser começar.',
    },
  ],
};
