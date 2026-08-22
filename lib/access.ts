export type AccessMode = 'coach' | 'paid' | 'trial' | 'expired';

export interface AccessInfo {
  mode: AccessMode;
  hasAccess: boolean;
  endsAt: Date | null;
  daysLeft: number | null;
}

// Regra de trial:
// - Coach ativo → acesso ilimitado (mode: 'coach')
// - Coaching encerrado → 5 meses de grace period a partir do fim do coaching
// - Cadastro espontâneo (sem coach) → 30 dias de trial a partir do created_at
export const TRIAL_MONTHS = 5;
export const TRIAL_DAYS_SELF = 30;

// Compat: nome antigo ainda importado por api/admin-metrics.ts.
export const TRIAL_MONTHS_COACH_CLIENT = TRIAL_MONTHS;

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function daysUntil(target: Date): number {
  const ms = target.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

/**
 * Determina acesso do usuário sem gravar nada no banco.
 *
 * Ordem de verificação:
 * 1. Coach ativo (hasActiveCoach) → acesso ilimitado
 * 2. Assinatura paga vigente → acesso pago
 * 3. Cliente da consultoria (isCoachClient):
 *    - Trial = 5 meses a partir de quando o coaching TERMINOU (coachingEndsAt)
 *    - Se coaching nunca teve data de fim (legacy) → 5 meses a partir do created_at
 *    - Fallback: se não tiver nem coachingEndsAt nem created_at → acesso liberado
 * 4. Cadastro espontâneo → 30 dias a partir do created_at
 * 5. Expirado
 */
export function computeAccess(params: {
  createdAt?: string | null;
  subscriptionStatus?: string | null;
  subscriptionExpiresAt?: string | null;
  hasActiveCoach?: boolean;
  /** true se o household tem (ou já teve) coach_access — cliente da consultoria */
  isCoachClient?: boolean;
  /** Data em que o coaching encerrou (coaching_ends_at da API). null = ainda ativo ou sem data. */
  coachingEndsAt?: string | null;
  /** Primeiro acesso REAL do cliente. É daqui que os 5 meses passam a contar. */
  firstAccessAt?: string | null;
  /** Reativação manual do coach. Data no futuro libera, venha o que vier. */
  accessUntil?: string | null;
}): AccessInfo {
  const now = Date.now();

  // 0. Reativação manual do coach vence tudo — é decisão explícita dele.
  if (params.accessUntil) {
    const until = new Date(params.accessUntil);
    if (until.getTime() > now) {
      return { mode: 'trial', hasAccess: true, endsAt: until, daysLeft: daysUntil(until) };
    }
  }

  // 1. Coach ativo NÃO dá mais acesso ilimitado.
  //
  // Regra atual (Eduardo, 2026-08-12): o relógio de 5 meses começa no PRIMEIRO
  // ACESSO do cliente e vale mesmo com a consultoria em andamento. Vencido o
  // prazo sem o coach postergar, bloqueia. Antes, `approved` liberava para
  // sempre e o prazo só passava a valer depois da revogação.
  //
  // O que protege contra o incidente de 2026-08-07 (clientes ativos derrubados
  // por data velha) não é mais "nunca bloquear", e sim a data ser confiável:
  // `first_access_at` é carimbado quando o cliente abre o app, não herdado da
  // criação do perfil. E o coach tem o botão Reativar no painel.

  // 2. Assinatura paga vigente
  if (params.subscriptionStatus === 'active' && params.subscriptionExpiresAt) {
    const exp = new Date(params.subscriptionExpiresAt);
    if (exp.getTime() > now) {
      return { mode: 'paid', hasAccess: true, endsAt: exp, daysLeft: daysUntil(exp) };
    }
  }

  // 3. Cliente da consultoria (tem ou já teve coach_access).
  //
  // NUNCA bloqueia automaticamente. Quem encerra o vínculo é o coach, revogando
  // o acesso no painel — e mesmo depois de revogado o cliente ganha 5 meses de
  // grace period. Bloquear por data aqui derrubava clientes ativos da
  // consultoria (bug real 2026-08-07): coaching_ends_at é gravado uma única vez
  // na criação do perfil e fica no passado para qualquer cliente com mais de 5
  // meses de casa.
  if (params.isCoachClient) {
    // O relógio conta do PRIMEIRO ACESSO. `coachingEndsAt` e `createdAt` marcam
    // quando o coach criou o perfil — perfil criado em janeiro e acessado em
    // junho já nascia com metade do prazo gasto.
    const graceFrom = params.firstAccessAt ?? params.coachingEndsAt ?? params.createdAt ?? null;

    // Sem nenhuma data não há relógio para contar. Libera: é cliente novo cujo
    // carimbo de primeiro acesso ainda não gravou.
    if (!graceFrom) return { mode: 'trial', hasAccess: true, endsAt: null, daysLeft: null };

    const trialEnd = addMonths(new Date(graceFrom), TRIAL_MONTHS);
    if (trialEnd.getTime() > now) {
      return { mode: 'trial', hasAccess: true, endsAt: trialEnd, daysLeft: daysUntil(trialEnd) };
    }

    // Prazo vencido e o coach não postergou → bloqueia até regularizar.
    return { mode: 'expired', hasAccess: false, endsAt: trialEnd, daysLeft: 0 };
  }

  // 4. Cadastro espontâneo: 30 dias a partir do created_at
  if (params.createdAt) {
    const trialEnd = addDays(new Date(params.createdAt), TRIAL_DAYS_SELF);
    if (trialEnd.getTime() > now) {
      return { mode: 'trial', hasAccess: true, endsAt: trialEnd, daysLeft: daysUntil(trialEnd) };
    }
  }

  return { mode: 'expired', hasAccess: false, endsAt: null, daysLeft: 0 };
}
