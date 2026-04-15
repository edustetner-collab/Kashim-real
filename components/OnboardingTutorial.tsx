
import React, { useState } from 'react';

interface TutorialStep {
  target: string;
  title: string;
  content: string;
  icon: string;
}

interface OnboardingTutorialProps {
  onComplete: () => void;
}

const steps: TutorialStep[] = [
  {
    target: 'header',
    title: 'Bem-vindo ao seu novo estilo de vida!',
    content: 'Este é o Kashim. A forma mais simples de você se manter organizado financeiramente está aqui.',
    icon: 'fa-rocket'
  },
  {
    target: 'stets',
    title: 'Conheça o Stets',
    content: 'O Stets é seu professor digital. Fale com ele por voz ou texto para lançar gastos rapidamente ou pedir um diagnóstico de saúde financeira.',
    icon: 'fa-brain'
  },
  {
    target: 'replicate-info',
    title: 'Ganhe Tempo com um Clique',
    content: 'Reparou no botão amarelo circular ao lado dos valores? Ele replica o valor atual para todos os meses seguintes automaticamente. Ideal para aluguel, internet e parcelas fixas!',
    icon: 'fa-sync-alt'
  },
  {
    target: 'tab-gastos-frequentes',
    title: 'Aba de Gastos Frequentes',
    content: 'É aqui que a mágica acontece no dia a dia. Você define um "Teto" e lança cada gasto recorrente. O sistema te avisa se você está chegando no limite planejado antes do mês acabar.',
    icon: 'fa-table'
  },
  {
    target: 'summary-section',
    title: 'Resumo e Acumulado',
    content: 'No final da página, você tem a bússola do seu enriquecimento: Total de custos, saldo mensal e o ACUMULADO. Descubra exatamente quanto dinheiro terá daqui a 12 meses se seguir o plano.',
    icon: 'fa-vault'
  }
];

const OnboardingTutorial: React.FC<OnboardingTutorialProps> = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onComplete();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/85 backdrop-blur-md animate-in fade-in duration-500">
      <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-[40px] p-8 shadow-2xl relative overflow-hidden">
        {/* Progress Bar */}
        <div className="absolute top-0 left-0 w-full h-1 bg-zinc-800">
          <div 
            className="h-full bg-yellow-500 transition-all duration-500" 
            style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
          ></div>
        </div>

        <div className="text-center mt-4">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-8 overflow-hidden bg-yellow-500/10 border border-yellow-500/20">
            {currentStep === 0 ? (
              <img src="/kashim-icon.png" alt="Kashim" className="w-20 h-20 object-cover rounded-3xl" />
            ) : (
              <i className={`fas ${steps[currentStep].icon} text-4xl text-yellow-500`}></i>
            )}
          </div>
          
          <h3 className="text-white text-2xl font-black italic uppercase tracking-tighter mb-4 leading-tight">
            {steps[currentStep].title}
          </h3>
          
          <p className="text-zinc-400 text-sm leading-relaxed mb-10 px-2">
            {steps[currentStep].content}
          </p>

          <div className="flex flex-col gap-3">
            <button 
              onClick={nextStep}
              className="w-full bg-yellow-600 hover:bg-yellow-500 text-black font-black py-4 rounded-2xl transition-all active:scale-95 shadow-lg uppercase text-xs tracking-widest"
            >
              {currentStep === steps.length - 1 ? 'Entendido, vamos lá!' : 'Próximo Passo'}
            </button>
            
            <button 
              onClick={onComplete}
              className="text-zinc-500 hover:text-white text-[10px] font-bold uppercase tracking-[0.2em] transition-colors py-2"
            >
              Pular tutorial
            </button>
          </div>
        </div>

        <div className="mt-10 flex justify-center gap-2">
          {steps.map((_, idx) => (
            <div 
              key={idx} 
              className={`h-1 rounded-full transition-all ${idx === currentStep ? 'w-8 bg-yellow-500' : 'w-2 bg-zinc-800'}`}
            ></div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default OnboardingTutorial;
