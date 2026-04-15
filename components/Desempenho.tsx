
import React from 'react';
import { SummaryData } from '../types';
import { formatCurrency } from '../constants';

interface DesempenhoProps {
  summary: SummaryData;
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

const Desempenho: React.FC<DesempenhoProps> = ({ summary }) => {
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

  const poupanca = Math.max(0, balance);
  const poupancaPct = (poupanca / totalIncome) * 100;
  const fixosPct = ((totalFixed + totalCreditCard) / totalIncome) * 100;
  const variaveisPct = (totalVariable / totalIncome) * 100;
  const lazerPct = (totalLeisure / totalIncome) * 100;

  const categories: Category[] = [
    {
      label: 'Fixos + Cartão',
      icon: 'fa-home',
      actual: fixosPct,
      ideal: 55,
      color: 'bg-red-500',
      idealColor: 'text-red-400',
      description: 'Moradia, contas fixas e faturas de cartão',
    },
    {
      label: 'Poupança',
      icon: 'fa-piggy-bank',
      actual: poupancaPct,
      ideal: 20,
      color: 'bg-green-500',
      idealColor: 'text-green-400',
      description: 'O que sobra depois de todas as despesas',
    },
    {
      label: 'Lazer',
      icon: 'fa-star',
      actual: lazerPct,
      ideal: 15,
      color: 'bg-purple-500',
      idealColor: 'text-purple-400',
      description: 'Gastos pessoais e entretenimento',
    },
    {
      label: 'Variáveis',
      icon: 'fa-receipt',
      actual: variaveisPct,
      ideal: 10,
      color: 'bg-cyan-500',
      idealColor: 'text-cyan-400',
      description: 'Despesas variáveis do mês',
    },
  ];

  // Build suggestions
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
    const deficit = idealPoupanca - poupanca;
    suggestions.push(`Para guardar 20% da sua renda você precisa de mais ${formatCurrency(deficit)} de sobra. Reduza gastos ou aumente a renda.`);
  }
  if (suggestions.length === 0) {
    suggestions.push('Parabéns! Sua distribuição está dentro dos parâmetros ideais. Continue assim!');
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4 pb-24">

      {/* Header */}
      <div className="mb-6">
        <h2 className="text-white text-xl font-black italic uppercase tracking-tighter">
          <i className="fas fa-chart-pie text-yellow-500 mr-2"></i>
          Desempenho
        </h2>
        <p className="text-zinc-500 text-xs mt-1">Comparativo com a distribuição ideal de renda</p>
      </div>

      {/* Income reference */}
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

      {/* Category bars */}
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

              {/* Bar container */}
              <div className="relative h-5 bg-zinc-800 rounded-full overflow-hidden">
                {/* Ideal marker */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-white/30 z-10"
                  style={{ left: `${idealCapped}%` }}
                />
                {/* Actual bar */}
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

      {/* Suggestions */}
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
