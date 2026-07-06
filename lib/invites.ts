// Processa um token de convite presente na URL, aceitando-o via endpoint
// server-side (/api/accept-invite). A validação (convite pendente, e-mail
// correto, limite de membros) e a inserção acontecem no servidor com a
// service key — o cliente NÃO insere em household_members diretamente.

export async function processInviteFromUrl(authToken: string | null): Promise<string | null> {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('invite');
  if (!token) return null;

  try {
    if (!authToken) {
      cleanInviteFromUrl();
      return null;
    }

    const res = await fetch('/api/accept-invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ token }),
    });

    cleanInviteFromUrl();

    if (!res.ok) return null;
    const data = (await res.json()) as { householdId?: string };
    return data.householdId ?? null;
  } catch (e) {
    console.error('Erro ao processar convite:', e);
    cleanInviteFromUrl();
    return null;
  }
}

function cleanInviteFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('invite');
  window.history.replaceState({}, '', url.toString());
}
