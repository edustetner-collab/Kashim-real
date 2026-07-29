-- ============================================================================
-- Encurtador de links PRÓPRIO (2026-07-XX)
-- ============================================================================
-- Substitui a dependência do is.gd (encurtador de terceiro, frágil e que
-- falhava com URLs longas → o link do cliente saía gigante). O link de acesso
-- do cliente (sign_in_token do Clerk) vira algo curto tipo
-- https://app.kashim.com.br/e/AbC123x e o /api/short-redirect resolve.
--
-- Acesso SOMENTE pela service key (server-side): RLS ligada, SEM policies →
-- anon/authenticated não leem nem escrevem. gen-link (grava) e short-redirect
-- (lê) usam a service key, que ignora RLS.

create table if not exists public.short_links (
  code        text primary key,
  target_url  text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz
);

alter table public.short_links enable row level security;

create index if not exists idx_short_links_expires on public.short_links(expires_at);
