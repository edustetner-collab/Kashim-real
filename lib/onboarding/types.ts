// Tipos do sistema de onboarding interativo do Kashim.
// Config-driven: novos tours = novos arquivos em content/, sem tocar nas telas.

export type TourPlatform = 'all' | 'web' | 'native';

// Espelha as abas do App.tsx + telas secundárias
export type TourScreen = 'plan' | 'teto' | 'metas' | 'desempenho' | 'settings' | 'extrato';

/**
 * Telas que o tour sabe DESENHAR, em vez de apontar para a tela viva.
 *
 * Existe porque apontar não funcionava: o card do tour cobre o alvo, então o
 * passo mandava clicar no que ele mesmo estava tapando; a sequência do tour não
 * acompanhava o fluxo real; e passos falavam de coisas que não estão na tela
 * (fechamento de fatura sem cartão lançado). Desenhar resolve os três, e ainda
 * dispensa `targetId`, `desktopOnly` e `mobileOnly` — não há alvo para errar.
 *
 * Nunca use print: além de envelhecer a cada mudança de layout, os prints reais
 * carregam CPF, agência, conta e nome de terceiros. Estes desenhos usam os
 * dados fictícios de `docs/openfinance/FLUXO-CONEXAO-TELAS.md`.
 */
export type TourIlustracaoId =
  | 'of-seus-dados'
  | 'of-dados-banco'
  | 'of-autorize'
  | 'of-saindo-do-app'
  | 'of-consentimento'
  | 'of-sucesso'
  | 'of-esperando'
  | 'of-categorizar'
  | 'of-falhou';

export interface AiOffer {
  // Texto do botão, ex: "Quer que o Stets lance um gasto pra você?"
  label: string;
  // Prompt pré-formatado enviado ao Stets (reusa /api/stets, nada novo)
  prompt: string;
}

export interface TourStep {
  id: string;
  // ID do elemento-alvo no DOM (sem '#'). Ausente = passo centralizado, sem spotlight.
  targetId?: string;
  /**
   * Desenha a tela dentro do card em vez de apontar para o elemento vivo.
   * Vence `targetId`: com ilustração o passo não tem alvo nem spotlight, e o
   * usuário não precisa clicar em nada para avançar.
   */
  ilustracao?: TourIlustracaoId;
  title: string;
  // Proposta de valor / benefício — nunca só "clique aqui"
  body: string;
  // Classe FontAwesome, ex: 'fa-brain'
  icon?: string;
  // Instrução prática opcional, ex: "Toque no + amarelo para lançar"
  demoAction?: string;
  aiOffer?: AiOffer;
  // 'web' = pulado automaticamente no app nativo (Apple 3.1.1); default 'all'
  platform?: TourPlatform;
  // true = pulado em viewports < 1024px (elementos hidden lg:block)
  desktopOnly?: boolean;
  // true = pulado em viewports >= 1024px (elementos lg:hidden)
  mobileOnly?: boolean;
  // Posição fixa do card no mobile. Sem valor = automático (lado com mais
  // espaço). Use 'top' quando o alvo/conteúdo relevante ocupa o meio/baixo
  // da tela (ex.: etapas dentro do lançador).
  cardPosition?: 'top' | 'bottom';
}

export interface Tour {
  id: string;
  screen: TourScreen;
  // Título curto exibido no ExploreMode / botão de ajuda
  label: string;
  steps: TourStep[];
}

export type TourStatus = 'in_progress' | 'completed' | 'skipped';

export interface OnboardingProgress {
  toursCompleted: string[];
  toursSkipped: string[];
  currentTourId: string | null;
  currentStepIndex: number;
}
