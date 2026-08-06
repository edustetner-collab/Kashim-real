-- Fecha o furo de "premium grátis" (MÉDIO — receita, não isolamento).
--
-- Problema: um membro do household podia dar UPDATE em `households` via RLS,
-- inclusive em `subscription_status`/`subscription_expires_at` → virar premium
-- de graça.
--
-- Fato verificado no código (2026-08-06): o CLIENTE nunca atualiza `households`
-- direto. TODAS as escritas passam por endpoints com SERVICE KEY (que ignora
-- GRANT/RLS): update-start-month, toggle-privacy, cancel-subscription,
-- activate-client, agendamentos-link e o pagarme-webhook. Logo, revogar o UPDATE
-- dos papéis do cliente NÃO quebra nada e fecha o furo por completo.
--
-- Rodar UMA vez no SQL Editor do Supabase.

revoke update on table households from authenticated;
revoke update on table households from anon;

-- Conferência: as duas linhas abaixo devem retornar VAZIO (nenhum update).
-- select grantee, privilege_type
--   from information_schema.role_table_grants
--  where table_name = 'households'
--    and privilege_type = 'UPDATE'
--    and grantee in ('anon','authenticated');

-- Reverter (se algum dia o cliente precisar atualizar households direto):
--   grant update on table households to authenticated;
