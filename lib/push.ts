// Push de servidor. Complementa — não substitui — as notificações LOCAIS de
// lib/notifications.ts.
//
// A diferença que motivou isto: notificação local só sabe o que o app sabia na
// última vez que foi aberto. Quando o cron importa transações às 11h e o app
// está fechado, o aparelho não tem como descobrir sozinho. "Chegaram 2
// lançamentos novos" nasce no servidor, então só push entrega (Eduardo,
// 2026-09-10).
//
// POR QUE O PLUGIN OFICIAL E NÃO O SDK DO ONESIGNAL: o projeto iOS usa Swift
// Package Manager (ios/App/CapApp-SPM, sem Podfile) e o plugin do OneSignal é
// Cordova, sem Package.swift — `npx cap sync ios` morre com erro fatal e a
// build no Codemagic nem começaria. O caminho é o `@capacitor/push-notifications`
// pegar o token da APNs e o SERVIDOR registrar esse token no OneSignal. O painel
// e a segmentação continuam valendo; o que muda é quem faz a ponte.

import { PushNotifications } from '@capacitor/push-notifications';
import { isNativeApp } from './onboarding/platform';

let ligado = false;

/**
 * Liga o push e entrega o token da APNs a quem souber guardá-lo.
 *
 * `registrar` é chamado quando o token chega — e ele chega de forma assíncrona:
 * a Apple responde depois, e no primeiro uso só depois de a pessoa aceitar. Por
 * isso ouvimos o evento em vez de tentar ler uma vez.
 *
 * NÃO pede permissão aqui. Só reativa quem já aceitou antes; o pedido tem hora
 * certa e vive em `pedirPermissaoPush()`.
 */
export async function initPush(
  registrar: (token: string, platform: string) => void,
): Promise<void> {
  if (!isNativeApp || ligado) return;
  ligado = true;

  try {
    const perm = await PushNotifications.checkPermissions();
    if (perm.receive !== 'granted') return; // ainda não aceitou: nada a fazer

    const plataforma = /iPad|iPhone|iPod/.test(navigator.userAgent) ? 'ios' : 'android';

    await PushNotifications.addListener('registration', (t) => {
      if (t?.value) registrar(t.value, plataforma);
    });
    await PushNotifications.addListener('registrationError', () => {
      // Sem token não há push. O e-mail continua cobrindo o aviso.
    });

    await PushNotifications.register();
  } catch {
    ligado = false; // push é acessório: nada aqui pode impedir o app de abrir
  }
}

/**
 * Diagnóstico de push, para abrir com `?testepush=1`.
 *
 * O registro acontece em silêncio e falha em silêncio — três try/catch no
 * caminho, porque nada aqui pode impedir o app de abrir. Quando `push_devices`
 * fica vazia não há como saber ONDE parou: plugin ausente, permissão negada,
 * token que não chega ou POST recusado. Isto conta.
 */
export async function diagnosticoPush(): Promise<string> {
  const linhas: string[] = [];
  linhas.push(`app nativo: ${isNativeApp ? 'sim' : 'NÃO — push só funciona no app'}`);
  linhas.push(`plugin presente: ${typeof PushNotifications?.register === 'function' ? 'sim' : 'NÃO — a build é anterior ao push'}`);

  if (!isNativeApp) return linhas.join('\n');

  try {
    const perm = await PushNotifications.checkPermissions();
    linhas.push(`permissão: ${perm.receive}`);

    if (perm.receive !== 'granted') {
      const r = await PushNotifications.requestPermissions();
      linhas.push(`após pedir: ${r.receive}`);
      if (r.receive !== 'granted') return linhas.join('\n');
    }

    const token = await new Promise<string | null>((resolve) => {
      const t = setTimeout(() => resolve(null), 8000);
      PushNotifications.addListener('registration', (x) => {
        clearTimeout(t); resolve(x?.value ?? null);
      });
      PushNotifications.addListener('registrationError', (e) => {
        clearTimeout(t); resolve(`ERRO: ${JSON.stringify(e)}`);
      });
      PushNotifications.register();
    });

    linhas.push(token
      ? (token.startsWith('ERRO') ? token : `token recebido: ${token.slice(0, 12)}… (${token.length} ch)`)
      : 'token NÃO chegou em 8s — a Apple não respondeu');
    return linhas.join('\n');
  } catch (e) {
    linhas.push(`exceção: ${e instanceof Error ? e.message : String(e)}`);
    return linhas.join('\n');
  }
}

/**
 * Pede a permissão do sistema. Chamar num momento com CONTEXTO.
 *
 * Pedir na primeira abertura é o jeito mais rápido de tomar um "não" definitivo
 * — no iOS a recusa é permanente e só volta pelas Configurações do aparelho. O
 * lugar certo é depois de o cliente ver valor: ao conectar o banco, quando
 * "a gente te avisa quando seus gastos chegarem" passa a significar algo.
 */
export async function pedirPermissaoPush(
  registrar?: (token: string, platform: string) => void,
): Promise<boolean> {
  if (!isNativeApp) return false;
  try {
    const r = await PushNotifications.requestPermissions();
    if (r.receive !== 'granted') return false;

    if (registrar) {
      const plataforma = /iPad|iPhone|iPod/.test(navigator.userAgent) ? 'ios' : 'android';
      await PushNotifications.addListener('registration', (t) => {
        if (t?.value) registrar(t.value, plataforma);
      });
    }
    await PushNotifications.register();
    return true;
  } catch {
    return false;
  }
}
