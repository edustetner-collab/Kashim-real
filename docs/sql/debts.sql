-- ============================================================================
-- Aba DÍVIDAS — dívidas/empréstimos em aberto do cliente.
-- Rodar no Supabase: Dashboard -> SQL Editor -> colar tudo -> Run.
-- Acesso só via service key (API /api/debts) — RLS sem policies bloqueia o
-- cliente direto; a API autoriza membro/coach/admin.
-- ============================================================================

create table if not exists public.debts (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null,
  name              text not null default '',
  installment_value numeric not null default 0,   -- valor de cada parcela
  installment_count integer not null default 0,   -- quantidade de parcelas
  payoff_value      numeric not null default 0,    -- valor de quitação
  interest_rate     numeric,                        -- taxa de juros (futuro)
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now()
);

alter table public.debts enable row level security;

create index if not exists idx_debts_household on public.debts(household_id);
