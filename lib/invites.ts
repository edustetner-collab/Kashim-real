// Processa um token de convite ("Modo Casal") presente na URL, aceitando-o via
// endpoint server-side (/api/accept-invite). A validação (convite pendente,
// limite de membros) e a inserção acontecem no servidor com a service key — o
// cliente NUNCA insere em household_members diretamente.
//
// PROBLEMA HISTÓRICO (2026-07-27): o token vinha só da URL. Como o cônjuge
// precisa criar conta no Clerk ANTES de o app processar o convite, e o fluxo de
// verificação de e-mail do Clerk redireciona limpando a query string, o token
// se perdia. O app então criava um household SOLO e o convite ficava travado
// para sempre (accept-invite passa a responder "já é membro"). Solução: assim
// que a página abre com ?invite=..., guardamos o token em localStorage, e ele
// sobrevive a qualquer redirect até o aceite dar certo.

const PENDING_INVITE_KEY = 'kashim_pending_invite';

/** Chame o mais cedo possível no boot: se a URL tem ?invite=..., persiste o
 *  token (sobrevive ao cadastro/redirect do Clerk) e limpa a query string. */
export function captureInviteFromUrl(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('invite');
    if (!token) return;
    localStorage.setItem(PENDING_INVITE_KEY, token);
    cleanInviteFromUrl();
  } catch {
    /* ignore */
  }
}

/** Há um convite pendente aguardando aceite? (usado p/ abrir a tela de cadastro
 *  em vez da de login quando o cônjuge chega pelo link). */
export function hasPendingInvite(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('invite')) return true;
    return !!localStorage.getItem(PENDING_INVITE_KEY);
  } catch {
    return false;
  }
}

function getPendingInviteToken(): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('invite');
    return fromUrl ?? localStorage.getItem(PENDING_INVITE_KEY);
  } catch {
    return null;
  }
}

function clearPendingInvite(): void {
  try { localStorage.removeItem(PENDING_INVITE_KEY); } catch { /* ignore */ }
  cleanInviteFromUrl();
}

export async function processInviteFromUrl(authToken: string | null): Promise<string | null> {
  const token = getPendingInviteToken();
  if (!token) return null;

  // Sem token de auth ainda: NÃO limpa o convite — ele precisa sobreviver até
  // o usuário terminar de se autenticar. Só tentamos aceitar quando há auth.
  if (!authToken) return null;

  try {
    const res = await fetch('/api/accept-invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ token }),
    });

    if (res.ok) {
      clearPendingInvite();
      const data = (await res.json()) as { householdId?: string };
      return data.householdId ?? null;
    }

    // O servidor respondeu com erro definitivo (convite inválido/usado, ou o
    // usuário já está em outra conta compartilhada): não adianta reter para
    // retry — limpa para não prender o usuário num loop.
    if (res.status === 404 || res.status === 403 || res.status === 409) {
      clearPendingInvite();
    }
    // Demais status (5xx): mantém o token para nova tentativa no próximo load.
    return null;
  } catch (e) {
    // Falha de rede: mantém o token em localStorage para tentar de novo.
    console.error('Erro ao processar convite:', e);
    return null;
  }
}

function cleanInviteFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('invite');
  window.history.replaceState({}, '', url.toString());
}
