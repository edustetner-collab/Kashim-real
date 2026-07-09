-- ============================================================================
-- REGISTRO DE ACEITE DOS TERMOS (LGPD art. 8º, §1º — ônus da prova do consentimento)
-- Rodar no Supabase: Dashboard -> SQL Editor -> colar tudo -> Run.
-- Seguro rodar mais de uma vez.
-- ============================================================================

-- Uma linha por (usuário, versão dos termos). Quando os termos mudarem de
-- versão, o usuário aceita de novo e ganha uma nova linha — o histórico fica
-- preservado, que é justamente o que a LGPD exige poder demonstrar.
create table if not exists public.terms_acceptances (
  clerk_user_id text        not null,
  terms_version text        not null,
  accepted_at   timestamptz not null default now(),
  primary key (clerk_user_id, terms_version)
);

alter table public.terms_acceptances enable row level security;

-- O usuário lê o próprio aceite (para o app saber se já aceitou)
drop policy if exists "terms_select_own" on public.terms_acceptances;
create policy "terms_select_own" on public.terms_acceptances
  for select using (clerk_user_id = auth.jwt() ->> 'sub');

-- O usuário registra o próprio aceite, e só o próprio
drop policy if exists "terms_insert_own" on public.terms_acceptances;
create policy "terms_insert_own" on public.terms_acceptances
  for insert with check (clerk_user_id = auth.jwt() ->> 'sub');

-- Sem policy de UPDATE/DELETE de propósito: o registro é imutável para o
-- cliente. Só a service key (servidor) consegue alterar. Isso preserva o valor
-- probatório do aceite.
revoke update, delete on public.terms_acceptances from anon, authenticated;
