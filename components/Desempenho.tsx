
import React from 'react';
import { SummaryData, FinanceItem, Goal } from '../types';
import { formatCurrency } from '../constants';
import {
  calculateScore, getLevel, getNextLevel, getLevelProgress,
  calculateStreak, checkBadges, BADGE_DEFS, LEVELS,
} from '../lib/gamification';

interface DesempenhoProps {
  summary: SummaryData;
  summaries: SummaryData[];
  items: FinanceItem[];
  goals: Goal[];
}

interface Category {
  label: string;
  icon: string;
  actual: number;
  ideal: number;
  color: string;
  idealColor: string;
  description: string;
}

const Desempenho: React.FC<DesempenhoProps> = ({ summary, summaries, items, goals }) => {
  const { totalIncome, totalFixed, totalVariable, totalLeisure, totalCreditCard, balance } = summary;

  if (!totalIncome || totalIncome <= 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-20">
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 text-center">
          <i className="fas fa-chart-pie text-4xl text-yellow-500/30 mb-4 block"></i>
          <p className="text-zinc-500 text-sm font-bold uppercase tracking-widest">Cadastre suas entradas para ver seu desempenho</p>
        </div>
      </div>
    );
  }

  const score = calculateScore(summary, goals);
  const level = getLevel(score);
  const nextLevel = getNextLevel(score);
  const levelProgress = getLevelProgress(score);
  const streak = calculateStreak(summaries);
  const unlockedBadges = checkBadges(summaries, items, goals);

  const poupanca = Math.max(0, balance);
  const poupancaPct = (poupanca / totalIncome) * 100;
  const fixosPct = ((totalFixed + totalCreditCard) / totalIncome) * 100;
  const variaveisPct = (totalVariable / totalIncome) * 100;
  const lazerPct = (totalLeisure / totalIncome) * 100;

  const categories: Category[] = [
    { label: 'Fixos + Cartão', icon: 'fa-home', actual: fixosPct, ideal: 55, color: 'bg-red-500', idealColor: 'text-red-400', description: 'Moradia, contas fixas e faturas' },
    { label: 'Poupança', icon: 'fa-piggy-bank', actual: poupancaPct, ideal: 20, color: 'bg-green-500', idealColor: 'text-green-400', description: 'O que sobra depois de tudo' },
    { label: 'Lazer', icon: 'fa-star', actual: lazerPct, ideal: 15, color: 'bg-purple-500', idealColor: 'text-purple-400', description: 'Gastos pessoais e entretenimento' },
    { label: 'Variáveis', icon: 'fa-receipt', actual: variaveisPct, ideal: 10, color: 'bg-cyan-500', idealColor: 'text-cyan-400', description: 'Despesas variáveis do mês' },
  ];

  const suggestions: string[] = [];
  const idealFixos = totalIncome * 0.55;
  const actualFixos = totalFixed + totalCreditCard;
  if (actualFixos > idealFixos) {
    suggestions.push(`Seus custos fixos e cartões estão ${formatCurrency(actualFixos - idealFixos)} acima do ideal. Reveja assinaturas ou parcelas que podem ser eliminadas.`);
  }
  const idealLazer = totalIncome * 0.15;
  if (totalLeisure > idealLazer) {
    suggestions.push(`Lazer e gastos pessoais estão ${formatCurrency(totalLeisure - idealLazer)} acima do ideal. Tente limitar a ${formatCurrency(idealLazer)} por mês.`);
  }
  const idealPoupanca = totalIncome * 0.20;
  if (poupanca < idealPoupanca) {
    suggestions.push(`Para guardar 20% da sua renda você precisa de mais ${formatCurrency(idealPoupanca - poupanca)} de sobra. Reduza gastos ou aumente a renda.`);
  }
  if (suggestions.length === 0) {
    suggestions.push('Parabéns! Sua distribuição está dentro dos parâmetros ideais. Continue assim!');
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4 pb-28">

      {/* ── SCORE CARD ───────────────────────────────────────────────── */}
      <div className={`relative rounded-3xl border p-5 mb-5 overflow-hidden ${level.bgClass} ${level.borderClass} shadow-lg ${level.glowClass}`}>
        <div className="absolute top-0 right-0 bottom-0 w-1/2 flex items-center justify-end pr-4 pointer-events-none">
          <span className="text-[80px] opacity-10 select-none">{level.emoji}</span>
        </div>

        <div className="relative z-10 flex items-start justify-between gap-4">
          <div>
            <div className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mb-1">Score Financeiro</div>
            <div className={`text-5xl font-black font-mono leading-none ${level.textClass}`}>{score}</div>
            <div className="text-zinc-400 text-[10px] font-mono mt-0.5">/1000</div>
          </div>

          <div className="text-right">
            <div className={`text-lg font-black uppercase italic tracking-tighter ${level.textClass}`}>
              {level.emoji} {level.name}
            </div>
            {nextLevel && (
              <div className="text-zinc-600 text-[10px] mt-0.5">próximo: {nextLevel.name} ({nextLevel.minScore} pts)</div>
            )}
            {!nextLevel && (
              <div className="text-yellow-500 text-[10px] font-black mt-0.5">Nível máximo atingido!</div>
            )}
          </div>
        </div>

        {/* Level progress bar */}
        {nextLevel && (
          <div className="relative z-10 mt-4">
            <div className="h-2 bg-black/30 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${score >= 900 ? 'bg-yellow-400' : score >= 700 ? 'bg-orange-400' : score >= 500 ? 'bg-cyan-400' : score >= 300 ? 'bg-purple-400' : score >= 150 ? 'bg-blue-400' : 'bg-zinc-500'}`}
                style={{ width: `${levelProgress}%` }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[9px] text-zinc-600 font-mono">{level.minScore}</span>
              <span className="text-[9px] text-zinc-500 font-mono">{levelProgress}% para {nextLevel.name}</span>
              <span className="text-[9px] text-zinc-600 font-mono">{nextLevel.minScore}</span>
            </div>
          </div>
        )}

        {/* Streak */}
        {streak > 0 && (
          <div className="relative z-10 mt-3 flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-orange-500/10 border border-orange-500/20 rounded-xl px-3 py-1.5">
              <span className="text-base">🔥</span>
              <span className="text-orange-400 font-black text-xs uppercase">{streak} {streak === 1 ? 'mês' : 'meses'} no verde</span>
            </div>
          </div>
        )}

        {/* All 6 levels mini bar */}
        <div className="relative z-10 mt-4 flex gap-1">
          {LEVELS.map((l, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className={`h-1 rounded-full w-full transition-all ${score >= l.minScore ? (score >= 900 ? 'bg-yellow-400' : score >= 700 ? 'bg-orange-400' : score >= 500 ? 'bg-cyan-400' : score >= 300 ? 'bg-purple-400' : score >= 150 ? 'bg-blue-400' : 'bg-zinc-500') : 'bg-zinc-800'}`} />
              <span className={`text-[7px] font-black uppercase hidden sm:block ${score >= l.minScore ? l.textClass : 'text-zinc-700'}`}>{l.emoji}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── BADGES ───────────────────────────────────────────────────── */}
      <div className="mb-5">
        <h3 className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mb-3">
          Conquistas — {unlockedBadges.size}/{BADGE_DEFS.length}
        </h3>
        <div className="grid grid-cols-4 gap-2">
          {BADGE_DEFS.map(badge => {
            const unlocked = unlockedBadges.has(badge.id);
            return (
              <div
                key={badge.id}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border text-center transition-all ${
                  unlocked
                    ? 'bg-yellow-500/10 border-yellow-600/30 shadow-sm shadow-yellow-500/10'
                    : 'bg-zinc-900 border-zinc-800 opacity-40 grayscale'
                }`}
                title={badge.description}
              >
                <span className="text-2xl leading-none">{badge.emoji}</span>
                <span className={`text-[8px] font-black uppercase leading-tight ${unlocked ? 'text-yellow-400' : 'text-zinc-600'}`}>{badge.name}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── INCOME REFERENCE ─────────────────────────────────────────── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 mb-4 flex items-center justify-between">
        <div>
          <div className="text-zinc-500 text-[10px] font-black uppercase tracking-widest">Renda do mês</div>
          <div className="text-green-400 font-black font-mono text-lg">{formatCurrency(totalIncome)}</div>
        </div>
        <div className="text-right">
          <div className="text-zinc-500 text-[10px] font-black uppercase tracking-widest">Comprometido</div>
          <div className="text-red-400 font-black font-mono text-lg">{formatCurrency(summary.totalCost)}</div>
        </div>
      </div>

      {/* ── CATEGORY BARS ────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 mb-6">
        {categories.map((cat) => {
          const actualCapped = Math.min(cat.actual, 100);
          const idealCapped = Math.min(cat.ideal, 100);
          const isOver = cat.actual > cat.ideal + 2;
          const isUnder = cat.actual < cat.ideal - 2 && cat.label === 'Poupança';
          const statusColor = isOver ? 'text-red-400' : isUnder ? 'text-orange-400' : 'text-green-400';
          const statusIcon = isOver ? 'fa-arrow-up' : isUnder ? 'fa-arrow-down' : 'fa-check';

          return (
            <div key={cat.label} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${cat.color}/10`}>
                    <i className={`fas ${cat.icon} text-sm ${cat.idealColor}`}></i>
                  </div>
                  <div>
                    <div className="text-white font-black text-sm">{cat.label}</div>
                    <div className="text-zinc-600 text-[10px]">{cat.description}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`font-black text-sm font-mono ${statusColor}`}>
                    <i className={`fas ${statusIcon} mr-1 text-[10px]`}></i>
                    {cat.actual.toFixed(0)}%
                  </div>
                  <div className="text-zinc-600 text-[10px]">ideal: {cat.ideal}%</div>
                </div>
              </div>
              <div className="relative h-5 bg-zinc-800 rounded-full overflow-hidden">
                <div className="absolute top-0 bottom-0 w-0.5 bg-white/30 z-10" style={{ left: `${idealCapped}%` }} />
                <div
                  className={`h-full rounded-full transition-all duration-700 ${isOver ? 'bg-red-500' : isUnder ? 'bg-orange-500' : cat.color}`}
                  style={{ width: `${Math.max(actualCapped, 0.5)}%` }}
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-zinc-600 text-[9px] font-mono">0%</span>
                <span className="text-zinc-500 text-[9px] font-mono">Ideal: {cat.ideal}% ({formatCurrency(totalIncome * cat.ideal / 100)})</span>
                <span className="text-zinc-600 text-[9px] font-mono">100%</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── SUGGESTIONS ──────────────────────────────────────────────── */}
      <div className="bg-zinc-900 border border-yellow-600/20 rounded-2xl p-4">
        <h3 className="text-yellow-500 font-black text-xs uppercase tracking-widest mb-3 flex items-center gap-2">
          <i className="fas fa-lightbulb"></i> Diagnóstico
        </h3>
        <div className="flex flex-col gap-2">
          {suggestions.map((s, i) => (
            <div key={i} className="flex items-start gap-2 bg-zinc-800/50 rounded-xl p-3">
              <i className={`fas ${suggestions.length === 1 && i === 0 ? 'fa-trophy text-yellow-500' : 'fa-exclamation-circle text-orange-400'} text-xs mt-0.5 shrink-0`}></i>
              <p className="text-zinc-300 text-xs leading-relaxed">{s}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center gap-4 justify-center">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 bg-white/30"></div>
          <span className="text-zinc-600 text-[9px] uppercase tracking-widest">Meta ideal</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-green-500/50"></div>
          <span className="text-zinc-600 text-[9px] uppercase tracking-widest">Dentro do ideal</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-red-500/50"></div>
          <span className="text-zinc-600 text-[9px] uppercase tracking-widest">Acima do ideal</span>
        </div>
      </div>
    </div>
  );
};

export default Desempenho;
