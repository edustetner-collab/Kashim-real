-- ============================================================================
-- RASTREIO DE ÚLTIMA ATIVIDADE — Kashim
-- Rodar no Supabase: Dashboard -> SQL Editor. Arquivo inteiro de uma vez.
--
-- Por quê: para o push "acordar quem sumiu" (3 dias / dormentes), o servidor
-- precisa saber QUANDO cada cliente mexeu no app pela última vez. Isso não
-- existe hoje — só `first_access_at` (a PRIMEIRA vez). Começar a gravar agora
-- faz o histórico acumular enquanto o push ainda está sendo montado, então no
-- lançamento já saberemos quem está inativo e há quanto tempo.
--
-- Quem escreve: só o servidor (api/heartbeat.ts, service key). O cliente não
-- tem UPDATE em households (revogado na blindagem) — por isso vai pelo backend.
-- ============================================================================

alter table public.households
  add column if not exists last_active_at timestamptz;

-- Índice para a futura query do cron ("quem tem last_active_at < agora - 3 dias").
create index if not exists idx_households_last_active
  on public.households(last_active_at);
