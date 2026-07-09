// Orquestrador do onboarding: carrega o progresso (Supabase + fallback local),
// decide quando auto-iniciar o tour da tela atual (só no primeiro acesso),
// persiste cada passo e renderiza o botão de ajuda global — por onde qualquer
// tour pode ser revisto a qualquer momento.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SupabaseClient } from '@supabase/supabase-js';
import { Tour, TourScreen, OnboardingProgress } from '../../lib/onboarding/types';
import { ALL_TOURS, getTourForScreen, getTourById } from '../../lib/onboarding/registry';
import {
  loadProgress, saveProgress, hasSeenTour,
  withTourStarted, withStepIndex, withTourEnded,
} from '../../lib/onboarding/persistence';
import TourOverlay from './TourOverlay';

interface OnboardingManagerProps {
  screen: TourScreen;
  db: SupabaseClient | null;
  userId: string;
  // false = nada aparece (admin, coach view, wizard aberto, gate de assinatura)
  active: boolean;
  // O tour pede pra trocar de tela (ex.: iniciar tour de outra aba pelo menu de ajuda)
  onRequestScreen: (screen: TourScreen) => void;
  // Usuário aceitou a oferta de IA — App leva ao Stets com o prompt pronto
  onAiPrompt: (prompt: string) => void;
}

const OnboardingManager: React.FC<OnboardingManagerProps> = ({
  screen, db, userId, active, onRequestScreen, onAiPrompt,
}) => {
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [activeTour, setActiveTour] = useState<Tour | null>(null);
  const [initialStep, setInitialStep] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  // Tour escolhido no menu de ajuda que mora em outra aba — inicia após a troca
  const pendingTourIdRef = useRef<string | null>(null);
  const loadedForUserRef = useRef<string | null>(null);

  // Carrega o progresso uma vez por usuário (não a cada renovação de token)
  useEffect(() => {
    if (!db || !userId) return;
    if (loadedForUserRef.current === userId) return;
    loadedForUserRef.current = userId;
    loadProgress(db, userId).then(setProgress);
  }, [db, userId]);

  // Auto-início / retomada / tour pendente do menu de ajuda
  useEffect(() => {
    if (!active || !progress || activeTour) return;

    const pendingId = pendingTourIdRef.current;
    if (pendingId) {
      const pending = getTourById(pendingId);
      if (pending && pending.screen === screen) {
        pendingTourIdRef.current = null;
        startTour(pending, 0);
      }
      return;
    }

    // Retomada: usuário parou no meio de um tour desta tela (inclui os que
    // não auto-iniciam, ex.: "Como lançar gastos")
    if (progress.currentTourId) {
      const inProgress = getTourById(progress.currentTourId);
      if (inProgress && inProgress.screen === screen) {
        startTour(inProgress, progress.currentStepIndex);
        return;
      }
    }

    const tour = getTourForScreen(screen);
    if (!tour) return;

    // Auto-início: primeira visita a esta tela
    if (!hasSeenTour(progress, tour.id)) {
      startTour(tour, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, progress, screen, activeTour]);

  const persist = useCallback(
    (next: OnboardingProgress) => {
      setProgress(next);
      saveProgress(db, userId, next);
    },
    [db, userId]
  );

  const startTour = (tour: Tour, step: number) => {
    setInitialStep(step);
    setActiveTour(tour);
    if (progress) persist(withTourStarted(progress, tour.id, step));
  };

  const handleStepChange = (index: number) => {
    if (progress) persist(withStepIndex(progress, index));
  };

  const handleComplete = () => {
    if (progress && activeTour) persist(withTourEnded(progress, activeTour.id, 'completed'));
    setActiveTour(null);
  };

  const handleSkip = () => {
    if (progress && activeTour) persist(withTourEnded(progress, activeTour.id, 'skipped'));
    setActiveTour(null);
  };

  const handleAiPrompt = (prompt: string) => {
    // Aceitar a oferta de IA conclui o tour — o usuário sai para interagir com o Stets
    handleComplete();
    onAiPrompt(prompt);
  };

  const handleHelpSelect = (tour: Tour) => {
    setHelpOpen(false);
    if (tour.screen === screen) {
      startTour(tour, 0);
    } else {
      pendingTourIdRef.current = tour.id;
      onRequestScreen(tour.screen);
    }
  };

  if (!active) return null;

  return (
    <>
      {activeTour && (
        <TourOverlay
          key={activeTour.id}
          tour={activeTour}
          initialStep={initialStep}
          onStepChange={handleStepChange}
          onComplete={handleComplete}
          onSkip={handleSkip}
          onAiPrompt={handleAiPrompt}
        />
      )}

      {/* Botão de ajuda global — sempre visível, acima da bottom bar no mobile */}
      {!activeTour && (
        <button
          onClick={() => setHelpOpen(true)}
          className="fixed z-[70] bottom-24 lg:bottom-6 right-4 lg:right-6 w-12 h-12 rounded-full bg-[#1d1d1f] border-2 border-[#a8e716] text-[#a8e716] shadow-lg active:scale-95 transition-all flex items-center justify-center"
          aria-label="Ajuda e tutoriais"
          title="Ajuda e tutoriais"
        >
          <i className="fas fa-question text-base" />
        </button>
      )}

      {/* Menu de ajuda: rever qualquer tour */}
      {helpOpen && (
        <div
          className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-end lg:items-center justify-center animate-in fade-in duration-200"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="w-full lg:max-w-md bg-zinc-900 border border-zinc-800 rounded-t-3xl lg:rounded-3xl p-6 safe-bottom animate-in slide-in-from-bottom-4 duration-300"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-white text-lg font-black italic uppercase tracking-tighter">
                Tutoriais
              </h3>
              <button
                onClick={() => setHelpOpen(false)}
                className="w-9 h-9 rounded-xl bg-zinc-800 text-zinc-400 active:scale-95 transition-all"
                aria-label="Fechar"
              >
                <i className="fas fa-times text-sm" />
              </button>
            </div>
            <p className="text-zinc-500 text-xs mb-4">
              Reveja o passo a passo de qualquer tela quando quiser.
            </p>
            <div className="flex flex-col gap-2">
              {ALL_TOURS.map(tour => {
                const done = progress?.toursCompleted.includes(tour.id) ?? false;
                const seen = progress ? hasSeenTour(progress, tour.id) : false;
                return (
                  <button
                    key={tour.id}
                    onClick={() => handleHelpSelect(tour)}
                    className="flex items-center gap-3 bg-zinc-800/70 border border-zinc-700 hover:border-green-400/40 rounded-2xl px-4 py-3.5 text-left active:scale-[0.98] transition-all"
                  >
                    <div className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center ${seen ? 'bg-green-400/10 text-green-400' : 'bg-zinc-700 text-zinc-400'}`}>
                      <i className={`fas ${seen ? 'fa-check' : 'fa-play'} text-xs`} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-white text-sm font-bold truncate">{tour.label}</p>
                      <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">
                        {done ? 'Concluído — rever' : seen ? 'Ver de novo' : 'Não visto ainda'}
                      </p>
                    </div>
                    <i className="fas fa-chevron-right text-zinc-600 text-xs ml-auto" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default OnboardingManager;
