-- Tabela de progresso do onboarding interativo.
-- RODAR NO SUPABASE: Dashboard → SQL Editor → colar tudo → Run.
-- Seguro rodar mais de uma vez (if not exists / drop policy if exists).

create table if not exists public.onboarding_progress (
  clerk_user_id      text primary key,
  tours_completed    text[]      not null default '{}',
  tours_skipped      text[]      not null default '{}',
  current_tour_id    text,
  current_step_index integer,
  updated_at         timestamptz not null default now()
);

alter table public.onboarding_progress enable row level security;

-- Cada usuário só lê/escreve a própria linha.
-- O claim 'sub' do JWT do Clerk (template supabase) contém o Clerk user ID.

drop policy if exists "onboarding_select_own" on public.onboarding_progress;
create policy "onboarding_select_own" on public.onboarding_progress
  for select using (clerk_user_id = auth.jwt() ->> 'sub');

drop policy if exists "onboarding_insert_own" on public.onboarding_progress;
create policy "onboarding_insert_own" on public.onboarding_progress
  for insert with check (clerk_user_id = auth.jwt() ->> 'sub');

drop policy if exists "onboarding_update_own" on public.onboarding_progress;
create policy "onboarding_update_own" on public.onboarding_progress
  for update using (clerk_user_id = auth.jwt() ->> 'sub')
  with check (clerk_user_id = auth.jwt() ->> 'sub');
