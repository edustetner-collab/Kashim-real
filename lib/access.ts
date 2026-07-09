export type AccessMode = 'coach' | 'paid' | 'trial' | 'expired';

export interface AccessInfo {
  mode: AccessMode;
  hasAccess: boolean;
  endsAt: Date | null;
  daysLeft: number | null;
}

// Promo de lançamento: toda conta ganha 5 meses grátis a partir da criação.
// Para encerrar a promo no futuro, basta usar PROMO_CUTOFF (contas criadas
// depois dessa data recebem TRIAL_MONTHS_AFTER_PROMO). Quem já entrou mantém.
export const TRIAL_MONTHS = 5;
export const PROMO_CUTOFF: Date | null = null; // ex.: new Date('2026-12-31')
export const TRIAL_MONTHS_AFTER_PROMO = 0;

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function daysUntil(target: Date): number {
  const ms = target.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

/**
 * Determina o acesso do usuário sem gravar nada no banco — o trial é derivado
 * do created_at da conta. Ordem: consultor ativo → assinatura paga → trial de
 * lançamento → expirado.
 */
export function computeAccess(params: {
  createdAt?: string | null;
  subscriptionStatus?: string | null;
  subscriptionExpiresAt?: string | null;
  hasActiveCoach?: boolean;
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
    const months = PROMO_CUTOFF && created > PROMO_CUTOFF ? TRIAL_MONTHS_AFTER_PROMO : TRIAL_MONTHS;
    const trialEnd = addMonths(created, months);
    if (trialEnd.getTime() > now) {
      return { mode: 'trial', hasAccess: true, endsAt: trialEnd, daysLeft: daysUntil(trialEnd) };
    }
  }

  return { mode: 'expired', hasAccess: false, endsAt: null, daysLeft: 0 };
}
