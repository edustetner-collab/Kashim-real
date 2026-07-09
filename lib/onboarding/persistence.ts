// Persistência do progresso de onboarding: Supabase (fonte de verdade) com
// fallback em localStorage (offline / erro de rede). Migra as chaves legadas
// (`tutorial_completed`, `onboarding_done_*`) na primeira carga para que quem
// já completou o tutorial antigo NÃO veja o novo tour automaticamente.

import { SupabaseClient } from '@supabase/supabase-js';
import { OnboardingProgress, TourStatus } from './types';
import { ALL_TOURS } from './registry';

const TABLE = 'onboarding_progress';
const LS_KEY = 'kashim_onboarding_progress';

export function emptyProgress(): OnboardingProgress {
  return {
    toursCompleted: [],
    toursSkipped: [],
    currentTourId: null,
    currentStepIndex: 0,
  };
}

function readLocal(): OnboardingProgress | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingProgress>;
    return {
      toursCompleted: parsed.toursCompleted ?? [],
      toursSkipped: parsed.toursSkipped ?? [],
      currentTourId: parsed.currentTourId ?? null,
      currentStepIndex: parsed.currentStepIndex ?? 0,
    };
  } catch {
    return null;
  }
}

function writeLocal(progress: OnboardingProgress): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(progress));
  } catch {
    // storage cheio/indisponível — Supabase continua sendo a fonte de verdade
  }
}

// Usuários da era do tutorial antigo (tutorial_completed === 'true'):
// decisão do Eduardo — NENHUM tour novo auto-inicia para eles; tudo fica
// disponível pelo botão de ajuda.
function migrateLegacyFlags(): OnboardingProgress | null {
  const legacyDone = localStorage.getItem('tutorial_completed') === 'true';
  if (!legacyDone) return null;
  return {
    ...emptyProgress(),
    toursSkipped: ALL_TOURS.map(t => t.id),
  };
}

interface ProgressRow {
  clerk_user_id: string;
  tours_completed: string[] | null;
  tours_skipped: string[] | null;
  current_tour_id: string | null;
  current_step_index: number | null;
}

function rowToProgress(row: ProgressRow): OnboardingProgress {
  return {
    toursCompleted: row.tours_completed ?? [],
    toursSkipped: row.tours_skipped ?? [],
    currentTourId: row.current_tour_id,
    currentStepIndex: row.current_step_index ?? 0,
  };
}

function progressToRow(userId: string, p: OnboardingProgress): ProgressRow {
  return {
    clerk_user_id: userId,
    tours_completed: p.toursCompleted,
    tours_skipped: p.toursSkipped,
    current_tour_id: p.currentTourId,
    current_step_index: p.currentStepIndex,
  };
}

// Carrega o progresso: Supabase → (sem linha) migração legada/local → grava e retorna.
// Em erro de rede, cai no localStorage para o tour não reiniciar do zero.
export async function loadProgress(
  db: SupabaseClient,
  userId: string
): Promise<OnboardingProgress> {
  try {
    const { data, error } = await db
      .from(TABLE)
      .select('*')
      .eq('clerk_user_id', userId)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      const progress = rowToProgress(data as ProgressRow);
      writeLocal(progress);
      return progress;
    }

    // Primeira vez neste dispositivo/conta: migra flags legadas ou local antigo
    const migrated = migrateLegacyFlags() ?? readLocal() ?? emptyProgress();
    await db.from(TABLE).upsert(progressToRow(userId, migrated));
    writeLocal(migrated);
    return migrated;
  } catch {
    return readLocal() ?? migrateLegacyFlags() ?? emptyProgress();
  }
}

// Grava o progresso (localStorage síncrono + Supabase em background).
export function saveProgress(
  db: SupabaseClient | null,
  userId: string,
  progress: OnboardingProgress
): void {
  writeLocal(progress);
  if (!db) return;
  db.from(TABLE)
    .upsert({ ...progressToRow(userId, progress), updated_at: new Date().toISOString() })
    .then(({ error }) => {
      if (error) console.error('Erro ao salvar progresso do onboarding:', error.message);
    });
}

// Helpers imutáveis para transições de estado

export function withTourStarted(
  p: OnboardingProgress,
  tourId: string,
  stepIndex = 0
): OnboardingProgress {
  return { ...p, currentTourId: tourId, currentStepIndex: stepIndex };
}

export function withStepIndex(p: OnboardingProgress, stepIndex: number): OnboardingProgress {
  return { ...p, currentStepIndex: stepIndex };
}

export function withTourEnded(
  p: OnboardingProgress,
  tourId: string,
  status: Extract<TourStatus, 'completed' | 'skipped'>
): OnboardingProgress {
  const completed = new Set(p.toursCompleted);
  const skipped = new Set(p.toursSkipped);
  if (status === 'completed') {
    completed.add(tourId);
    skipped.delete(tourId);
  } else {
    // já completado antes prevalece sobre "pulado" agora
    if (!completed.has(tourId)) skipped.add(tourId);
  }
  return {
    ...p,
    toursCompleted: [...completed],
    toursSkipped: [...skipped],
    currentTourId: null,
    currentStepIndex: 0,
  };
}

export function hasSeenTour(p: OnboardingProgress, tourId: string): boolean {
  return p.toursCompleted.includes(tourId) || p.toursSkipped.includes(tourId);
}
