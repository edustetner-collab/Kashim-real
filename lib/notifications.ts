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
import { getNotifPrefs } from './notifPrefs';

const NOTIF_HOUR_QUOTE = 8;
const NOTIF_HOUR_BILL = 9;      // separado da frase para não empilhar às segundas
const NOTIF_HOUR_UPDATE = 10;   // lembrete de atualização
const ANDROID_CHANNEL = 'kashim-avisos';
const BODY_MAX = 240;

// Faixas de ID reservadas — cancelamos por faixa antes de reprogramar
const QUOTE_ID_BASE = 720000;
const QUOTE_ID_RANGE = 1000;
const BILL_ID_BASE = 730000;
const BILL_ID_RANGE = 1000;
const UPDATE_ID_BASE = 740000;
const UPDATE_ID_RANGE = 1000;
const UPDATE_OCCURRENCES = 8;   // quantos lembretes de atualização pré-agendar
const MONTHLY_ID_BASE = 750000;
const MONTHLY_ID_RANGE = 1000;
const MONTHLY_MAX = 6;          // lembrete mensal de contas a pagar (próximos meses)

// iOS descarta silenciosamente notificações pendentes acima de 64 por app.
// Reservamos folga: até 10 frases + até 48 contas = 58.
const QUOTE_WEEKS_AHEAD = 10;
const BILL_MAX = 24;

export interface MonthSlot {
  index: number; // mês do calendário (0-11)
  year: number;
}

// Títulos da frase da semana — giram por semana para não ficar repetitivo e dar
// cara de conteúdo (instagramável). Sempre com a marca + 💰 para atribuição no
// print. A escolha é determinística pela semana (não aleatória) → todo cliente
// vê o mesmo título na mesma semana.
const QUOTE_TITLES = [
  'Kashim 💰 Comece a semana no controle',
  'Kashim 💰 Segunda é dia de virar o jogo',
  'Kashim 💰 Sua semana no azul começa agora',
  'Kashim 💰 Rico é quem controla, não quem ganha mais',
  'Kashim 💰 Bora fazer sobrar esse mês',
  'Kashim 💰 Foco no dinheiro essa semana',
];
function weeklyTitle(when: Date): string {
  const weekNumber = Math.floor(when.getTime() / (7 * 24 * 60 * 60 * 1000));
  return QUOTE_TITLES[weekNumber % QUOTE_TITLES.length];
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
      title: weeklyTitle(at),
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

// Lembrete MENSAL de contas a pagar — dispara no dia 1 de cada mês futuro às 9h,
// listando o total de contas em aberto (fixas + faturas) daquele mês. NÃO depende
// do "Pagar dia" de cada conta estar preenchido — por isso funciona pra todo
// mundo (o lembrete por-dia-de-vencimento acima continua como bônus pra quem
// definiu o dia exato). Este é o que faz o recurso realmente acontecer.
function buildMonthlyBillReminders(items: FinanceItem[], months: MonthSlot[]): ScheduledNotification[] {
  const now = new Date();
  const out: ScheduledNotification[] = [];

  for (let m = 0; m < months.length; m++) {
    const slot = months[m];
    const at = new Date(slot.year, slot.index, 1, NOTIF_HOUR_BILL, 0, 0, 0);
    if (at.getTime() <= now.getTime()) continue; // dia 1 desse mês já passou

    let total = 0;
    for (const item of items) {
      const isBill =
        item.category === CategoryType.FIXED_EXPENSE || item.category === CategoryType.CREDIT_CARD;
      if (!isBill) continue;
      const value = item.values[m] ?? 0;
      if (value <= 0) continue;
      if (item.paidStatus?.[m]) continue;
      total += value;
    }
    if (total <= 0) continue;

    out.push({
      id: MONTHLY_ID_BASE + out.length,
      title: 'Kashim · contas do mês',
      body: `Novo mês! Você tem ${formatCurrency(total)} em contas a pagar. Abra o Kashim, confira o que está em aberto e vá marcando as pagas.`,
      channelId: ANDROID_CHANNEL,
      schedule: { at, allowWhileIdle: true },
    });
    if (out.length >= MONTHLY_MAX) break;
  }
  return out;
}

// Lembrete "atualize seus dados" a cada N dias, às 10h.
function buildUpdateReminders(everyDays: number): ScheduledNotification[] {
  if (everyDays <= 0) return [];
  const out: ScheduledNotification[] = [];
  const now = new Date();
  const cursor = new Date(now);
  cursor.setHours(NOTIF_HOUR_UPDATE, 0, 0, 0);
  cursor.setDate(cursor.getDate() + everyDays);
  for (let i = 0; i < UPDATE_OCCURRENCES; i++) {
    out.push({
      id: UPDATE_ID_BASE + i,
      title: 'Kashim · mantenha seu plano em dia',
      body: 'Não esqueça de atualizar o sistema com seus gastos. Manter a frequência é o que faz o plano funcionar.',
      channelId: ANDROID_CHANNEL,
      schedule: { at: new Date(cursor), allowWhileIdle: true },
    });
    cursor.setDate(cursor.getDate() + everyDays);
  }
  return out;
}

// Diagnóstico: dispara uma notificação de teste em ~12s, independente de
// household/admin/preferências. Serve para o coach confirmar no próprio
// aparelho se o CANAL de entrega funciona (permissão + plugin + SO). Retorna o
// motivo para mostrar na tela — assim sabemos se o problema é o aparelho ou a
// falta de "Pagar dia" nas contas.
export async function scheduleTestNotification(): Promise<{ ok: boolean; reason: string }> {
  if (!isNativeApp) return { ok: false, reason: 'Você está na WEB — notificação só funciona no app instalado.' };
  try {
    if (!(await ensurePermission())) return { ok: false, reason: 'Permissão de notificação NEGADA neste aparelho. Ative nas configurações do celular.' };
    await ensureChannel();
    const at = new Date(Date.now() + 12000);
    await LocalNotifications.schedule({
      notifications: [{
        id: 799999,
        title: 'Kashim · teste de lembrete',
        body: 'Funciona! Os lembretes de conta chegam neste aparelho. 🎉',
        channelId: ANDROID_CHANNEL,
        schedule: { at, allowWhileIdle: true },
      }],
    });
    return { ok: true, reason: 'Agendado! Aguarde ~12s (pode minimizar o app). Se chegar, o canal funciona.' };
  } catch {
    return { ok: false, reason: 'Plugin de notificação ausente neste build (app desatualizado na loja).' };
  }
}

// Diagnóstico: dispara a FRASE DA SEMANA real em ~12s, para o coach ver como
// ela chega (sem esperar até segunda 8h). Usa a frase da semana atual.
export async function scheduleTestQuoteNotification(householdId: string): Promise<{ ok: boolean; reason: string }> {
  if (!isNativeApp) return { ok: false, reason: 'Você está na WEB — a frase só chega no app instalado.' };
  try {
    if (!(await ensurePermission())) return { ok: false, reason: 'Permissão de notificação NEGADA neste aparelho.' };
    await ensureChannel();
    const quote = getQuoteForDate(householdId || 'kashim', new Date());
    const body = quote.frase.length > BODY_MAX ? `${quote.frase.slice(0, BODY_MAX - 1)}…` : quote.frase;
    await LocalNotifications.schedule({
      notifications: [{
        id: 799998,
        title: weeklyTitle(new Date()),
        body,
        channelId: ANDROID_CHANNEL,
        schedule: { at: new Date(Date.now() + 12000), allowWhileIdle: true },
      }],
    });
    return { ok: true, reason: 'Agendada! Aguarde ~12s (pode minimizar o app) — é a frase desta semana.' };
  } catch {
    return { ok: false, reason: 'Plugin de notificação ausente neste build (app desatualizado).' };
  }
}

// Ponto de entrada único: pede permissão uma vez e reprograma tudo, respeitando
// as preferências do cliente. Idempotente e silencioso na web, sem permissão, ou
// se o plugin não existir (build antigo).
export async function refreshNotifications(params: {
  userId: string;
  householdId: string;
  items: FinanceItem[];
  months: MonthSlot[];
}): Promise<void> {
  const { userId, householdId, items, months } = params;
  if (!isNativeApp || !householdId) return;

  const prefs = getNotifPrefs(userId);

  try {
    if (!(await ensurePermission())) return;
    await ensureChannel();

    // Sempre cancela as três faixas antes de reprogramar — assim, desligar uma
    // preferência realmente remove os agendamentos daquele tipo.
    await cancelRange(QUOTE_ID_BASE, QUOTE_ID_RANGE);
    await cancelRange(BILL_ID_BASE, BILL_ID_RANGE);
    await cancelRange(MONTHLY_ID_BASE, MONTHLY_ID_RANGE);
    await cancelRange(UPDATE_ID_BASE, UPDATE_ID_RANGE);

    const notifications = [
      ...(prefs.weeklyQuote ? buildQuoteNotifications(householdId) : []),
      ...(prefs.bills ? buildBillNotifications(items, months) : []),
      ...(prefs.bills ? buildMonthlyBillReminders(items, months) : []),
      ...buildUpdateReminders(prefs.updateDays),
    ];
    if (notifications.length > 0) {
      await LocalNotifications.schedule({ notifications });
    }
  } catch {
    // Plugin ausente / permissão negada / erro de agendamento — não quebra o app
  }
}
