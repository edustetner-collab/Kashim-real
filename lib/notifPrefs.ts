// Preferências de notificação do cliente. Guardadas no localStorage porque as
// notificações são LOCAIS (agendadas no próprio aparelho) — o lugar natural
// para o liga/desliga é o mesmo dispositivo que dispara. Keyed por usuário.

export interface NotifPrefs {
  weeklyQuote: boolean;   // frase motivacional da semana (segunda 8h)
  bills: boolean;         // lembrete de conta a vencer (9h no dia)
  tetoAlert: boolean;     // pop-up ao cruzar X% de um teto de gasto
  tetoPct: number;        // limiar do alerta de teto (%)
  updateDays: number;     // lembrete "atualize seus dados" a cada N dias (0 = desligado)
}

export const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  weeklyQuote: true,
  bills: true,
  tetoAlert: true,
  tetoPct: 80,
  // Ligado por padrão em 3 dias: se o cliente passar 3 dias sem abrir o app,
  // recebe o cutucão para lançar os gastos (reagendado a cada abertura, então
  // conta a partir da última vez que mexeu). Quem desligar nas Configurações
  // fica com o 0 salvo e não é afetado por esta mudança de padrão.
  updateDays: 3,
};

function key(userId: string): string {
  return `kashim_notifprefs_${userId}`;
}

export function getNotifPrefs(userId: string): NotifPrefs {
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return { ...DEFAULT_NOTIF_PREFS };
    const parsed = JSON.parse(raw) as Partial<NotifPrefs>;
    return { ...DEFAULT_NOTIF_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_NOTIF_PREFS };
  }
}

export function saveNotifPrefs(userId: string, prefs: NotifPrefs): void {
  try {
    localStorage.setItem(key(userId), JSON.stringify(prefs));
  } catch {
    // storage indisponível — silencioso
  }
}
