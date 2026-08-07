export type AccessMode = 'coach' | 'paid' | 'trial' | 'expired';

export interface AccessInfo {
  mode: AccessMode;
  hasAccess: boolean;
  endsAt: Date | null;
  daysLeft: number | null;
}

// Regra de trial (decisão Eduardo, 2026-08-07):
// - Cliente da CONSULTORIA (perfil criado pelo Eduardo/assistente — tem
//   coach_access): 5 meses grátis.
// - Cadastro ESPONTÂNEO (pessoa entrou sozinha pelo site/app): 30 dias grátis.
// (Reverte a unificação de 27/07; volta a diferenciar, agora que o produto vai
// ser vendido ao público — só os clientes do Eduardo ganham os 5 meses.)
export const TRIAL_MONTHS = 5;      // cliente da consultoria (coach_access)
export const TRIAL_DAYS_SELF = 30;  // cadastro espontâneo

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
 * Determina o acesso do usuário sem gravar nada no banco — o trial é derivado
 * do created_at da conta. Ordem: consultor ativo → assinatura paga → trial
 * (5 meses se isCoachClient; 30 dias se cadastro espontâneo) → expirado.
 */
export function computeAccess(params: {
  createdAt?: string | null;
  subscriptionStatus?: string | null;
  subscriptionExpiresAt?: string | null;
  hasActiveCoach?: boolean;
  /** true se o household tem (ou já teve) coach_access aprovado — cliente da consultoria */
  isCoachClient?: boolean;
}): AccessInfo {
  const now = Date.now();

  if (params.hasActiveCoach) {
    return { mode: 'coach', hasAccess: true, endsAt: null, daysLeft: null };
  }

  if (params.subscriptionStatus === 'active' && params.subscriptionExpiresAt) {
    const exp = new Date(params.subscriptionExpiresAt);
    if (exp.getTime() > now) {
      return { mode: 'paid', hasAccess: true, endsAt: exp, daysLeft: daysUntil(exp) };
    }
  }

  if (params.createdAt) {
    const created = new Date(params.createdAt);
    const trialEnd = params.isCoachClient
      ? addMonths(created, TRIAL_MONTHS)
      : addDays(created, TRIAL_DAYS_SELF);
    if (trialEnd.getTime() > now) {
      return { mode: 'trial', hasAccess: true, endsAt: trialEnd, daysLeft: daysUntil(trialEnd) };
    }
  }

  return { mode: 'expired', hasAccess: false, endsAt: null, daysLeft: 0 };
}
