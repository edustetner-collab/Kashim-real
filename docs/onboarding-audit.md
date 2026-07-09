# Auditoria do Kashim — Base de conhecimento para o Onboarding Interativo

> Documento gerado a partir de leitura completa do código-fonte (App.tsx, todos os
> componentes, lib/, api/) em 2026-07-09. Objetivo: servir de referência confiável
> para o desenho e execução do novo sistema de onboarding, independente de qual
> modelo/sessão for usado para executar.

## 1. O que é o Kashim

App de organização financeira pessoal com coaching, método "RICO nessa vida" do
consultor Eduardo Stetner. Já publicado na Apple Store, em uso real (produção).

**Stack:**
- Frontend: React 19 + Vite + TypeScript + Tailwind (utility classes inline, sem CSS modules)
- Mobile nativo: Capacitor (iOS/Android) — o app nativo é um WebView que carrega
  `https://app.kashim.com.br`, não é uma UI nativa separada. Mesmo código-fonte roda
  em ambos os acessos.
- Auth: Clerk (`@clerk/clerk-react`) — login por e-mail/senha, código, social login
  (Google/Apple) e magic link (`sign_in_token`)
- Dados: Supabase (Postgres + RLS), autenticado via JWT do Clerk (template `supabase`)
- IA: Anthropic Claude, endpoint próprio `/api/stets` (coach de texto/voz/foto chamado "Stets")
- Pagamentos: Pagar.me (checkout PIX + cartão), webhook em `/api/pagarme-webhook`
- E-mail: Resend
- Erros: Sentry
- Deploy: Vercel (funções serverless em `/api/*.ts`)

## 2. Modelo de dados (types.ts)

- `household`: unidade de conta (família/casal), até 2 membros
- `FinanceItem`: lançamento com `category` (Renda / Cartão de Crédito / Contas Fixas /
  Contas Variáveis / Lazer e Gastos Pessoais), `values[12]` (um valor por mês),
  `paidStatus[12]`, `partialExpenses` (gastos parciais rastreados por mês),
  `linkedCardId`/`linkType` (Recorrente/Parcelado/Débito/À Vista), `closingDay`/`dueDay`
  (fatura de cartão)
- `Goal`: metas de poupança (título, emoji, valor alvo, valor atual, prazo)
- `NotificationPrefs`: e-mail semanal, push, limite de alerta %, dia de lembrete

**Regra de negócio central (percentuais ideais):** Fixos ≤55% da renda, Lazer ≤15%,
Poupança ≥20%.

## 3. Telas / navegação principal (App.tsx)

Header + 4 abas (bottom tab bar no mobile, tabs no desktop):

1. **Plano (Gastos Mensais)** — tela padrão. Contém:
   - `AICoach` ("Stets"): chat por texto/voz/foto que lança despesas automaticamente
   - `Diagnosis` (só desktop): 3 cards de diagnóstico (fixos/lazer/saldo)
   - 5 `BlockSection`: Entradas, Faturas de Cartão, Contas Fixas, Contas Variáveis, Lazer
   - Tabela de compilação financeira anual (desktop) + gestão de ciclo (reprojetar plano)
   - Cards de resumo mobile (Acumulado, Entradas, Gastos, Sobra/Falta) + navegador de mês
2. **Gastos Frequentes (TetoGastos)** — cards de "teto" por categoria/item, view mensal
   com histórico, parcelamento, drag-reorder (long-press no mobile)
3. **Metas** — metas de poupança com anel de progresso, contribuições
4. **Desempenho** — gamificação: score 0-1000, 6 níveis (Fase Despertar → RICO Nessa
   Vida), 8 badges, streak de meses positivos, barras de categoria vs ideal, sugestões

**Outras superfícies (modais/telas secundárias):**
- `CoachDashboard` — home dos consultores/assistentes (admins), lista de clientes,
  criar perfil rascunho, ativar cliente (cria conta Clerk + libera 5 meses de coaching
  grátis + gera magic link), gerar novo link de acesso, privacidade, excluir
- `ClientSettings` — 4 abas: Conta (foto, senha, exportar PDF, excluir conta),
  Avisos (notificações), Casal (`InvitePartner`), Plano/assinatura (**aba oculta no
  app nativo**)
- `ConsultorSettings` — perfil do consultor + gestão de equipe de assistentes
- `SubscriptionGate` — paywall quando acesso do coach expira sem assinatura ativa
  (**nunca aparece no app nativo** — regra Apple 3.1.1)
- `ExpenseSheet` — bottom sheet de lançamento de despesa (categoria → item → valor/
  pagamento → parcelas/cartão)
- `MondayQuote` — modal de frase motivacional semanal (toda segunda-feira), com
  geração de card compartilhável para Instagram (html2canvas)

## 4. Onboarding hoje (o que já existe — ponto de partida, não descartar conteúdo)

### 4.1 `OnboardingTutorial.tsx`
Tutorial estático de 5 passos, modal central (não é spotlight/highlight real dos
elementos — é ícone + texto genérico), mostrado uma vez via `localStorage.tutorial_completed`:
1. Boas-vindas
2. Apresenta o Stets (AI coach)
3. Botão de replicar valor (ícone amarelo circular)
4. Aba "Gastos Frequentes"
5. Resumo/Acumulado

Sem: progresso persistente entre sessões, sem adaptação a mobile vs desktop, sem
IA oferecendo executar a tarefa, sem cobertura de Metas/Desempenho/Configurações/
Convites/Assinatura.

### 4.2 `OnboardingWizard.tsx`
Wizard sequencial (não é tutorial de UI, é coleta de dados) — só aparece para
clientes **sem coach e sem dados ainda** (web only, atualmente). ~24 perguntas de
valor (renda + despesas fixas padrão), com "pular"/"não pago", item extra livre,
sugestão de lazer (15% da renda), resumo final. Preenche o plano automaticamente.
É o melhor exemplo hoje de "aprender fazendo" — mas é sobre captura de dados, não
sobre ensinar a navegar o app.

**NOVO REQUISITO:** este wizard precisa ser portado para o app nativo (iOS).
Atualmente o nativo abre o app sem nenhuma coleta de dados.

### 4.3 Ajuda contextual pontual (já existe, espalhada)
Cada `BlockSection` tem um ícone "?" que abre um modal estático explicando a
categoria (proposta de valor + dica). Já existe conteúdo de qualidade aqui (ex:
explicação de fatura de cartão, contas fixas vs variáveis) — **reaproveitar esse
texto ao migrar para o novo onboarding**, não reescrever do zero.

### 4.4 Gaps identificados
- Sem spotlight real (highlight recortado sobre o elemento vivo da tela)
- Sem progresso "Etapa X de Y" navegável (voltar/avançar/pular passo a passo)
- Sem continuidade entre telas/abas (o tutorial atual só cobre a aba "Plano")
- Sem diferenciação por tipo de usuário
- Sem "quer que a IA faça isso por você" em nenhum ponto
- Sem cobertura de: Metas, Desempenho, TetoGastos, Configurações, Convite de parceiro
- Estado dos flags espalhado em várias chaves de localStorage soltas

## 5. Diferenças Web vs App Nativo (crítico para o onboarding)

Detecção em runtime: `window.Capacitor?.isNativePlatform?.()` (duplicada hoje —
ver seção 7).

| Aspecto | Web (app.kashim.com.br) | App nativo (iOS via Capacitor) |
|---|---|---|
| Assinatura/pagamento | Fluxo completo de checkout Pagar.me | **Totalmente oculto** — regra Apple 3.1.1 |
| Aba "Plano" em Configurações | Visível | Oculta |
| `SubscriptionGate` (paywall) | Pode aparecer | Nunca aparece |
| Login social (Google/Apple) | Botões visíveis | Ocultos (`socialButtonsBlock: 'none'`) |
| Reconhecimento de voz (Stets) | Web Speech API | Plugin `@capacitor-community/speech-recognition` |
| Wizard de coleta de dados | ✅ Existe | ❌ Não existe — **novo requisito** |

**Implicação direta para o onboarding:** qualquer passo do tour que mencione
assinatura, upgrade de plano ou pagamento precisa ser invisível no nativo.
O parâmetro `platform: 'web'` no `TourStep` resolve isso automaticamente.

## 6. Lógica de negócio relevante para o conteúdo do onboarding

- **Dedução de fatura de cartão:** gastos rastreados em "Gastos Frequentes" vinculados
  a um cartão são automaticamente abatidos da fatura do mês seguinte para não contar
  duas vezes — conceito que confunde usuários novos, merece explicação dedicada
- **Contas Fixas vs Variáveis:** critério é recorrência (fixa = sem fim previsto ou
  parcelado em +18x; variável = pontual ou parcelado em -12x)
- **Score/gamificação:** 0-1000 pontos com pesos (poupança 300, fixos+cartão 200,
  lazer 150, variáveis 100, saldo positivo 100, metas 150) — bom material para
  "por que essa tela existe / o que ela recompensa"
- **Coach vs Cliente:** consultor cria perfil rascunho → ativa (gera conta + 5 meses
  grátis de acompanhamento) → cliente usa o app normalmente

## 7. Onde plugar o novo onboarding (pontos de entrada no código)

- `App.tsx` decide o que mostrar: `showOnboarding` (wizard) → `showTutorial`
  (tutorial simples) → app normal. O novo sistema substitui `showTutorial` e
  envolve `showOnboarding`.
- `isNativeApp` está duplicado nas linhas 31 e 55 do App.tsx — centralizar no
  hook `usePlatform()` durante a fase de Fundação.
- IDs de elementos existentes para spotlight: `#header`, `#stets`, `#diagnosis`,
  `#tab-gastos-frequentes`, `#blocks`, `#summary-section`. Ver tabela completa
  no `onboarding-handoff.md`.

## 8. Recomendações de escopo (confirmadas)

1. Reaproveitar todo o conteúdo textual já existente (tooltips de `BlockSection`,
   textos do `OnboardingWizard`) como ponto de partida do conteúdo dos tours.
2. Centralizar a detecção de plataforma (`isNativeApp`) num hook único.
3. Novo sistema deve ser um módulo desacoplado (`lib/onboarding/` +
   `components/onboarding/`), config-driven.
4. Progresso do onboarding deve migrar das chaves soltas de localStorage para
   uma tabela no Supabase (`onboarding_progress`).
