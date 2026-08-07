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
}): AccessInfo {
  const now = Date.now();

  // 1. Coach ativo: acesso ilimitado
  if (params.hasActiveCoach) {
    return { mode: 'coach', hasAccess: true, endsAt: null, daysLeft: null };
  }

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
    const graceFrom = params.coachingEndsAt ?? params.createdAt ?? null;
    if (graceFrom) {
      const trialEnd = addMonths(new Date(graceFrom), TRIAL_MONTHS);
      if (trialEnd.getTime() > now) {
        return { mode: 'trial', hasAccess: true, endsAt: trialEnd, daysLeft: daysUntil(trialEnd) };
      }
    }
    // Datas vencidas ou ausentes: mantém o acesso liberado, sem contagem
    // regressiva na tela. Cliente da consultoria só perde acesso quando o coach
    // revoga (aí hasCoach=false e isCoachClient continua true → 5 meses de grace
    // contados da revogação).
    return { mode: 'trial', hasAccess: true, endsAt: null, daysLeft: null };
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
