/**
 * Quem enxerga Open Finance no aplicativo.
 *
 * Decisão do Eduardo (2026-08-11): durante os testes, **só ele**. Depois, uma
 * lista nominal que ele indicar. Só então abre para todos. Mostrar antes disso
 * bagunça a cabeça de quem já usa o app para lançamento manual.
 *
 * Este é o único lugar que decide. Onboarding, Configurações e o botão de
 * Extrato consultam esta função — foi justamente por a regra estar espalhada
 * que o botão de Extrato acabou visível para todos os clientes em produção
 * enquanto o "Gerenciar bancos" estava protegido.
 *
 * `VITE_OF_BETA_USER_IDS` (IDs do Clerk separados por vírgula) amplia a lista
 * sem tocar no código. Vazia, vale só o e-mail abaixo.
 *
 * O servidor faz a mesma checagem em `api/of-connect.ts` — esconder o botão não
 * impede ninguém de chamar a rota direto.
 */

const BETA_USER_IDS: string[] = (import.meta.env.VITE_OF_BETA_USER_IDS ?? '')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);

/** Mantido em código para o portão nunca depender de configuração existir. */
export const OF_BETA_EMAILS = ['eduardo_cda@hotmail.com'];

interface ClerkLikeUser {
  id?: string | null;
  emailAddresses?: Array<{ emailAddress?: string | null }>;
}

export function hasOpenFinanceAccess(user: ClerkLikeUser | null | undefined): boolean {
  if (!user) return false;
  if (user.id && BETA_USER_IDS.includes(user.id)) return true;

  return (user.emailAddresses ?? []).some((e) => {
    const email = e?.emailAddress?.toLowerCase();
    return !!email && OF_BETA_EMAILS.includes(email);
  });
}
