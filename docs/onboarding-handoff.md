# HANDOFF — Onboarding Interativo do Kashim
> **Leia este arquivo primeiro**, antes de `onboarding-audit.md` e `onboarding-plan.md`.
> Captura todas as decisões tomadas e novos requisitos definidos na conversa de
> alinhamento com Eduardo em 2026-07-09. É a única fonte de verdade sobre "o que foi decidido".

---

## Quem é Eduardo
Eduardo Stetner: criador do Kashim, único consultor financeiro, e o usuário que
dá as instruções. Ele é admin do sistema (ADMIN_USER_IDS). Usuários ativos hoje:
4 pessoas. Expectativa: ~50 em 2–3 semanas após rollout na Apple Store.

---

## Novo requisito (não estava no plano original)

O `OnboardingWizard.tsx` (coleta de dados financeiros — renda + despesas fixas)
**hoje só existe na versão web**. No app nativo (iOS via Capacitor), o cliente
abre o app direto sem nenhuma coleta de dados.

**Requisito novo:** portar o `OnboardingWizard` para o app nativo, antes de
qualquer outra coisa do onboarding.

**Ordem obrigatória para todos os usuários, em todas as plataformas:**
```
1. OnboardingWizard (coleta de dados)   ← web já tem; nativo precisa receber
2. Tour interativo                       ← substitui OnboardingTutorial.tsx
3. App normal
```

---

## Todas as decisões fechadas

| Pergunta | Decisão |
|---|---|
| Nome da persona da IA no tour | **"Stats"** — ver pendência abaixo |
| Gatilho do tour | Automático no 1º acesso de cada tela + botão de ajuda sempre visível |
| Audiência do tour | Apenas clientes finais. Eduardo (admin) não recebe tour. |
| Usuários que completaram o tutorial antigo | Não veem o novo automaticamente. Só se clicarem em ajuda. |
| Botão de ajuda | Deve ser evidente e visível o tempo todo, em toda tela |
| Wizard de coleta de dados | MANTIDO. Fica antes do tour. Deve chegar ao nativo. |
| Pagamento no tour | Sem mencionar trial de 5 meses. Pode mencionar onde mudar plano/pagar, com regra: **app nativo = nunca menciona pagamento** / **web = pode mostrar** |
| Onboarding web vs nativo | Ambos devem existir — são experiências visuais diferentes |
| Prioridade de execução | Cliente final primeiro. CoachDashboard/consultor fica para depois. |
| CoachDashboard tour | Baixa prioridade. Eduardo conhece o sistema. |

---

## Pendência: "Stats" ou "Stets"?

O usuário disse "Stats" como nome da persona do tour. Mas o AI coach existente
no app já se chama **"Stets"**. Podem ser o mesmo (erro de digitação/voz) ou
podem ser dois nomes diferentes intencionalmente.

**Ação antes de usar:** confirme com Eduardo — uma pergunta, resposta rápida:
> "O nome da persona do tour é 'Stats' (diferente do Stets) ou é o mesmo 'Stets'?"

---

## Achados da investigação do código

### IDs do DOM confirmados em App.tsx (podem ser usados como `targetSelector`)

| ID | Elemento | Visível no mobile? |
|---|---|---|
| `#header` | Cabeçalho sticky | ✅ Sim |
| `#stets` | Wrapper do AICoach | ✅ Sim |
| `#tab-gastos-frequentes` | Botão de aba | ✅ Sim |
| `#blocks` | Container das 5 BlockSections | ✅ Sim |
| `#diagnosis` | Componente de diagnóstico | ❌ `hidden lg:block` — desktop only |
| `#summary-section` | Resumo anual | ❌ `hidden lg:block` — desktop only |

**Regra:** nunca referenciar `#diagnosis` ou `#summary-section` em passos do
tour que rodem no mobile/nativo.

### `isNativeApp` está duplicado no App.tsx
Linhas 31 e 55 do App.tsx definem `isNativeApp` via
`window.Capacitor?.isNativePlatform?.()`. O plano prevê centralizar num hook
`usePlatform()` em `lib/onboarding/platform.ts`. Fazer essa refatoração como
parte da fase de Fundação, não como pré-requisito isolado.

### Lógica atual de controle do onboarding (App.tsx)

```typescript
// Wizard (coleta de dados) — só web, clientes sem coach e sem dados
const [showOnboarding, setShowOnboarding] = useState(false);
// linha 258: onboarding_done_${user.id} controla se mostra

// Tutorial estático — todo mundo que não passou pelo wizard
const [showTutorial, setShowTutorial] = useState(
  () => localStorage.getItem('tutorial_completed') !== 'true'
);

// Render (linha 985–992):
{showOnboarding && <OnboardingWizard ... />}
{!showOnboarding && showTutorial && <OnboardingTutorial ... />}
```

Quando o wizard completa (linha 555–556), salva AMBAS as chaves:
`onboarding_done_${user.id}` e `tutorial_completed` — então quem passa pelo
wizard nunca vê o tutorial estático depois.

### Componentes existentes a preservar/substituir

| Componente | Destino |
|---|---|
| `OnboardingWizard.tsx` | MANTER — portar para nativo |
| `OnboardingTutorial.tsx` | SUBSTITUIR pelo novo tour interativo |

---

## Referência visual (prompt de origem do sistema)

O sistema foi inspirado no prompt de onboarding do ClickMax/Max AI. Princípios
que devem ser mantidos na implementação do Kashim:

- Spotlight real recortado sobre o elemento vivo da tela (não ícone genérico)
- Overlay escurecido com apenas o elemento atual em destaque
- Popup inteligente com reposicionamento automático (nunca sai da tela)
- Continuidade entre telas (tour não reinicia ao navegar de aba)
- Progresso navegável (etapa X de Y, voltar/avançar/pular)
- Botão de ajuda global visível em todas as telas
- IA oferecendo executar a tarefa automaticamente ("Quer que eu faça isso pra você?")
- Pedagogia adulta: problema → benefício → caso real → demo → prática → IA
- Modo exploração livre (qualquer tela, a qualquer momento)
- Estado persistido (retomar exatamente onde parou)
- Em mobile: slider inferior fixo no lugar de popup flutuante

---

## Fases de execução (confirmadas — não alterar a ordem)

```
Fase 1 — Fundação
  lib/onboarding/types.ts
  lib/onboarding/engine.ts
  lib/onboarding/platform.ts   (hook usePlatform — substitui as 2 duplicatas)
  lib/onboarding/persistence.ts
  Tabela Supabase: onboarding_progress

Fase 2 — P0: Wizard no nativo
  Portar OnboardingWizard.tsx para funcionar no app iOS (Capacitor)

Fase 3 — P0: Tour aba Plano
  components/onboarding/TourOverlay.tsx
  components/onboarding/TourCard.tsx
  lib/onboarding/content/plano.ts
  Substitui OnboardingTutorial.tsx

Fase 4 — P0: Tour Gastos Frequentes
  lib/onboarding/content/gastosFrequentes.ts

Fase 5 — P1: Metas, Desempenho, Configurações
  lib/onboarding/content/metas.ts
  lib/onboarding/content/desempenho.ts
  lib/onboarding/content/configuracoes.ts

Fase 6 — P2: Infraestrutura de ajuda
  components/onboarding/HelpButton.tsx   (visível em todas as telas)
  components/onboarding/ExploreMode.tsx  (modo exploração livre)

Fase 7 — Polish
  Micro-interações, responsividade mobile, QA web + nativo
```

---

## Regras de deploy (nunca esquecer)

```bash
git add -A && git commit -m "tipo: descrição" && git push && npx vercel --prod
```

- Env vars: SEMPRE `npx vercel env add NOME` no terminal — NUNCA pelo dashboard Vercel
- API functions: nunca usar imports locais compartilhados em `api/` (Vercel não empacota)
- App nativo (Capacitor): mudanças de frontend não precisam de novo build no Codemagic —
  só `npx vercel --prod` já funciona (o app carrega `https://app.kashim.com.br`)

---

## Arquivos de referência neste projeto

```
docs/onboarding-audit.md   ← auditoria completa do codebase (leia depois deste)
docs/onboarding-plan.md    ← plano técnico detalhado (leia por último)
```
