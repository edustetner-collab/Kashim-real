
import React from 'react';
import { SummaryData } from '../types';
import { IDEAL_LIMITS, formatCurrency } from '../constants';

interface DiagnosisProps { summary: SummaryData; monthName: string; }

const Diagnosis: React.FC<DiagnosisProps> = ({ summary, monthName }) => {
  const { totalIncome, totalFixed, totalLeisure, balance } = summary;
  const fixedPercent = totalIncome > 0 ? (totalFixed / totalIncome) : 0;
  const leisurePercent = totalIncome > 0 ? (totalLeisure / totalIncome) : 0;
  
  const isFixedOk = fixedPercent <= IDEAL_LIMITS.FIXED;
  const isLeisureOk = leisurePercent <= IDEAL_LIMITS.LEISURE;
  const isBalanceOk = balance >= 0;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8 shadow-sm">
      <div className="flex items-center gap-3 mb-6">
        <i className="fas fa-chart-line text-zinc-900 text-2xl"></i>
        <h3 className="text-xl font-black text-zinc-900 uppercase tracking-wider">Diagnóstico - {monthName}</h3>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className={`p-4 rounded-lg border transition-all ${isFixedOk ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
          <div className="flex justify-between items-center mb-2">
            <span className="font-bold text-xs uppercase text-gray-500 tracking-widest">Custos Fixos</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-black ${isFixedOk ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
              {(fixedPercent * 100).toFixed(1)}%
            </span>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">
            {isFixedOk ? "Excelente! Estrutura de custos fixos otimizada." : "Custos fixos acima do ideal. Reavalie seus contratos."}
          </p>
        </div>

        <div className={`p-4 rounded-lg border transition-all ${isLeisureOk ? 'bg-green-50 border-green-100' : 'bg-yellow-50 border-yellow-100'}`}>
          <div className="flex justify-between items-center mb-2">
            <span className="font-bold text-xs uppercase text-gray-500 tracking-widest">Lazer / Pessoal</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-black ${isLeisureOk ? 'bg-green-600 text-white' : 'bg-green-500 text-black'}`}>
              {(leisurePercent * 100).toFixed(1)}%
            </span>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">
            {isLeisureOk ? "Lifestyle em equilíbrio com sua renda." : "Seus gastos pessoais estão pressionando o caixa."}
          </p>
        </div>

        <div className={`p-4 rounded-lg border transition-all ${isBalanceOk ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
          <div className="flex justify-between items-center mb-2">
            <span className="font-bold text-xs uppercase text-gray-500 tracking-widest">Saldo Mensal</span>
            <span className={`font-black ${isBalanceOk ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(balance)}</span>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">
            {isBalanceOk ? "Operação lucrativa. Você está enriquecendo." : "Déficit detectado. Ajuste necessário imediatamente."}
          </p>
        </div>
      </div>
    </div>
  );
};

export default Diagnosis;
