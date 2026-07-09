-- ============================================================================
-- BLINDAGEM DE SEGURANÇA + ESCALA — Kashim
-- Rodar no Supabase: Dashboard -> SQL Editor. Ler os comentários de cada bloco.
-- Rodar os blocos NA ORDEM. O bloco 2 tem uma verificação ANTES do ALTER.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- BLOCO 1 (SEGURANÇA / crítico): impedir cliente de editar `households`
-- ----------------------------------------------------------------------------
-- Furo: a chave anônima do Supabase vive no bundle do front. Se o cliente tiver
-- permissão de UPDATE em households, um usuário com token válido pode se dar
-- premium de graça: update(subscription_status = 'active').
-- O app NÃO faz mais UPDATE direto (tudo passa por /api/* com service key),
-- então revogar não quebra nada. A service key ignora estes grants.
revoke update on public.households from anon;
revoke update on public.households from authenticated;

-- (Opcional, defesa extra) impedir insert/delete direto do cliente também —
-- criação/remoção de household já é 100% server-side (ensure-household /
-- delete-client). Descomente se quiser fechar tudo:
-- revoke insert, delete on public.households from anon, authenticated;


-- ----------------------------------------------------------------------------
-- BLOCO 2 (ESCALA / integridade): 1 usuário = no máximo 1 household
-- ----------------------------------------------------------------------------
-- Sob acesso simultâneo, o check-then-insert de ensure-household podia criar
-- household duplicado para o mesmo usuário (dados divididos em duas casas).
-- Esta UNIQUE constraint torna a criação idempotente e atômica no banco.
--
-- PASSO 2a — RODE PRIMEIRO e confira que retorna ZERO linhas. Se retornar
-- alguma, há duplicata pré-existente que precisa ser resolvida à mão ANTES
-- de criar a constraint (me chame com o resultado).
select clerk_user_id, count(*) as n
from public.household_members
group by clerk_user_id
having count(*) > 1;

-- PASSO 2b — só rode se o 2a voltou vazio:
alter table public.household_members
  add constraint household_members_clerk_user_id_key unique (clerk_user_id);


-- ----------------------------------------------------------------------------
-- BLOCO 3 (ESCALA / performance): índices para leituras quentes
-- ----------------------------------------------------------------------------
-- Com centenas de usuários, as queries filtram sempre por household_id.
-- Sem índice, o Postgres varre a tabela inteira a cada leitura. IF NOT EXISTS
-- torna seguro rodar mesmo que algum já exista.
create index if not exists idx_finance_items_household  on public.finance_items(household_id);
create index if not exists idx_partial_expenses_item    on public.partial_expenses(finance_item_id);
create index if not exists idx_household_members_hh      on public.household_members(household_id);
create index if not exists idx_coach_access_household    on public.coach_access(household_id);
create index if not exists idx_coach_access_coach        on public.coach_access(coach_clerk_user_id);
create index if not exists idx_goals_household           on public.goals(household_id);
create index if not exists idx_teto_columns_household    on public.teto_columns(household_id);
