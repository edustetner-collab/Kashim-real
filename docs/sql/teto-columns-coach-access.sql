-- ============================================================================
-- Gastos Frequentes: dar ao CONSULTOR o mesmo acesso que ele já tem nas outras
-- tabelas do cliente.  (2026-07-23)
-- ============================================================================
--
-- SINTOMA: na visão de consultor, um card criado à mão (ex.: "Balsa trabalho")
-- some ao trocar de aba. Os cards de mercado/transporte/lazer parecem
-- sobreviver, mas eles NÃO estão sendo lidos do banco — são recriados
-- automaticamente a partir dos itens a cada vez que a aba abre. Isso mascarou
-- o problema por várias rodadas.
--
-- CAUSA: `teto_columns` é lida e gravada DIRETO do navegador, sujeita ao RLS.
-- O JWT do consultor não é membro do household do cliente, então:
--   - o SELECT devolve zero linhas (o RLS filtra em silêncio, sem erro)
--   - o INSERT é recusado
-- O mesmo já era conhecido em `partial_expenses` — ver o comentário em
-- App.tsx (loadClientData), que por isso carrega via API com service key.
--
-- ============================================================================
-- PASSO 1 — DIAGNÓSTICO (rode primeiro e me mande o resultado)
-- ============================================================================
-- Compara as políticas de teto_columns com as de finance_items (que funciona
-- para o consultor). Se finance_items tiver uma política citando coach_access
-- e teto_columns não, a causa está confirmada.

select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('teto_columns', 'finance_items')
order by tablename, policyname;


-- ============================================================================
-- PASSO 2 — CORREÇÃO
-- ============================================================================
-- Adiciona uma política PERMISSIVA para o consultor. Políticas permissivas se
-- somam (OR), então isto NÃO remove nem restringe o acesso que o próprio dono
-- do household já tem. É seguro rodar mesmo que já exista (o drop é condicional).

drop policy if exists teto_columns_coach_access on public.teto_columns;

create policy teto_columns_coach_access
  on public.teto_columns
  for all
  using (
    exists (
      select 1
      from public.coach_access ca
      where ca.household_id = teto_columns.household_id
        and ca.coach_clerk_user_id = auth.jwt() ->> 'sub'
    )
  )
  with check (
    exists (
      select 1
      from public.coach_access ca
      where ca.household_id = teto_columns.household_id
        and ca.coach_clerk_user_id = auth.jwt() ->> 'sub'
    )
  );


-- ============================================================================
-- PASSO 3 — CONFERÊNCIA
-- ============================================================================
-- Deve listar a política recém-criada.

select policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'teto_columns'
order by policyname;
