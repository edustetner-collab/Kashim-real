import { SummaryData, FinanceItem, Goal } from '../types';

export interface Level {
  name: string;
  minScore: number;
  emoji: string;
  textClass: string;
  bgClass: string;
  borderClass: string;
  glowClass: string;
}

export const LEVELS: Level[] = [
  {
    name: 'Fase Despertar',
    minScore: 0,
    emoji: '🌱',
    textClass: 'text-zinc-400',
    bgClass: 'bg-zinc-800',
    borderClass: 'border-zinc-700',
    glowClass: '',
  },
  {
    name: 'Aprendiz',
    minScore: 150,
    emoji: '📘',
    textClass: 'text-blue-400',
    bgClass: 'bg-blue-900/20',
    borderClass: 'border-blue-800/50',
    glowClass: 'shadow-blue-500/20',
  },
  {
    name: 'Guardião',
    minScore: 300,
    emoji: '🛡️',
    textClass: 'text-purple-400',
    bgClass: 'bg-purple-900/20',
    borderClass: 'border-purple-800/50',
    glowClass: 'shadow-purple-500/20',
  },
  {
    name: 'Estrategista',
    minScore: 500,
    emoji: '♟️',
    textClass: 'text-cyan-400',
    bgClass: 'bg-cyan-900/20',
    borderClass: 'border-cyan-800/50',
    glowClass: 'shadow-cyan-500/20',
  },
  {
    name: 'Mestre',
    minScore: 700,
    emoji: '👑',
    textClass: 'text-orange-400',
    bgClass: 'bg-orange-900/20',
    borderClass: 'border-orange-800/50',
    glowClass: 'shadow-orange-500/20',
  },
  {
    name: 'RICO Nessa Vida',
    minScore: 900,
    emoji: '⭐',
    textClass: 'text-yellow-400',
    bgClass: 'bg-yellow-900/20',
    borderClass: 'border-yellow-700/50',
    glowClass: 'shadow-yellow-500/30',
  },
];

export interface BadgeDef {
  id: string;
  name: string;
  description: string;
  emoji: string;
}

export const BADGE_DEFS: BadgeDef[] = [
  { id: 'primeiro_lancamento', name: 'Primeiro Passo', description: 'Primeiro gasto registrado', emoji: '🚀' },
  { id: 'mes_verde', name: 'Mês Verde', description: 'Primeiro mês com saldo positivo', emoji: '🌱' },
  { id: 'economista', name: 'Economista', description: 'Poupança ≥ 20% da renda', emoji: '💰' },
  { id: 'fixos_ok', name: 'Fixos Controlados', description: 'Custos fixos ≤ 55% da renda', emoji: '🏰' },
  { id: 'lazer_ok', name: 'Lazer Equilibrado', description: 'Lazer dentro do ideal (≤15%)', emoji: '🎭' },
  { id: 'trio_rico', name: 'Trio Rico', description: '3 meses seguidos no positivo', emoji: '🔥' },
  { id: 'semestre_rico', name: 'Semestre Rico', description: '6 meses seguidos no positivo', emoji: '⚡' },
  { id: 'meta_conquistada', name: 'Caçador de Metas', description: 'Primeira meta completada', emoji: '🏆' },
];

export function calculateScore(summary: SummaryData, goals: Goal[]): number {
  if (!summary.totalIncome || summary.totalIncome <= 0) return 0;

  const { totalIncome, totalFixed, totalCreditCard, totalLeisure, totalVariable, balance } = summary;
  let score = 0;

  // Poupança (max 300)
  const poupancaRate = Math.max(0, balance) / totalIncome;
  score += Math.min(300, (poupancaRate / 0.20) * 300);

  // Fixos + Cartão (max 200)
  const fixosRate = (totalFixed + totalCreditCard) / totalIncome;
  if (fixosRate <= 0.55) score += 200;
  else if (fixosRate <= 0.65) score += 100;

  // Lazer (max 150)
  const lazerRate = totalLeisure / totalIncome;
  if (lazerRate <= 0.15) score += 150;
  else if (lazerRate <= 0.22) score += 75;

  // Variáveis (max 100)
  const varRate = totalVariable / totalIncome;
  if (varRate <= 0.10) score += 100;
  else if (varRate <= 0.15) score += 50;

  // Balanço positivo (max 100)
  if (balance > 0) score += 100;

  // Metas completadas (max 150)
  const completedGoals = goals.filter(g => g.currentAmount >= g.targetAmount && g.targetAmount > 0);
  score += Math.min(150, completedGoals.length * 50);

  return Math.round(Math.min(1000, score));
}

export function getLevel(score: number): Level {
  let level = LEVELS[0];
  for (const l of LEVELS) {
    if (score >= l.minScore) level = l;
  }
  return level;
}

export function getNextLevel(score: number): Level | null {
  for (let i = 0; i < LEVELS.length; i++) {
    if (LEVELS[i].minScore > score) return LEVELS[i];
  }
  return null;
}

export function getLevelProgress(score: number): number {
  const current = getLevel(score);
  const next = getNextLevel(score);
  if (!next) return 100;
  const range = next.minScore - current.minScore;
  const progress = score - current.minScore;
  return Math.round((progress / range) * 100);
}

export function calculateStreak(summaries: SummaryData[]): number {
  let streak = 0;
  for (const s of summaries) {
    if (s.balance > 0) streak++;
    else break;
  }
  return streak;
}

export function checkBadges(
  summaries: SummaryData[],
  items: FinanceItem[],
  goals: Goal[]
): Set<string> {
  const unlocked = new Set<string>();
  if (!summaries.length || !summaries[0].totalIncome) return unlocked;

  const hasAnyExpense = items.some(
    i => i.values.some(v => v > 0) || Object.keys(i.partialExpenses ?? {}).length > 0
  );
  if (hasAnyExpense) unlocked.add('primeiro_lancamento');

  if (summaries.some(s => s.balance > 0 && s.totalIncome > 0 && s.totalCost > 0)) unlocked.add('mes_verde');

  const current = summaries[0];
  if (current.totalIncome > 0) {
    const poupancaRate = Math.max(0, current.balance) / current.totalIncome;
    if (poupancaRate >= 0.20) unlocked.add('economista');

    const fixosRate = (current.totalFixed + current.totalCreditCard) / current.totalIncome;
    if (fixosRate <= 0.55) unlocked.add('fixos_ok');

    const lazerRate = current.totalLeisure / current.totalIncome;
    if (lazerRate <= 0.15 && current.totalLeisure > 0) unlocked.add('lazer_ok');
  }

  const streak = calculateStreak(summaries);
  if (streak >= 3) unlocked.add('trio_rico');
  if (streak >= 6) unlocked.add('semestre_rico');

  if (goals.some(g => g.targetAmount > 0 && g.currentAmount >= g.targetAmount)) {
    unlocked.add('meta_conquistada');
  }

  return unlocked;
}
