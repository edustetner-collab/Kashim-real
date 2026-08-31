-- Suporte: chamados abertos pelo cliente dentro do app.
--
-- Rodar no SQL Editor do Supabase ANTES de publicar a tela de suporte —
-- sem a tabela, a rota api/support-ticket.ts devolve erro e o cliente
-- fica sem canal.
--
-- Desenho combinado com o Eduardo em 2026-08-27: grava no banco (histórico
-- e status) e avisa por e-mail. Só e-mail perderia chamado na caixa de
-- entrada e não guardaria o contexto técnico.

create table if not exists public.support_tickets (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid references public.households(id) on delete set null,
  clerk_user_id  text not null,
  nome           text,
  email          text,
  mensagem       text not null,
  screenshot_url text,
  -- Contexto que o app anexa sozinho: tela, versão do build, navegador,
  -- plataforma. Evita as três mensagens de ida e volta para descobrir onde
  -- o erro aconteceu.
  contexto       jsonb default '{}'::jsonb,
  status         text not null default 'aberto'
                 check (status in ('aberto', 'respondido', 'resolvido')),
  resposta       text,
  respondido_em  timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists support_tickets_status_idx
  on public.support_tickets (status, created_at desc);
create index if not exists support_tickets_household_idx
  on public.support_tickets (household_id, created_at desc);

-- RLS fechado. Quem escreve e lê é a rota, com a service key — que ignora
-- RLS. Nenhum acesso direto pela chave anon, nem de leitura: um chamado
-- pode conter print com dados financeiros de outra pessoa.
alter table public.support_tickets enable row level security;

revoke all on public.support_tickets from anon, authenticated;

-- ── Storage para os prints ────────────────────────────────────────────────
-- Bucket privado: a URL assinada é gerada pela rota quando o Eduardo abre o
-- chamado. Print de tela financeira não pode ficar em bucket público.
insert into storage.buckets (id, name, public)
values ('support', 'support', false)
on conflict (id) do nothing;

-- Upload e leitura só pela service key (a rota). Sem policy para anon.
