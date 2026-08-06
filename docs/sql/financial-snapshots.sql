-- financial_snapshots — backup automático do plano do cliente (rede de segurança
-- contra perda de dados). Uma linha por (household, mês, ano); o app faz upsert
-- do plano INTEIRO (snapshot_data = todos os finance_items) a cada mudança
-- (debounce 6s). Ver App.tsx (efeito de snapshot) e lib/db.ts::saveSnapshot.
--
-- Rodar UMA vez no SQL Editor do Supabase. Idempotente.

create table if not exists financial_snapshots (
  household_id       uuid    not null references households(id) on delete cascade,
  month              int     not null,   -- mês do calendário (0-11)
  year               int     not null,
  total_income       numeric default 0,
  total_fixed        numeric default 0,
  total_variable     numeric default 0,
  total_leisure      numeric default 0,
  total_credit_card  numeric default 0,
  balance            numeric default 0,
  accumulated        numeric default 0,
  snapshot_data      jsonb,
  updated_at         timestamptz default now(),
  primary key (household_id, month, year)
);

alter table financial_snapshots enable row level security;

-- Dono/parceiro (membro do household) — leitura e escrita do próprio backup.
drop policy if exists "snap owner all" on financial_snapshots;
create policy "snap owner all" on financial_snapshots
  for all to public
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

-- Coach com acesso aprovado — pode ler/gravar o backup do cliente.
drop policy if exists "snap coach all" on financial_snapshots;
create policy "snap coach all" on financial_snapshots
  for all to public
  using (exists (
    select 1 from coach_access ca
    where ca.household_id = financial_snapshots.household_id
      and ca.coach_clerk_user_id = requesting_user_id()
      and ca.status = 'approved'
  ))
  with check (exists (
    select 1 from coach_access ca
    where ca.household_id = financial_snapshots.household_id
      and ca.coach_clerk_user_id = requesting_user_id()
      and ca.status = 'approved'
  ));
