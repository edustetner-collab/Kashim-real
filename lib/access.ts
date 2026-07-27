export type AccessMode = 'coach' | 'paid' | 'trial' | 'expired';

export interface AccessInfo {
  mode: AccessMode;
  hasAccess: boolean;
  endsAt: Date | null;
  daysLeft: number | null;
}

// Regra de trial (decisão Eduardo, 2026-07-27):
// TODO MUNDO tem 5 meses grátis desde a criação da conta — não importa se o
// perfil foi criado pelo consultor ou se a pessoa entrou sozinha pelo site.
// (Antes havia distinção: 5 meses p/ cliente de consultoria, 30 dias p/
// cadastro espontâneo. Unificado em 5 meses para todos.)
export const TRIAL_MONTHS = 5;

// Compat: nomes antigos ainda importados por api/admin-metrics.ts.
export const TRIAL_MONTHS_COACH_CLIENT = TRIAL_MONTHS;

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
 * do created_at da conta. Ordem: consultor ativo → assinatura paga → trial
 * (5 meses p/ cliente de consultoria, 30 dias p/ cadastro espontâneo) → expirado.
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
    const trialEnd = addMonths(created, TRIAL_MONTHS);
    if (trialEnd.getTime() > now) {
      return { mode: 'trial', hasAccess: true, endsAt: trialEnd, daysLeft: daysUntil(trialEnd) };
    }
  }

  return { mode: 'expired', hasAccess: false, endsAt: null, daysLeft: 0 };
}
