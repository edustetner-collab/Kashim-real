-- Migration: tabela de histórico do Stets
-- Rodar no Supabase SQL Editor

create table if not exists coach_conversations (
  id            uuid        primary key default gen_random_uuid(),
  household_id  uuid        not null references households(id) on delete cascade,
  clerk_user_id text        not null,
  messages      jsonb       not null default '[]',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Um registro por usuário por household (upsert sem duplicatas)
create unique index if not exists coach_conversations_unique
  on coach_conversations(household_id, clerk_user_id);

create index if not exists coach_conversations_updated_idx
  on coach_conversations(updated_at);

-- RLS: service_role bypassa; não há acesso direto pelo frontend
alter table coach_conversations enable row level security;

-- Cleanup automático: conversas sem atividade há mais de 90 dias
-- (opcional — rodar manualmente ou via cron)
-- delete from coach_conversations where updated_at < now() - interval '90 days';
