// Notificações locais (agendadas no próprio aparelho — sem servidor, sem
// Firebase, sem APNs). Dois tipos hoje:
//   1. Frase motivacional toda segunda-feira 8h.
//   2. Lembrete de conta a vencer (contas fixas + faturas), 9h no dia.
//
// Tudo é pré-agendado no SO e dispara sozinho, mesmo com o app fechado. A cada
// abertura/edição reagendamos, mantendo os avisos coerentes com o estado atual
// (ex.: conta já marcada como paga não gera lembrete).

import { LocalNotifications } from '@capacitor/local-notifications';
import { isNativeApp } from './onboarding/platform';
import { getQuoteForDate } from './quotes';
import { formatCurrency } from '../constants';
import { FinanceItem, CategoryType } from '../types';

const NOTIF_HOUR_QUOTE = 8;
const NOTIF_HOUR_BILL = 9;      // separado da frase para não empilhar às segundas
const ANDROID_CHANNEL = 'kashim-avisos';
const BODY_MAX = 240;

// Faixas de ID reservadas — cancelamos por faixa antes de reprogramar
const QUOTE_ID_BASE = 720000;
const QUOTE_ID_RANGE = 1000;
const BILL_ID_BASE = 730000;
const BILL_ID_RANGE = 1000;

// iOS descarta silenciosamente notificações pendentes acima de 64 por app.
// Reservamos folga: até 10 frases + até 48 contas = 58.
const QUOTE_WEEKS_AHEAD = 10;
const BILL_MAX = 48;

export interface MonthSlot {
  index: number; // mês do calendário (0-11)
  year: number;
}

async function ensurePermission(): Promise<boolean> {
  let granted = (await LocalNotifications.checkPermissions()).display === 'granted';
  if (!granted) {
    granted = (await LocalNotifications.requestPermissions()).display === 'granted';
  }
  return granted;
}

async function ensureChannel(): Promise<void> {
  try {
    await LocalNotifications.createChannel({
      id: ANDROID_CHANNEL,
      name: 'Avisos do Kashim',
      description: 'Frase da semana e lembretes de contas a vencer',
      importance: 4,
    });
  } catch {
    // iOS não tem canais — ok
  }
}

async function cancelRange(base: number, range: number): Promise<void> {
  const pending = await LocalNotifications.getPending();
  const ours = pending.notifications.filter(
    n => typeof n.id === 'number' && n.id >= base && n.id < base + range
  );
  if (ours.length > 0) {
    await LocalNotifications.cancel({ notifications: ours.map(n => ({ id: n.id })) });
  }
}

interface ScheduledNotification {
  id: number;
  title: string;
  body: string;
  channelId: string;
  schedule: { at: Date; allowWhileIdle: boolean };
}

function buildQuoteNotifications(householdId: string): ScheduledNotification[] {
  const now = new Date();
  const cursor = new Date(now);
  cursor.setHours(NOTIF_HOUR_QUOTE, 0, 0, 0);
  const daysUntilMonday = (8 - cursor.getDay()) % 7;
  cursor.setDate(cursor.getDate() + daysUntilMonday);
  if (cursor.getTime() <= now.getTime()) cursor.setDate(cursor.getDate() + 7);

  const out: ScheduledNotification[] = [];
  for (let i = 0; i < QUOTE_WEEKS_AHEAD; i++) {
    const at = new Date(cursor);
    const quote = getQuoteForDate(householdId, at);
    const body = quote.frase.length > BODY_MAX ? `${quote.frase.slice(0, BODY_MAX - 1)}…` : quote.frase;
    out.push({
      id: QUOTE_ID_BASE + i,
      title: 'Kashim · sua frase da semana',
      body,
      channelId: ANDROID_CHANNEL,
      schedule: { at, allowWhileIdle: true },
    });
    cursor.setDate(cursor.getDate() + 7);
  }
  return out;
}

// Lembretes das contas com dia de vencimento definido, ainda não pagas, cujo
// vencimento é futuro. Cobre Contas Fixas (dueDay) e Faturas de Cartão (dueDay
// da fatura). Ordena por data e corta em BILL_MAX (limite do iOS).
function buildBillNotifications(items: FinanceItem[], months: MonthSlot[]): ScheduledNotification[] {
  const now = new Date();
  const candidates: { at: Date; label: string; value: number }[] = [];

  for (const item of items) {
    const isBill =
      item.category === CategoryType.FIXED_EXPENSE || item.category === CategoryType.CREDIT_CARD;
    if (!isBill || !item.dueDay) continue;

    for (let m = 0; m < months.length && m < item.values.length; m++) {
      const value = item.values[m] ?? 0;
      if (value <= 0) continue;
      if (item.paidStatus?.[m]) continue; // já paga → não lembrar

      const slot = months[m];
      // Clamp para meses curtos (ex.: vencimento 31 em fevereiro → último dia)
      const lastDay = new Date(slot.year, slot.index + 1, 0).getDate();
      const day = Math.min(item.dueDay, lastDay);
      const at = new Date(slot.year, slot.index, day, NOTIF_HOUR_BILL, 0, 0, 0);
      if (at.getTime() <= now.getTime()) continue; // vencimento já passou

      const name = item.description?.trim() || (item.category === CategoryType.CREDIT_CARD ? 'Fatura do cartão' : 'Conta');
      candidates.push({ at, label: name, value });
    }
  }

  candidates.sort((a, b) => a.at.getTime() - b.at.getTime());

  return candidates.slice(0, BILL_MAX).map((c, i) => ({
    id: BILL_ID_BASE + i,
    title: 'Kashim · conta a vencer',
    body: `${c.label} vence hoje — ${formatCurrency(c.value)}. Pague e marque como paga no app.`,
    channelId: ANDROID_CHANNEL,
    schedule: { at: c.at, allowWhileIdle: true },
  }));
}

// Ponto de entrada único: pede permissão uma vez e reprograma tudo. Idempotente
// e silencioso na web, sem permissão, ou se o plugin não existir (build antigo).
export async function refreshNotifications(params: {
  householdId: string;
  items: FinanceItem[];
  months: MonthSlot[];
}): Promise<void> {
  const { householdId, items, months } = params;
  if (!isNativeApp || !householdId) return;

  try {
    if (!(await ensurePermission())) return;
    await ensureChannel();

    await cancelRange(QUOTE_ID_BASE, QUOTE_ID_RANGE);
    await cancelRange(BILL_ID_BASE, BILL_ID_RANGE);

    const notifications = [
      ...buildQuoteNotifications(householdId),
      ...buildBillNotifications(items, months),
    ];
    if (notifications.length > 0) {
      await LocalNotifications.schedule({ notifications });
    }
  } catch {
    // Plugin ausente / permissão negada / erro de agendamento — não quebra o app
  }
}
