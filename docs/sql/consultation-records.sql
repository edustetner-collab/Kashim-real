-- ============================================================================
-- TABELA consultation_records — registros imutáveis da consultoria (raio-X)
-- Rodar no Supabase: Dashboard -> SQL Editor. Uma vez só.
--
-- Cada linha é a fotografia (snapshot JSON) do planejamento do cliente no
-- momento da reunião, com hash SHA-256 do conteúdo e carimbo de data/hora do
-- servidor. Serve como registro de prestação de serviço:
--  - RLS ligado SEM policies = cliente não lê/escreve; só a service key.
--  - A API só tem INSERT e SELECT — não existe rota de UPDATE/DELETE.
--  - O PDF é regenerado a qualquer momento a partir do snapshot.
-- ============================================================================

create table if not exists public.consultation_records (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by text not null,           -- clerk id de quem registrou (coach/assistente)
  client_name text,
  content_hash text not null,         -- sha256 do snapshot (prova de integridade)
  snapshot jsonb not null,            -- dados completos do raio-X naquela data
  email_sent_to text,                 -- e-mail do cliente que recebeu a cópia (prova)
  created_at timestamptz not null default now()
);

alter table public.consultation_records enable row level security;

create index if not exists idx_consult_records_hh
  on public.consultation_records(household_id);
