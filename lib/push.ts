// Push de servidor (OneSignal). Complementa — não substitui — as notificações
// LOCAIS de lib/notifications.ts.
//
// A diferença que motivou isto: notificação local só sabe o que o app sabia na
// última vez que foi aberto. Quando o cron importa transações às 11h e o app
// está fechado, o aparelho não tem como descobrir sozinho. "Chegaram 2
// lançamentos novos" nasce no servidor, então só push entrega (Eduardo,
// 2026-09-10).
//
// Só roda no app nativo. Na web o objeto do plugin não existe e todas as
// funções aqui saem calladas.

import { isNativeApp } from './onboarding/platform';

const APP_ID = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_ONESIGNAL_APP_ID ?? '';

/** O plugin entra via Cordova e vive no window. Tipado pelo que usamos. */
interface OneSignalGlobal {
  initialize: (appId: string) => void;
  Notifications: {
    requestPermission: (fallbackToSettings: boolean) => Promise<boolean>;
    addEventListener: (evt: string, cb: (e: unknown) => void) => void;
  };
  User: {
    pushSubscription: {
      id: string | null;
      addEventListener: (evt: string, cb: (e: unknown) => void) => void;
    };
    addAlias?: (label: string, id: string) => void;
  };
  login: (externalId: string) => void;
  logout: () => void;
}

function sdk(): OneSignalGlobal | null {
  const w = window as unknown as { plugins?: { OneSignal?: OneSignalGlobal }; OneSignal?: OneSignalGlobal };
  return w.plugins?.OneSignal ?? w.OneSignal ?? null;
}

let iniciado = false;

/**
 * Liga o push e manda o endereço do aparelho para o servidor.
 *
 * `registrar` é chamado com o id do OneSignal assim que ele existir. Ele pode
 * demorar: a Apple devolve o token de forma assíncrona, e no primeiro uso só
 * depois de a pessoa aceitar. Por isso ouvimos a mudança em vez de ler uma vez.
 */
export async function initPush(
  clerkUserId: string,
  registrar: (onesignalId: string, platform: string) => void,
): Promise<void> {
  if (!isNativeApp || !APP_ID || iniciado) return;
  const os = sdk();
  if (!os) return;
  iniciado = true;

  try {
    os.initialize(APP_ID);

    // Amarra o aparelho ao usuário do Clerk. Sem isto, trocar de conta no mesmo
    // celular faria a segunda pessoa receber os avisos da primeira.
    os.login(clerkUserId);

    const plataforma = /iPad|iPhone|iPod/.test(navigator.userAgent) ? 'ios' : 'android';

    const enviar = () => {
      const id = os.User.pushSubscription.id;
      if (id) registrar(id, plataforma);
    };

    os.User.pushSubscription.addEventListener('change', enviar);
    enviar(); // pode já existir, se a pessoa aceitou numa sessão anterior
  } catch {
    // Push é acessório: nada aqui pode impedir o app de abrir.
    iniciado = false;
  }
}

/**
 * Pede a permissão do sistema. Chamar num momento com CONTEXTO.
 *
 * Pedir na primeira abertura é o jeito mais rápido de tomar um "não" definitivo
 * — no iOS a recusa é permanente e só volta pelas Configurações do aparelho. O
 * lugar certo é depois de o cliente ver valor: ao conectar o banco, quando o
 * aviso de "chegaram lançamentos" passa a significar algo para ele.
 */
export async function pedirPermissaoPush(): Promise<boolean> {
  if (!isNativeApp || !APP_ID) return false;
  const os = sdk();
  if (!os) return false;
  try {
    return await os.Notifications.requestPermission(true);
  } catch {
    return false;
  }
}

/** Desliga este aparelho no servidor — o cliente saiu ou recusou. */
export function idDoAparelho(): string | null {
  const os = sdk();
  return os?.User?.pushSubscription?.id ?? null;
}
