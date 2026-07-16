-- ============================================================================
-- TABELA trial_emails — dedup da régua de e-mails do trial (30/15/7/1/0 dias)
-- Rodar no Supabase: Dashboard -> SQL Editor. Uma vez só.
--
-- Sem esta tabela a rota /api/trial-reminders NÃO envia nada (ela se recusa a
-- enviar sem garantia de dedup, para nunca duplicar e-mail).
-- ============================================================================

create table if not exists public.trial_emails (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  clerk_user_id text not null,
  milestone int not null,          -- 30, 15, 7, 1 ou 0 (dias restantes)
  sent_at timestamptz not null default now(),
  -- cada marco é enviado UMA única vez por pessoa
  constraint trial_emails_once unique (household_id, clerk_user_id, milestone)
);

-- RLS ligado SEM policies = cliente não lê nem escreve; só a service key
-- (mesmo padrão da tabela debts).
alter table public.trial_emails enable row level security;

create index if not exists idx_trial_emails_household on public.trial_emails(household_id);
