// Aceite dos Termos de Uso / Política de Privacidade.
//
// Por que existe: clientes ativados pelo consultor entram por link mágico
// (sign_in_token) e nunca passam pela tela de cadastro — onde ficava o único
// aviso de "ao criar sua conta você concorda...". Como os termos apontam
// Consentimento (LGPD art. 7º, I) como base legal para análise por IA e para
// compartilhar dados com o consultor, precisamos poder DEMONSTRAR o aceite
// (LGPD art. 8º, §1º). Daí o registro em banco.

import { SupabaseClient } from '@supabase/supabase-js';

// Bump quando os termos mudarem de forma MATERIAL → todos aceitam de novo.
//
// Não basta o texto mudar: bumpar aqui põe o TermsGate na frente de TODO
// cliente na próxima abertura. E o item 2.9 dos próprios termos promete aviso
// por e-mail com 15 dias de antecedência para alteração relevante — forçar o
// aceite sem esse aviso descumpre o que assinamos.
//
// Regra: bumpar quando a mudança RESTRINGE direito do usuário, cria obrigação
// nova ou muda base legal de tratamento (LGPD). Não bumpar quando só esclarece,
// amplia direito, ou alinha o texto ao que o app já fazia.
//
// A v1.1 do HTML (ago/2026) ficou de fora do bump de propósito: ela acrescentou
// o direito de arrependimento de 7 dias (art. 49 CDC), detalhou o cancelamento
// e documentou o plano Open Finance, que o checkout JÁ vendia — ou seja,
// corrigiu documentação atrasada e ampliou direitos. Nada que restrinja o
// usuário. Se um dia o Eduardo quiser o aceite renovado, o caminho é: e-mail
// aos clientes → esperar 15 dias → bumpar para '1.1'.
export const TERMS_VERSION = '1.0';

const TABLE = 'terms_acceptances';

function localKey(userId: string): string {
  return `kashim_terms_${userId}_${TERMS_VERSION}`;
}

// null = indeterminado (erro de rede). O App trata null como "não bloquear",
// para nunca trancar o usuário fora dos próprios dados financeiros por uma
// falha de rede — a verificação roda de novo na próxima abertura.
export async function hasAcceptedTerms(
  db: SupabaseClient,
  userId: string
): Promise<boolean | null> {
  if (localStorage.getItem(localKey(userId)) === '1') return true;

  try {
    const { data, error } = await db
      .from(TABLE)
      .select('accepted_at')
      .eq('clerk_user_id', userId)
      .eq('terms_version', TERMS_VERSION)
      .maybeSingle();

    if (error) return null;
    if (data) {
      localStorage.setItem(localKey(userId), '1');
      return true;
    }
    return false;
  } catch {
    return null;
  }
}

export async function recordTermsAcceptance(
  db: SupabaseClient,
  userId: string
): Promise<void> {
  // accepted_at fica a cargo do default do banco (now()), não do relógio do cliente
  const { error } = await db
    .from(TABLE)
    .insert({ clerk_user_id: userId, terms_version: TERMS_VERSION });

  // 23505 = já existia (duplo clique / duas abas). Aceite é idempotente.
  if (error && error.code !== '23505') throw new Error(error.message);

  localStorage.setItem(localKey(userId), '1');
}
