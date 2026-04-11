
import { SupabaseClient } from '@supabase/supabase-js';

// Verifica se há um token de convite na URL e processa
export async function processInviteFromUrl(
  db: SupabaseClient,
  clerkUserId: string
): Promise<string | null> {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('invite');
  if (!token) return null;

  try {
    // Busca o convite
    const { data: invite, error } = await db
      .from('household_invites')
      .select('*')
      .eq('token', token)
      .eq('status', 'pending')
      .single();

    if (error || !invite) return null;

    // Verifica se já não é membro de outro household
    const { data: existing } = await db
      .from('household_members')
      .select('household_id')
      .eq('clerk_user_id', clerkUserId)
      .maybeSingle();

    if (existing) {
      // Já tem household — remove o token da URL sem processar
      cleanInviteFromUrl();
      return existing.household_id;
    }

    // Verifica se o household já tem 2 membros
    const { count } = await db
      .from('household_members')
      .select('*', { count: 'exact', head: true })
      .eq('household_id', invite.household_id);

    if ((count ?? 0) >= 2) {
      cleanInviteFromUrl();
      return null;
    }

    // Aceita o convite — entra no household
    await db.from('household_members').insert({
      household_id: invite.household_id,
      clerk_user_id: clerkUserId,
      role: 'member',
    });

    // Marca convite como aceito
    await db
      .from('household_invites')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', invite.id);

    cleanInviteFromUrl();
    return invite.household_id;
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
