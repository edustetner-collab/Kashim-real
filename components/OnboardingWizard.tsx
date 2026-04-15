
import React, { useState, useEffect, useRef } from 'react';
import { formatCurrency } from '../constants';

interface WizardStep {
  id: string;
  type: 'welcome' | 'income' | 'expense' | 'leisure' | 'extra' | 'summary';
  question?: string;
  explanation?: string;
  tip?: string;
  skipLabel?: string;
  extraNote?: string;
  itemKey?: string;
}

const STEPS: WizardStep[] = [
  { id: 'welcome',     type: 'welcome' },
  { id: 'renda',       type: 'income',   question: 'Quanto você ganha por mês?',                           explanation: 'Tirando todos os descontos da folha, o que cai na sua conta. Não inclua empréstimos descontados em folha, vale-alimentação ou vale-refeição.' },
  { id: 'moradia',     type: 'expense',  itemKey: 'Moradia',                       question: 'Quanto você gasta com moradia?',                           explanation: 'O valor total que você paga por mês para morar.',                                                                                                skipLabel: 'Não gasto' },
  { id: 'condominio',  type: 'expense',  itemKey: 'Condominio',                    question: 'Quanto você paga de condomínio por mês?',                  explanation: 'A taxa mensal do prédio ou condomínio fechado.',                                                                                                skipLabel: 'Não pago' },
  { id: 'telefone',    type: 'expense',  itemKey: 'Telefone fixo',                 question: 'Quanto você gasta com telefone fixo?',                     explanation: 'Se o valor variar, coloca uma média.',       tip: 'O telefone de casa, se você ainda tiver.',                                            skipLabel: 'Não pago' },
  { id: 'internet',    type: 'expense',  itemKey: 'Internet',                      question: 'Quanto você gasta com internet?',                          explanation: 'Se o valor variar, coloca uma média.',       tip: 'O wifi da sua casa.',                                                                  skipLabel: 'Não pago' },
  { id: 'celular',     type: 'expense',  itemKey: 'Celular',                       question: 'Quanto você gasta com celular?',                           explanation: 'Se o valor variar, coloca uma média.',       tip: 'Conta ou recargas do mês.',                                                            skipLabel: 'Não pago' },
  { id: 'mercado',     type: 'expense',  itemKey: 'Compras mercado (média mensal)',question: 'Quanto você gasta com compras de mercado?',                explanation: 'Se o valor variar, coloca uma média.',       tip: 'Valor em dinheiro, sem contar vale-alimentação.',                                      skipLabel: 'Não pago' },
  { id: 'gas',         type: 'expense',  itemKey: 'Gás',                           question: 'Quanto você gasta com gás de cozinha?',                   explanation: 'Se o valor variar, coloca uma média.',       tip: 'Se for botijão, pensa na média por mês.',                                              skipLabel: 'Não pago' },
  { id: 'luz',         type: 'expense',  itemKey: 'Luz',                           question: 'Quanto você gasta com conta de luz?',                      explanation: 'Se o valor variar, coloca uma média.',                                                                                                        skipLabel: 'Não pago' },
  { id: 'agua',        type: 'expense',  itemKey: 'Água',                          question: 'Quanto você gasta com conta de água?',                     explanation: 'Se o valor variar, coloca uma média.',                                                                                                        skipLabel: 'Não pago' },
  { id: 'saude',       type: 'expense',  itemKey: 'Convênio',                      question: 'Quanto você gasta com plano de saúde?',                    explanation: 'Se o valor variar, coloca uma média.',       tip: 'Só o que você paga após receber o salário. Se desconta em folha, não inclua.',         skipLabel: 'Não pago' },
  { id: 'transporte',  type: 'expense',  itemKey: 'Gasolina/uber (media mensal)',  question: 'Quanto você gasta com transporte?',                        explanation: 'Se o valor variar, coloca uma média.',       tip: 'Gasolina, Uber, ônibus, metrô...',                                                     skipLabel: 'Não pago' },
  { id: 'educacao',    type: 'expense',  itemKey: 'Educação',                      question: 'Quanto você gasta com escola ou faculdade?',               explanation: 'Se o valor variar, coloca uma média.',       tip: 'Mensalidade de curso ou escola.',                                                      skipLabel: 'Não pago' },
  { id: 'diarista',    type: 'expense',  itemKey: 'Diarista',                      question: 'Quanto você gasta com diarista ou empregada?',             explanation: 'Se o valor variar, coloca uma média.',                                                                                                        skipLabel: 'Não pago' },
  { id: 'racao',       type: 'expense',  itemKey: 'Comida pet',                    question: 'Quanto você gasta com ração do pet?',                      explanation: 'Se o valor variar, coloca uma média.',       tip: 'Quanto você gasta de ração do seu bichinho por mês.',                                  skipLabel: 'Não pago' },
  { id: 'petshop',     type: 'expense',  itemKey: 'Banho pet',                     question: 'Quanto você gasta com banho e tosa?',                      explanation: 'Se o valor variar, coloca uma média.',       tip: 'Petshop do seu bichinho.',                                                             skipLabel: 'Não pago' },
  { id: 'academia',    type: 'expense',  itemKey: 'Academia',                      question: 'Quanto você gasta com academia?',                          explanation: 'Se o valor variar, coloca uma média.',                                                                                                        skipLabel: 'Não pago' },
  { id: 'personal',    type: 'expense',  itemKey: 'Personal',                      question: 'Quanto você gasta com personal trainer?',                 explanation: 'Se o valor variar, coloca uma média.',                                                                                                        skipLabel: 'Não pago' },
  { id: 'streaming',   type: 'expense',  itemKey: 'Netflix',                       question: 'Quanto você gasta com streaming e apps?',                  explanation: 'Se o valor variar, coloca uma média.',       tip: 'Netflix, Spotify, Disney+, Sem Parar...',                                              skipLabel: 'Não pago' },
  { id: 'terapia',     type: 'expense',  itemKey: 'Terapia',                       question: 'Quanto você gasta com terapia ou psicólogo?',              explanation: 'Se o valor variar, coloca uma média.',                                                                                                        skipLabel: 'Não pago' },
  { id: 'previdencia', type: 'expense',  itemKey: 'Previdência',                   question: 'Quanto você gasta com previdência privada?',               explanation: 'Se o valor variar, coloca uma média.',       tip: 'Só se você paga após receber o salário. Se desconta em folha, não inclua.',           skipLabel: 'Não pago' },
  { id: 'seguro',      type: 'expense',  itemKey: 'Parcela seguro carro',          question: 'Quanto você gasta com seguro do carro/moto?',              explanation: 'Se o valor variar, coloca uma média.',                                                                                                        skipLabel: 'Não pago' },
  { id: 'carro',       type: 'expense',  itemKey: 'Parcela de carro',              question: 'Quanto você gasta com parcela do carro/moto?',             explanation: 'Se o valor variar, coloca uma média.',                                                                                                        skipLabel: 'Não pago' },
  { id: 'emprestimo',  type: 'expense',  itemKey: 'Emprestimo (parcela mensal)',   question: 'Quanto você gasta com parcela de empréstimo?',             explanation: 'Se o valor variar, coloca uma média.',       tip: 'Só o que você paga após receber o salário. Se desconta em folha, não inclua.',         skipLabel: 'Não pago' },
  { id: 'iptu',        type: 'expense',  itemKey: 'Iptu (mensal)',                 question: 'Quanto você paga de IPTU por mês?',                        explanation: 'É o imposto da casa/apartamento. Se você mora de aluguel, geralmente não paga.',                                                          skipLabel: 'Não pago', extraNote: 'Pago à vista (uma vez por ano)' },
  { id: 'extra',       type: 'extra',    question: 'Tem mais alguma conta fixa que não apareceu?',         explanation: 'Escolinha do filho, curso, ajuda pra mãe, remédio todo mês, mensalidade de clube...',                                                       skipLabel: 'Não, era só isso' },
  { id: 'lazer',       type: 'leisure' },
  { id: 'summary',     type: 'summary' },
];

export interface WizardResult {
  income: number;
  expenses: Record<string, number>;
  leisure: number;
  extraItems: { description: string; value: number }[];
}

interface Props {
  userName: string;
  onComplete: (result: WizardResult) => void;
}

const OnboardingWizard: React.FC<Props> = ({ userName, onComplete }) => {
  const [stepIdx, setStepIdx] = useState(0);
  const [values, setValues] = useState<Record<string, number>>({});
  const [inputValue, setInputValue] = useState('');
  const [extraDesc, setExtraDesc] = useState('');
  const [extraItems, setExtraItems] = useState<{ description: string; value: number }[]>([]);
  const [visible, setVisible] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLInputElement>(null);

  const step = STEPS[stepIdx];
  const totalExpenseSteps = STEPS.filter(s => s.type !== 'welcome' && s.type !== 'summary').length;
  const progressStep = stepIdx === 0 ? 0 : stepIdx;
  const progress = Math.round((progressStep / (STEPS.length - 2)) * 100);

  const income = values['renda'] || 0;
  const leisureSuggested = Math.round(income * 0.15);
  const totalExpenses = Object.entries(values)
    .filter(([k]) => k !== 'renda' && k !== 'lazer')
    .reduce((s, [, v]) => s + v, 0);

  useEffect(() => {
    if (step.type !== 'welcome' && step.type !== 'summary' && step.type !== 'leisure') {
      setTimeout(() => {
        if (step.type === 'extra') descRef.current?.focus();
        else inputRef.current?.focus();
      }, 350);
    }
    if (step.type === 'leisure') {
      setInputValue(String(leisureSuggested));
    }
  }, [stepIdx]);

  const transition = (fn: () => void) => {
    setVisible(false);
    setTimeout(() => { fn(); setVisible(true); }, 200);
  };

  const advance = (val?: number) => {
    if (val !== undefined) setValues(v => ({ ...v, [step.id]: val }));
    transition(() => {
      setStepIdx(i => i + 1);
      setInputValue('');
      setExtraDesc('');
    });
  };

  const goBack = () => {
    if (stepIdx === 0) return;
    transition(() => { setStepIdx(i => i - 1); setInputValue(''); });
  };

  const handleAdvance = () => {
    if (step.type === 'welcome') { advance(); return; }

    if (step.type === 'income' || step.type === 'expense') {
      const val = parseFloat(inputValue.replace(',', '.'));
      advance(isNaN(val) || val < 0 ? 0 : val);
      return;
    }

    if (step.type === 'extra') {
      const val = parseFloat(inputValue.replace(',', '.'));
      if (extraDesc.trim() && !isNaN(val) && val > 0) {
        setExtraItems(prev => [...prev, { description: extraDesc.trim(), value: val }]);
        setInputValue('');
        setExtraDesc('');
        descRef.current?.focus();
      } else {
        advance(0);
      }
      return;
    }

    if (step.type === 'leisure') {
      const val = parseFloat(inputValue.replace(',', '.'));
      advance(isNaN(val) || val < 0 ? leisureSuggested : val);
      return;
    }

    if (step.type === 'summary') {
      onComplete({
        income,
        expenses: Object.fromEntries(
          STEPS.filter(s => s.type === 'expense' && s.itemKey)
            .map(s => [s.itemKey!, values[s.id] || 0])
        ),
        leisure: values['lazer'] || 0,
        extraItems,
      });
    }
  };

  const handleSkip = () => advance(0);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAdvance();
  };

  const clamp = progress > 100 ? 100 : progress < 0 ? 0 : progress;

  return (
    <div className="fixed inset-0 z-[300] bg-[#0a0a0a] flex flex-col overflow-hidden">

      {/* Top bar */}
      <div className="flex items-center justify-between px-5 pt-6 pb-4 shrink-0">
        {stepIdx > 0 ? (
          <button onClick={goBack} className="w-9 h-9 flex items-center justify-center text-zinc-500 active:text-white transition-colors">
            <i className="fas fa-arrow-left text-base"></i>
          </button>
        ) : <div className="w-9" />}

        {/* Logo */}
        <div className="flex items-center gap-2">
          <img src="/kashim-icon.png" alt="Kashim" className="h-8 w-8 rounded-xl" />
          <span className="text-white font-black text-base uppercase tracking-widest italic">Kashim</span>
        </div>

        <div className="w-9" />
      </div>

      {/* Progress bar */}
      {step.type !== 'welcome' && (
        <div className="px-5 pb-5 shrink-0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-zinc-600 text-[9px] font-black uppercase tracking-widest">Progresso</span>
            <span className="text-yellow-500 text-[9px] font-black">{clamp}%</span>
          </div>
          <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-yellow-600 to-yellow-400 rounded-full transition-all duration-500"
              style={{ width: `${clamp}%` }}
            />
          </div>
        </div>
      )}

      {/* Content */}
      <div
        className="flex-1 flex flex-col items-center justify-center px-5 pb-8 overflow-y-auto"
        style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(10px)', transition: 'opacity 0.2s ease, transform 0.2s ease' }}
      >

        {/* WELCOME */}
        {step.type === 'welcome' && (
          <div className="text-center max-w-sm w-full">
            <div className="w-16 h-16 bg-yellow-500 rounded-2xl flex items-center justify-center mx-auto mb-8 shadow-lg shadow-yellow-500/30">
              <i className="fas fa-chart-line text-black text-2xl"></i>
            </div>
            <h1 className="text-3xl font-black uppercase italic tracking-tighter text-white mb-3 leading-tight">
              Vamos descobrir onde<br/>seu dinheiro está indo?
            </h1>
            <p className="text-zinc-400 text-sm leading-relaxed mb-8">
              Um diagnóstico rápido para você enxergar sua vida financeira com clareza. Leva menos de 3 minutos.
            </p>
            <div className="flex justify-center gap-6 mb-10 text-xs text-zinc-500">
              <span><i className="fas fa-lock text-yellow-500 mr-1.5"></i>Dados seguros</span>
              <span><i className="fas fa-bolt text-yellow-500 mr-1.5"></i>Resultado instantâneo</span>
            </div>
            <button
              onClick={handleAdvance}
              className="w-full bg-yellow-500 active:bg-yellow-400 text-black font-black py-4 rounded-2xl text-base uppercase tracking-widest transition-all shadow-lg shadow-yellow-500/20"
            >
              Começar agora
            </button>
          </div>
        )}

        {/* INCOME / EXPENSE */}
        {(step.type === 'income' || step.type === 'expense') && (
          <div className="w-full max-w-sm">
            <h2 className="text-2xl font-black text-white leading-tight mb-4">{step.question}</h2>

            {(step.explanation || step.tip) && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 mb-5">
                {step.explanation && <p className="text-zinc-400 text-sm leading-relaxed">{step.explanation}</p>}
                {step.tip && (
                  <p className="text-yellow-500 text-xs font-bold mt-2 flex items-start gap-1.5">
                    <i className="fas fa-lightbulb mt-0.5 shrink-0"></i>
                    {step.tip}
                  </p>
                )}
              </div>
            )}

            {/* Input */}
            <div className="bg-zinc-900 border-2 border-yellow-500 rounded-2xl flex items-center px-4 mb-2 focus-within:border-yellow-400 transition-colors">
              <span className="text-zinc-400 font-black text-sm mr-2">R$</span>
              <input
                ref={inputRef}
                type="number"
                inputMode="decimal"
                min="0"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="0,00"
                className="flex-1 bg-transparent py-4 text-white text-right font-mono text-lg font-black outline-none placeholder:text-zinc-700"
              />
            </div>

            {step.extraNote && (
              <p className="text-zinc-600 text-xs mb-4 text-center">{step.extraNote}</p>
            )}

            <div className="flex gap-3 mt-4">
              <button
                onClick={handleSkip}
                className="flex-1 bg-zinc-800 active:bg-zinc-700 text-zinc-300 font-black py-4 rounded-2xl text-sm uppercase transition-all"
              >
                {step.skipLabel || 'Não pago'}
              </button>
              <button
                onClick={handleAdvance}
                className="flex-1 bg-yellow-500 active:bg-yellow-400 text-black font-black py-4 rounded-2xl text-sm uppercase transition-all shadow-lg shadow-yellow-500/20"
              >
                Avançar
              </button>
            </div>
          </div>
        )}

        {/* EXTRA */}
        {step.type === 'extra' && (
          <div className="w-full max-w-sm">
            <h2 className="text-2xl font-black text-white leading-tight mb-2">{step.question}</h2>
            <p className="text-zinc-500 text-sm mb-5">{step.explanation}</p>

            {extraItems.length > 0 && (
              <div className="mb-4 flex flex-col gap-2">
                {extraItems.map((e, i) => (
                  <div key={i} className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5">
                    <span className="text-white text-sm font-bold">{e.description}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-yellow-500 font-mono text-sm font-black">{formatCurrency(e.value)}</span>
                      <button onClick={() => setExtraItems(prev => prev.filter((_, j) => j !== i))} className="text-zinc-600 active:text-red-400">
                        <i className="fas fa-times text-xs"></i>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 mb-4 flex flex-col gap-3">
              <input
                ref={descRef}
                type="text"
                value={extraDesc}
                onChange={e => setExtraDesc(e.target.value)}
                placeholder="Ex: Inglês da filha"
                className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-yellow-500 transition-colors placeholder:text-zinc-600"
              />
              <div className="flex items-center gap-2">
                <span className="text-zinc-500 font-black text-sm">R$</span>
                <input
                  ref={inputRef}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="0,00"
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white font-mono text-sm outline-none focus:border-yellow-500 transition-colors placeholder:text-zinc-600 text-right"
                />
                <button
                  onClick={() => {
                    const val = parseFloat(inputValue.replace(',', '.'));
                    if (extraDesc.trim() && !isNaN(val) && val > 0) {
                      setExtraItems(prev => [...prev, { description: extraDesc.trim(), value: val }]);
                      setInputValue('');
                      setExtraDesc('');
                      descRef.current?.focus();
                    }
                  }}
                  className="w-10 h-10 bg-yellow-500 active:bg-yellow-400 text-black rounded-xl flex items-center justify-center shrink-0"
                >
                  <i className="fas fa-plus text-sm font-black"></i>
                </button>
              </div>
            </div>

            <button
              onClick={() => advance(0)}
              className="w-full bg-zinc-800 active:bg-zinc-700 text-zinc-300 font-black py-4 rounded-2xl text-sm uppercase transition-all"
            >
              {step.skipLabel}
            </button>
          </div>
        )}

        {/* LEISURE */}
        {step.type === 'leisure' && (
          <div className="w-full max-w-sm text-center">
            <div className="w-14 h-14 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl flex items-center justify-center mx-auto mb-5">
              <i className="fas fa-star text-yellow-500 text-xl"></i>
            </div>
            <h2 className="text-2xl font-black text-white leading-tight mb-3">
              Seu plano de lazer e gastos pessoais
            </h2>
            <p className="text-zinc-400 text-sm leading-relaxed mb-6">
              Com base na sua renda de <span className="text-white font-black">{formatCurrency(income)}</span>, separar{' '}
              <span className="text-yellow-400 font-black">{formatCurrency(leisureSuggested)}</span> para lazer e gastos pessoais vai te manter no controle e fora das dívidas.
            </p>
            <p className="text-zinc-500 text-xs mb-5">Isso representa 15% da sua renda — o percentual ideal do método.</p>

            <div className="bg-zinc-900 border-2 border-yellow-500 rounded-2xl flex items-center px-4 mb-6 focus-within:border-yellow-400 transition-colors">
              <span className="text-zinc-400 font-black text-sm mr-2">R$</span>
              <input
                ref={inputRef}
                type="number"
                inputMode="decimal"
                min="0"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={String(leisureSuggested)}
                className="flex-1 bg-transparent py-4 text-white text-right font-mono text-lg font-black outline-none placeholder:text-zinc-500"
              />
            </div>

            <button
              onClick={handleAdvance}
              className="w-full bg-yellow-500 active:bg-yellow-400 text-black font-black py-4 rounded-2xl text-base uppercase tracking-widest transition-all shadow-lg shadow-yellow-500/20 mb-3"
            >
              Sim, incluir no meu plano
            </button>
            <button
              onClick={() => advance(0)}
              className="w-full text-zinc-600 font-bold text-sm py-2 uppercase"
            >
              Pular por agora
            </button>
          </div>
        )}

        {/* SUMMARY */}
        {step.type === 'summary' && (
          <div className="w-full max-w-sm">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-green-500/20 border border-green-500/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-check text-green-400 text-2xl"></i>
              </div>
              <h2 className="text-2xl font-black text-white uppercase italic tracking-tight">Resumo do diagnóstico</h2>
              <p className="text-zinc-500 text-sm mt-1">Confira os dados antes de entrar no app</p>
            </div>

            <div className="flex flex-col gap-3 mb-6">
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                <p className="text-zinc-500 text-[9px] font-black uppercase tracking-widest mb-1">Sua renda por mês</p>
                <p className="text-yellow-400 font-black text-xl font-mono">{formatCurrency(income)}</p>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                <p className="text-zinc-500 text-[9px] font-black uppercase tracking-widest mb-1">Total de gastos fixos</p>
                <p className={`font-black text-xl font-mono ${totalExpenses > income * 0.55 ? 'text-red-400' : 'text-white'}`}>{formatCurrency(totalExpenses)}</p>
                {income > 0 && (
                  <p className="text-zinc-600 text-[10px] mt-1">
                    {((totalExpenses / income) * 100).toFixed(0)}% da renda {totalExpenses > income * 0.55 ? '— acima do ideal (55%)' : '— dentro do ideal'}
                  </p>
                )}
              </div>
              {values['lazer'] > 0 && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                  <p className="text-zinc-500 text-[9px] font-black uppercase tracking-widest mb-1">Lazer e gastos pessoais</p>
                  <p className="text-green-400 font-black text-xl font-mono">{formatCurrency(values['lazer'])}</p>
                </div>
              )}
              {income > 0 && (
                <div className={`rounded-2xl p-4 border ${income - totalExpenses - (values['lazer'] || 0) >= 0 ? 'bg-green-500/10 border-green-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
                  <p className="text-zinc-500 text-[9px] font-black uppercase tracking-widest mb-1">Sobra por mês</p>
                  <p className={`font-black text-xl font-mono ${income - totalExpenses - (values['lazer'] || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatCurrency(income - totalExpenses - (values['lazer'] || 0))}
                  </p>
                </div>
              )}
            </div>

            <button
              onClick={handleAdvance}
              className="w-full bg-yellow-500 active:bg-yellow-400 text-black font-black py-4 rounded-2xl text-base uppercase tracking-widest transition-all shadow-lg shadow-yellow-500/20"
            >
              Entrar no meu plano <i className="fas fa-arrow-right ml-2"></i>
            </button>
          </div>
        )}

      </div>
    </div>
  );
};

export default OnboardingWizard;
