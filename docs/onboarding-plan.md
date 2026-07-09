# Plano Técnico — Onboarding Interativo do Kashim

> Baseado em `docs/onboarding-audit.md`. Este documento é a especificação de
> execução: o que construir, como estruturar, e em que ordem. Escrito para que
> qualquer modelo possa executar diretamente a partir daqui, sem precisar
> redescobrir o projeto.

## 0. Decisões já tomadas (não reabrir)

- Não é vídeo. É um tour interativo **ao vivo**, renderizado sobre a UI real do app.
- Reaproveitar conteúdo já existente (tooltips do `BlockSection`, textos do
  `OnboardingWizard`) em vez de reescrever do zero.
- Módulo desacoplado, config-driven — novos tours = novos dados, não novo código
  nas telas existentes.
- Qualquer passo sobre assinatura/pagamento precisa usar `platform: 'web'`.
- Progresso deve ser persistido no Supabase.
- `OnboardingWizard.tsx` é MANTIDO e portado para o app nativo.
- `OnboardingTutorial.tsx` é SUBSTITUÍDO pelo novo tour interativo.

## 1. Arquitetura do módulo

```
lib/onboarding/
  types.ts            → TourStep, Tour, TourTrigger, OnboardingProgress
  registry.ts         → lista de todos os tours disponíveis (config-driven)
  engine.ts           → máquina de estado: passo atual, avançar/voltar/pular,
                        detecção de elemento na tela, reposicionamento
  platform.ts         → hook único usePlatform() — substitui as 2 duplicatas
                        hoje em App.tsx (linhas 31 e 55)
  persistence.ts      → ler/gravar progresso (Supabase + fallback localStorage)
  content/
    plano.ts
    gastosFrequentes.ts
    metas.ts
    desempenho.ts
    configuracoes.ts

components/onboarding/
  TourOverlay.tsx     → spotlight + máscara + popup, posicionado dinamicamente
  TourCard.tsx        → conteúdo do passo (proposta de valor / benefício / ação IA)
  HelpButton.tsx      → botão de ajuda fixo (canto superior direito) em toda tela
  ExploreMode.tsx     → modo de exploração livre
  ProgressBadge.tsx   → "Etapa X de Y" + indicador de progresso total
```

**Ponto de entrada:** `App.tsx` troca `showTutorial → OnboardingTutorial` por um
`<OnboardingProvider>` que decide, com base no progresso salvo e no tipo de usuário,
qual tour iniciar — sem tocar na lógica de negócio existente. O `showOnboarding →
OnboardingWizard` permanece, mas agora funciona também no nativo.

## 2. Modelo de dados (types.ts)

```ts
interface TourStep {
  id: string;
  targetSelector: string;        // reaproveitando IDs existentes: #stets, #blocks...
  title: string;
  valueProposition: string;      // por que essa tela existe / benefício
  demoAction?: string;           // "clique aqui, veja o resultado"
  aiOffer?: {
    prompt: string;              // "Quer que eu faça isso pra você?"
    playbookId: string;          // ação que o Stats/Stets executa (reusa /api/stets)
  };
  platform?: 'all' | 'web' | 'native'; // 'web' = pular no nativo automaticamente
  video?: string;                // opcional, vinculável depois
}

interface Tour {
  id: string;                    // ex: 'plano', 'gastos-frequentes'
  audience: 'client_new' | 'client_coached' | 'coach';
  steps: TourStep[];
}

interface OnboardingProgress {
  userId: string;
  toursCompleted: string[];
  toursSkipped: string[];
  currentTourId?: string;
  currentStepIndex?: number;
  updatedAt: string;
}
```

## 3. Persistência (nova tabela Supabase)

Tabela `onboarding_progress`:
- `clerk_user_id` (text, PK)
- `tours_completed` (text[])
- `tours_skipped` (text[])
- `current_tour_id` (text, nullable)
- `current_step_index` (int, nullable)
- `updated_at` (timestamptz)

Migração de dados existentes: na primeira carga, ler `localStorage.tutorial_completed`
e `localStorage.onboarding_done_${userId}` — se existirem, gravar no Supabase e
remover do localStorage. Não perder progresso de quem já usou o app.

## 4. Cobertura obrigatória — telas e prioridade

| Prioridade | Tela | Conteúdo-base disponível |
|---|---|---|
| P0 | **Wizard no nativo** | `OnboardingWizard.tsx` existente (portagem) |
| P0 | Plano (Gastos Mensais) | `OnboardingTutorial.tsx` (5 passos) + tooltips de `BlockSection` |
| P0 | Gastos Frequentes (Teto) | Lógica de dedução de fatura (auditoria seção 6) |
| P1 | Metas | Criar do zero |
| P1 | Desempenho | Usar explicação do score (auditoria seção 6) |
| P1 | Configurações (Conta/Avisos/Casal/Plano) | Criar; aba "Plano" com `platform: 'web'` |
| P2 | Modo Exploração + botão de ajuda global | Infraestrutura de ajuda |

## 5. Integração com IA ("Stats" / "Stets")

**Pendência:** confirmar com Eduardo se o nome da persona no tour é "Stats" (novo)
ou "Stets" (o coach existente). São nomes diferentes ou erro de digitação?

O endpoint `/api/stets` já existe e executa ações reais. O onboarding não precisa
de sistema de IA novo — precisa **oferecer** o que já existe no momento certo.
Ex: no passo sobre "Gastos Frequentes", o `aiOffer` chama o Stets com um prompt
pré-formatado equivalente ao que o usuário digitaria.

## 6. Web vs Nativo — regra de implementação

Um único hook `usePlatform()` (novo, em `lib/onboarding/platform.ts`) substitui as
2 verificações duplicadas de `isNativeApp` hoje em App.tsx. Qualquer `TourStep` com
`platform: 'web'` é pulado automaticamente pelo motor do tour quando rodando no nativo
— sem `if` espalhado no conteúdo.

## 7. Visual — Design System do Kashim (não inventar novo)

- Cor de destaque: gradiente lima `#c5f23a → #8cc400` (botões e progresso)
- Fundo escuro dos modais: `zinc-900` / `#0a0a0a`, texto branco
- Títulos: `uppercase italic tracking-tighter font-black`
- Ícones: FontAwesome 6.4 (já em uso em 100% dos componentes)
- Cards: `rounded-2xl`/`rounded-3xl`, bordas `border-zinc-800`
- Animações: `animate-in fade-in`/`slide-in-from-bottom` (Tailwind animate plugin)
- Mobile: slider inferior fixo (`fixed bottom-0`) no lugar de popup flutuante

## 8. Comportamento do spotlight

- Escurecer toda a interface — manter apenas o elemento atual visível/clicável
- O destaque deve acompanhar o elemento ao scrollar ou redimensionar
- O elemento destacado permanece interativo (não bloquear cliques nele)
- Popup nunca sai da tela — reposicionar automaticamente se não houver espaço
- Se não houver espaço: mover para canto superior direito com padding de 32px
- Formato do spotlight adaptado ao componente (botão: arredondado; tabela: área toda)

## 9. Fases de execução (ordem definitiva)

```
Fase 1 — Fundação
  Criar lib/onboarding/ completo (types, engine, platform, persistence)
  Criar tabela Supabase onboarding_progress + migração de localStorage

Fase 2 — P0: Wizard no nativo
  Detectar isNativeApp no fluxo de primeiro acesso do App.tsx
  Mostrar OnboardingWizard no nativo (hoje só na web)
  Testar com perfil de teste via magic link

Fase 3 — P0: Tour aba Plano
  Criar TourOverlay.tsx + TourCard.tsx
  Criar lib/onboarding/content/plano.ts com os 5 passos base
  Integrar no App.tsx substituindo OnboardingTutorial
  Validar em mobile (passos que usam #diagnosis e #summary-section devem ser
  pulados automaticamente no nativo)

Fase 4 — P0: Tour Gastos Frequentes
  Criar lib/onboarding/content/gastosFrequentes.ts
  Incluir explicação de dedução de fatura de cartão

Fase 5 — P1: Metas, Desempenho, Configurações
  Criar conteúdo de cada tela
  Passo de Configurações/Plano com platform: 'web'

Fase 6 — P2: Infraestrutura de ajuda
  Criar HelpButton.tsx (visível em todas as telas, sempre)
  Criar ExploreMode.tsx (modo exploração livre)
  Criar ProgressBadge.tsx

Fase 7 — Polish
  Micro-interações, responsividade, QA completo web + nativo
  Validar que tour não aparece para Eduardo (isAdmin check)
```

## 10. Regras de implementação (nunca violar)

1. Nenhuma funcionalidade existente pode quebrar
2. Nenhuma degradação de performance
3. Config-driven: novos tours = novos arquivos em `content/`, zero alteração em telas
4. Testar com perfil de cliente de teste (magic link via CoachDashboard) — não usar
   conta admin (Eduardo) pois admin pula loadData e não vê onboarding
5. Qualquer ação arriscada: avisar Eduardo antes de executar
