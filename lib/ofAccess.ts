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
export const OF_BETA_EMAILS = ['eduardo_cda@hotmail.com', 'remmachado.86@gmail.com', 'mouragiany@gmail.com', 'edununesbenedito@gmail.com',
  'dlcosta.dev@gmail.com', 'arquiteturabrunamaia@gmail.com', 'hugoale09@gmail.com',
  'luciana.luciano@gmail.com', 'cayolcarvalho@hotmail.com',
  'alex.radiologia@icloud.com',
  'kl_soares@yahoo.com.br',
  'edu.stetner@gmail.com',
  'elisamarodriguees@hotmail.com',
  'lucas.coppede.damiao@gmail.com', 'coppede.bruna@gmail.com',
  'zaidandesouza@gmail.com',
  'maia.miriam@gmail.com',
  'thaisrochafraga02@gmail.com'];

interface ClerkLikeUser {
  id?: string | null;
  emailAddresses?: Array<{ emailAddress?: string | null }>;
}

/**
 * Quem vê Open Finance.
 *
 * REGRA DE LANÇAMENTO (Eduardo, 2026-09-24): quem cria a conta sozinho — o
 * público que vem do Instagram — entra direto. Cliente de consultoria (casa com
 * vínculo de coach, criada pelo Eduardo ou pela assistente) continua FORA até
 * ele mandar abrir: são planos montados a mão, que seriam reprojetados pela
 * migração para o Open Finance.
 *
 * `clienteDeCoach` vem do app depois de `check-coach-access` responder:
 *   true  = casa com coach → só entra se estiver na lista nominal
 *   false = conta própria → entra
 *   null/undefined = ainda não sei → NÃO mostra (nunca vazar por default)
 */
export function hasOpenFinanceAccess(
  user: ClerkLikeUser | null | undefined,
  clienteDeCoach?: boolean | null,
): boolean {
  if (!user) return false;
  if (user.id && BETA_USER_IDS.includes(user.id)) return true;

  const naLista = (user.emailAddresses ?? []).some((e) => {
    const email = e?.emailAddress?.toLowerCase();
    return !!email && OF_BETA_EMAILS.includes(email);
  });
  if (naLista) return true;

  return clienteDeCoach === false;
}
