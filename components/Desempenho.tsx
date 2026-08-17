
import React from 'react';
import { SummaryData, FinanceItem, Goal } from '../types';
import { formatCurrency, IDEAL_LIMITS } from '../constants';
import { getPlanTotals, toIncomePct } from '../lib/planTotals';
import {
  calculateScore, getLevel, getNextLevel, getLevelProgress,
  calculateStreak, checkBadges, BADGE_DEFS, LEVELS,
} from '../lib/gamification';
import ScoreRing from './ScoreRing';
import { useTilt } from '../lib/useTilt';

interface DesempenhoProps {
  summary: SummaryData;
  summaries: SummaryData[];
  items: FinanceItem[];
  goals: Goal[];
  monthIdx: number;
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

const Desempenho: React.FC<DesempenhoProps> = ({ summary, summaries, items, goals, monthIdx }) => {
  const { totalIncome, balance } = summary;
  const scoreTilt = useTilt(8);

  if (!totalIncome || totalIncome <= 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-20">
        <div className="bg-white border border-[#e8e8ed] rounded-[22px] p-8 text-center shadow-sm">
          <i className="fas fa-chart-pie text-4xl text-[#aeaeb2] mb-4 block"></i>
          <p className="text-[#6e6e73] text-sm font-bold uppercase tracking-widest">Cadastre suas entradas para ver seu desempenho</p>
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

  // Distribuição por categoria vem do MESMO cálculo da aba Plano (valores
  // brutos do mês). Antes esta tela lia `totalFixed`/`totalLeisure` do summary,
  // que são líquidos — todo gasto no cartão é descontado no mês corrente para
  // não duplicar com a fatura. Serve para saldo, não para distribuição: quem
  // pagava o lazer no cartão via "Lazer 0%", e as fixas do Eduardo apareciam
  // 15% aqui contra 36% no Plano. Ver lib/planTotals.ts.
  const plan = getPlanTotals(items, monthIdx);
  const fixedCoreTotal = plan.fixedCore;
  const educationTotal = plan.education;

  // Sobra continua saindo do saldo oficial do app (líquido, sem dupla
  // contagem da fatura) — é o mesmo número do resumo do mês.
  const poupanca = Math.max(0, balance);
  const poupancaPct = toIncomePct(poupanca, totalIncome);
  const fixedCorePct = toIncomePct(fixedCoreTotal, totalIncome);
  const educationPct = toIncomePct(educationTotal, totalIncome);
  const lazerPct = toIncomePct(plan.leisure, totalIncome);

  const categories: Category[] = [
    { label: 'Contas Fixas', icon: 'fa-home', actual: fixedCorePct, ideal: Math.round(IDEAL_LIMITS.FIXED * 100), color: 'bg-red-500', idealColor: 'text-red-400', description: 'Moradia, contas e despesas fixas' },
    { label: 'Educação', icon: 'fa-graduation-cap', actual: educationPct, ideal: Math.round(IDEAL_LIMITS.EDUCATION * 100), color: 'bg-blue-500', idealColor: 'text-blue-400', description: 'Escola, faculdade, cursos e aprendizado' },
    { label: 'Poupança', icon: 'fa-piggy-bank', actual: poupancaPct, ideal: Math.round(IDEAL_LIMITS.SAVINGS * 100), color: 'bg-green-500', idealColor: 'text-green-400', description: 'O que sobra depois de tudo' },
    { label: 'Lazer', icon: 'fa-star', actual: lazerPct, ideal: Math.round(IDEAL_LIMITS.LEISURE * 100), color: 'bg-purple-500', idealColor: 'text-purple-400', description: 'Gastos pessoais e entretenimento' },
  ];

  const suggestions: string[] = [];
  const idealFixos = totalIncome * IDEAL_LIMITS.FIXED;
  if (fixedCoreTotal > idealFixos) {
    suggestions.push(`Suas contas fixas estão ${formatCurrency(fixedCoreTotal - idealFixos)} acima do ideal. Reveja assinaturas ou despesas que podem ser reduzidas.`);
  }
  const idealEducation = totalIncome * IDEAL_LIMITS.EDUCATION;
  if (educationTotal === 0) {
    suggestions.push(`Nenhum gasto com educação registrado. Considere reservar ${formatCurrency(idealEducation)} (10% da renda) para escola, cursos ou capacitação.`);
  } else if (educationTotal > idealEducation * 1.05) {
    suggestions.push(`Gastos com educação estão ${formatCurrency(educationTotal - idealEducation)} acima do ideal de 10%.`);
  }
  const idealLazer = totalIncome * IDEAL_LIMITS.LEISURE;
  if (plan.leisure > idealLazer) {
    suggestions.push(`Lazer e gastos pessoais estão ${formatCurrency(plan.leisure - idealLazer)} acima do ideal. Tente limitar a ${formatCurrency(idealLazer)} por mês.`);
  }
  const idealPoupanca = totalIncome * IDEAL_LIMITS.SAVINGS;
  if (poupanca < idealPoupanca) {
    suggestions.push(`Para guardar 20% da sua renda você precisa de mais ${formatCurrency(idealPoupanca - poupanca)} de sobra. Reduza gastos ou aumente a renda.`);
  }
  if (suggestions.length === 0) {
    suggestions.push('Parabéns! Sua distribuição está dentro dos parâmetros ideais. Continue assim!');
  }

  return (
    <div className="max-w-2xl mx-auto px-3 pt-4 pb-28">

      {/* ── SCORE CARD (dark hero) ────────────────────────────────────── */}
      <div
        ref={scoreTilt.ref}
        onPointerMove={scoreTilt.onPointerMove}
        onPointerLeave={scoreTilt.onPointerLeave}
        className="relative rounded-[28px] p-5 mb-5 overflow-hidden bg-[#1d1d1f]"
        style={{boxShadow:'0 8px 30px rgba(0,0,0,0.18)', transition:'transform .3s cubic-bezier(.16,1,.3,1)', willChange:'transform'}}
      >
        <div className="absolute top-[-60px] left-[-40px] w-[200px] h-[200px] rounded-full pointer-events-none" style={{background:'radial-gradient(circle,rgba(168,231,22,0.15) 0%,transparent 65%)'}}></div>
        {/* Pointer-following neon glow (decorative) */}
        <div className="absolute inset-0 pointer-events-none z-0" style={{background:'radial-gradient(240px circle at var(--k-gx,50%) var(--k-gy,50%), rgba(168,231,22,0.16), transparent 60%)', transition:'background .2s'}}></div>
        <div className="absolute top-0 right-0 bottom-0 w-1/2 flex items-center justify-end pr-4 pointer-events-none">
          <span className="text-[80px] opacity-10 select-none">{level.emoji}</span>
        </div>

        {/* Empilhado verticalmente (em vez de lado a lado) — nomes de nível longos
            (ex: "RICO Nessa Vida", "Fase Despertar") não cabiam ao lado do anel de
            score em telas estreitas e ficavam cortados pelo overflow-hidden do card. */}
        <div className="relative z-10 flex items-center gap-3">
          <ScoreRing score={score} max={1000} />
          <div className="text-white/35 text-[10px] font-black uppercase tracking-[2px] leading-tight">Score<br/>Financeiro</div>
        </div>

        <div className="relative z-10 mt-3">
          <div className="text-lg font-black uppercase italic tracking-tighter text-[#a8e716] break-words">
            {level.emoji} {level.name}
          </div>
          {nextLevel && (
            <div className="text-white/30 text-[10px] mt-0.5">próximo: {nextLevel.name} ({nextLevel.minScore} pts)</div>
          )}
          {!nextLevel && (
            <div className="text-[#a8e716] text-[10px] font-black mt-0.5">Nível máximo atingido!</div>
          )}
        </div>

        {/* Level progress bar */}
        {nextLevel && (
          <div className="relative z-10 mt-4">
            <div className="k-sweep h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${levelProgress}%`, background:'linear-gradient(90deg,#a8e716,#7ab800)' }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[9px] text-white/25 k-num">{level.minScore}</span>
              <span className="text-[9px] text-white/35 k-num">{levelProgress}% para {nextLevel.name}</span>
              <span className="text-[9px] text-white/25 k-num">{nextLevel.minScore}</span>
            </div>
          </div>
        )}

        {/* Streak */}
        {streak > 0 && (
          <div className="relative z-10 mt-3 flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-orange-500/15 border border-orange-500/25 rounded-xl px-3 py-1.5">
              <span className="text-base k-pulse inline-block">🔥</span>
              <span className="text-orange-400 font-black text-xs uppercase">{streak} {streak === 1 ? 'mês' : 'meses'} no verde</span>
            </div>
          </div>
        )}

        {/* All 6 levels mini bar */}
        <div className="relative z-10 mt-4 flex gap-1">
          {LEVELS.map((l, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className={`h-1 rounded-full w-full transition-all ${score >= l.minScore ? '' : 'bg-white/10'}`}
                style={score >= l.minScore ? {background:'linear-gradient(90deg,#a8e716,#7ab800)'} : {}} />
              <span className={`text-[7px] font-black uppercase hidden sm:block ${score >= l.minScore ? 'text-[#a8e716]' : 'text-white/20'}`}>{l.emoji}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── BADGES ───────────────────────────────────────────────────── */}
      <div className="mb-5">
        <h3 className="text-[#aeaeb2] text-[10px] font-black uppercase tracking-widest mb-3">
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
                    ? 'bg-[#f0fad0] border-[rgba(122,184,0,0.25)] shadow-sm'
                    : 'bg-[#f5f5f7] border-[#e8e8ed] opacity-40 grayscale'
                }`}
                title={badge.description}
              >
                <span className="text-2xl leading-none">{badge.emoji}</span>
                <span className={`text-[8px] font-black uppercase leading-tight ${unlocked ? 'text-[#7ab800]' : 'text-[#aeaeb2]'}`}>{badge.name}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── INCOME REFERENCE ─────────────────────────────────────────── */}
      <div className="bg-white border border-[#e8e8ed] rounded-[20px] p-4 mb-4 flex items-center justify-between shadow-sm">
        <div>
          <div className="text-[#aeaeb2] text-[10px] font-black uppercase tracking-widest">Renda do mês</div>
          <div className="text-[#34c759] font-black k-num text-lg">{formatCurrency(totalIncome)}</div>
        </div>
        <div className="text-right">
          <div className="text-[#aeaeb2] text-[10px] font-black uppercase tracking-widest">Comprometido</div>
          <div className="text-[#ff3b30] font-black k-num text-lg">{formatCurrency(summary.totalCost)}</div>
        </div>
      </div>

      {/* ── CATEGORY BARS ────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 mb-6">
        {categories.map((cat) => {
          const actualCapped = Math.min(cat.actual, 100);
          const idealCapped = Math.min(cat.ideal, 100);
          const isOver = cat.actual > cat.ideal + 2;
          const isUnder = cat.actual < cat.ideal - 2 && (cat.label === 'Poupança' || cat.label === 'Educação');
          const statusColor = isOver ? 'text-[#ff3b30]' : isUnder ? 'text-orange-500' : 'text-[#7ab800]';
          const statusIcon = isOver ? 'fa-arrow-up' : isUnder ? 'fa-arrow-down' : 'fa-check';

          return (
            <div key={cat.label} className="bg-white border border-[#e8e8ed] rounded-[20px] p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="k-icon-wrap">
                    <i className={`fas ${cat.icon} text-sm`}></i>
                  </div>
                  <div>
                    <div className="text-[#1d1d1f] font-black text-sm">{cat.label}</div>
                    <div className="text-[#aeaeb2] text-[10px]">{cat.description}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`font-black text-sm k-num ${statusColor}`}>
                    <i className={`fas ${statusIcon} mr-1 text-[10px]`}></i>
                    {cat.actual.toFixed(0)}%
                  </div>
                  <div className="text-[#6e6e73] text-[10px] font-bold">meta: {cat.ideal}%</div>
                </div>
              </div>
              <div className="relative h-4 bg-[#f5f5f7] rounded-full overflow-hidden">
                <div className="absolute top-0 bottom-0 w-0.5 bg-[#d2d2d7] z-10" style={{ left: `${idealCapped}%` }} />
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${cat.actual > 0 ? Math.max(actualCapped, 0.5) : 0}%`,
                    background: isOver ? '#ff3b30' : isUnder ? '#ff9500' : 'linear-gradient(90deg,#a8e716,#7ab800)'
                  }}
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[#aeaeb2] text-[9px] k-num">0%</span>
                <span className="text-[#6e6e73] text-[10px] font-bold k-num">Meta: {cat.ideal}% · {formatCurrency(totalIncome * cat.ideal / 100)}</span>
                <span className="text-[#aeaeb2] text-[9px] k-num">100%</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── SUGGESTIONS ──────────────────────────────────────────────── */}
      <div className="bg-white border border-[#e8e8ed] rounded-[20px] p-4 shadow-sm">
        <h3 className="text-[#7ab800] font-black text-xs uppercase tracking-widest mb-3 flex items-center gap-2">
          <i className="fas fa-lightbulb"></i> Diagnóstico
        </h3>
        <div className="flex flex-col gap-2">
          {suggestions.map((s, i) => (
            <div key={i} className="flex items-start gap-2 bg-[#f5f5f7] rounded-xl p-3">
              <i className={`fas ${suggestions.length === 1 && i === 0 ? 'fa-trophy text-[#7ab800]' : 'fa-exclamation-circle text-orange-500'} text-xs mt-0.5 shrink-0`}></i>
              <p className="text-[#6e6e73] text-xs leading-relaxed">{s}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center gap-4 justify-center">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 bg-[#d2d2d7]"></div>
          <span className="text-[#aeaeb2] text-[9px] uppercase tracking-widest">Meta ideal</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-[#f0fad0]"></div>
          <span className="text-[#aeaeb2] text-[9px] uppercase tracking-widest">Dentro do ideal</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-[#fff0f0]"></div>
          <span className="text-[#aeaeb2] text-[9px] uppercase tracking-widest">Acima do ideal</span>
        </div>
      </div>
    </div>
  );
};

export default Desempenho;
