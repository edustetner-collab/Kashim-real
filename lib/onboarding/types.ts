// Tipos do sistema de onboarding interativo do Kashim.
// Config-driven: novos tours = novos arquivos em content/, sem tocar nas telas.

export type TourPlatform = 'all' | 'web' | 'native';

// Espelha as abas do App.tsx + telas secundárias
export type TourScreen = 'plan' | 'teto' | 'metas' | 'desempenho' | 'settings';

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
