-- ============================================================================
-- CONSULTOR: permitir CRIAR itens (não só editar os que já existem)
-- (2026-07-24)
-- ============================================================================
--
-- SINTOMA: ao montar o plano de um cliente novo (ex.: Miriam), lançar "Lazer e
-- Despesas Pessoais" não salva. O console mostra, em cascata:
--
--   POST /finance_items → 403
--   {code: '42501', message: 'new row violates row-level security policy
--                             for table "finance_items"'}
--   POST /teto_columns  → 409
--   {code: '23503', details: 'Key is not present in table "finance_items".'}
--
-- CAUSA: 42501 é a cláusula WITH CHECK do RLS recusando a LINHA NOVA. O
-- consultor consegue editar itens que já existem (USING passa), mas NÃO
-- consegue inserir itens novos (WITH CHECK falha). O erro do teto_columns é
-- apenas consequência: o card aponta para um item que nunca chegou ao banco,
-- e a foreign key o rejeita.
--
-- Isto é o mesmo furo corrigido em teto-columns-coach-access.sql, agora nas
-- tabelas principais. Vale para todo cliente NOVO — no cliente antigo os itens
-- padrão já existiam, então só a edição era exercitada e o furo ficou escondido.
--
-- ============================================================================
-- PASSO 1 — DIAGNÓSTICO (rode primeiro e me mande o resultado)
-- ============================================================================
-- Mostra as políticas atuais. Procure por: política do consultor que tenha
-- `qual` (USING) preenchido mas `with_check` NULO, ou cmd = UPDATE/SELECT sem
-- um INSERT correspondente. É essa a assinatura do problema.

select tablename, policyname, cmd,
       qual       as using_expr,
       with_check as with_check_expr
from pg_policies
where schemaname = 'public'
  and tablename in ('finance_items', 'partial_expenses', 'goals')
order by tablename, policyname;


-- ============================================================================
-- PASSO 2 — CORREÇÃO
-- ============================================================================
-- Política PERMISSIVA para o consultor, com USING **e** WITH CHECK. Políticas
-- permissivas se somam (OR): isto NÃO remove nem restringe o acesso que o dono
-- do household já tem. Idempotente — pode rodar mais de uma vez.
--
-- Escopo: só alcança households em que o consultor está explicitamente
-- registrado em coach_access. Um consultor nunca alcança cliente de outro.

-- ── finance_items ───────────────────────────────────────────────────────────
drop policy if exists finance_items_coach_write on public.finance_items;

create policy finance_items_coach_write
  on public.finance_items
  for all
  using (
    exists (
      select 1 from public.coach_access ca
      where ca.household_id = finance_items.household_id
        and ca.coach_clerk_user_id = auth.jwt() ->> 'sub'
    )
  )
  with check (
    exists (
      select 1 from public.coach_access ca
      where ca.household_id = finance_items.household_id
        and ca.coach_clerk_user_id = auth.jwt() ->> 'sub'
    )
  );

-- ── partial_expenses ────────────────────────────────────────────────────────
-- Não tem household_id: o vínculo é via finance_item_id. Já era sabidamente
-- bloqueada para o consultor (ver comentário em loadClientData, em App.tsx,
-- que por isso carrega via API com service key).
drop policy if exists partial_expenses_coach_write on public.partial_expenses;

create policy partial_expenses_coach_write
  on public.partial_expenses
  for all
  using (
    exists (
      select 1
      from public.finance_items fi
      join public.coach_access ca on ca.household_id = fi.household_id
      where fi.id = partial_expenses.finance_item_id
        and ca.coach_clerk_user_id = auth.jwt() ->> 'sub'
    )
  )
  with check (
    exists (
      select 1
      from public.finance_items fi
      join public.coach_access ca on ca.household_id = fi.household_id
      where fi.id = partial_expenses.finance_item_id
        and ca.coach_clerk_user_id = auth.jwt() ->> 'sub'
    )
  );

-- ── goals ───────────────────────────────────────────────────────────────────
drop policy if exists goals_coach_write on public.goals;

create policy goals_coach_write
  on public.goals
  for all
  using (
    exists (
      select 1 from public.coach_access ca
      where ca.household_id = goals.household_id
        and ca.coach_clerk_user_id = auth.jwt() ->> 'sub'
    )
  )
  with check (
    exists (
      select 1 from public.coach_access ca
      where ca.household_id = goals.household_id
        and ca.coach_clerk_user_id = auth.jwt() ->> 'sub'
    )
  );


-- ============================================================================
-- PASSO 3 — CONFERÊNCIA
-- ============================================================================
-- As três políticas novas devem aparecer, todas com with_check preenchido.

select tablename, policyname, cmd,
       (with_check is not null) as tem_with_check
from pg_policies
where schemaname = 'public'
  and policyname in ('finance_items_coach_write',
                     'partial_expenses_coach_write',
                     'goals_coach_write')
order by tablename;
