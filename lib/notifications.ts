// Notificações locais (agendadas no próprio aparelho — sem servidor, sem
// Firebase, sem APNs). Hoje: frase motivacional toda segunda-feira de manhã.
//
// Como funciona: o app calcula as próximas N segundas-feiras, deriva a frase
// determinística de cada uma (a mesma que o app mostraria) e agenda tudo de uma
// vez no sistema operacional. O SO dispara sozinho, mesmo com o app fechado ou
// offline. A cada abertura do app reagendamos, mantendo uma janela rolante.

import { LocalNotifications } from '@capacitor/local-notifications';
import { isNativeApp } from './onboarding/platform';
import { getQuoteForDate } from './quotes';

const WEEKS_AHEAD = 10;          // quantas semanas pré-agendar por vez
const NOTIF_HOUR = 8;            // 8h da manhã
const NOTIF_MINUTE = 0;
const ID_BASE = 720000;          // faixa de IDs reservada às frases semanais
const ID_RANGE = 1000;
const ANDROID_CHANNEL = 'kashim-weekly';
const BODY_MAX = 240;            // corte de segurança; o SO expande no toque

// Próximas `count` segundas-feiras às NOTIF_HOUR (sempre no futuro).
function upcomingMondays(count: number): Date[] {
  const result: Date[] = [];
  const now = new Date();
  const cursor = new Date(now);
  cursor.setHours(NOTIF_HOUR, NOTIF_MINUTE, 0, 0);
  // Anda até a próxima segunda-feira (getDay: 0=dom, 1=seg)
  const daysUntilMonday = (8 - cursor.getDay()) % 7; // 0 se já é segunda
  cursor.setDate(cursor.getDate() + daysUntilMonday);
  // Se cair hoje (segunda) mas o horário já passou, pula para a próxima
  if (cursor.getTime() <= now.getTime()) cursor.setDate(cursor.getDate() + 7);
  for (let i = 0; i < count; i++) {
    result.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  return result;
}

// Idempotente: pode chamar a cada abertura do app. Pede permissão na 1ª vez,
// cancela o lote anterior e reprograma a janela rolante. Silencioso se não for
// app nativo, se a permissão for negada, ou se o plugin não existir (build
// antigo ainda em campo antes da atualização nativa).
export async function scheduleWeeklyQuotes(householdId: string): Promise<void> {
  if (!isNativeApp || !householdId) return;

  try {
    let granted = (await LocalNotifications.checkPermissions()).display === 'granted';
    if (!granted) {
      granted = (await LocalNotifications.requestPermissions()).display === 'granted';
    }
    if (!granted) return;

    // Android 8+: canal dedicado (iOS ignora)
    try {
      await LocalNotifications.createChannel({
        id: ANDROID_CHANNEL,
        name: 'Frase da semana',
        description: 'Sua dose semanal de foco financeiro',
        importance: 4,
      });
    } catch {
      // createChannel não existe no iOS — ok
    }

    // Cancela o lote anterior (só a nossa faixa de IDs) antes de reprogramar
    const pending = await LocalNotifications.getPending();
    const ours = pending.notifications.filter(
      n => typeof n.id === 'number' && n.id >= ID_BASE && n.id < ID_BASE + ID_RANGE
    );
    if (ours.length > 0) {
      await LocalNotifications.cancel({ notifications: ours.map(n => ({ id: n.id })) });
    }

    const notifications = upcomingMondays(WEEKS_AHEAD).map((date, i) => {
      const quote = getQuoteForDate(householdId, date);
      const body = quote.frase.length > BODY_MAX ? `${quote.frase.slice(0, BODY_MAX - 1)}…` : quote.frase;
      return {
        id: ID_BASE + i,
        title: 'Kashim · sua frase da semana',
        body,
        channelId: ANDROID_CHANNEL,
        schedule: { at: date, allowWhileIdle: true },
      };
    });

    await LocalNotifications.schedule({ notifications });
  } catch {
    // Plugin ausente (app nativo antigo) ou erro de agendamento — não quebra o app
  }
}
