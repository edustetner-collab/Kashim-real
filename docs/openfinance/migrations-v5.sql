-- ============================================================
-- Open Finance v5 — status real do consentimento
-- Rodar no SQL Editor do Supabase DEPOIS de migrations-v4.sql
-- ============================================================

-- 1. Campos para rastrear o estado exato que a Technospeed devolve
--    openfinance_id     → ID interno da Technospeed para o consentimento (ex: "abc-123")
--    openfinance_status → status bruto (ex: "PENDENTE_ATIVACAO", "ATIVO")
--
-- Por que: o app gravava consent_status = 'active' imediatamente ao criar a
-- conta, ANTES do usuário autorizar no banco. Esses campos permitem guardar o
-- estado real e mostrar ao cliente em que etapa ele está.

ALTER TABLE bank_connections
  ADD COLUMN IF NOT EXISTS openfinance_id     TEXT,
  ADD COLUMN IF NOT EXISTS openfinance_status TEXT;

-- 2. Registros existentes
-- Deixamos como estão (consent_status = 'active') porque não sabemos o estado
-- real sem consultar a Technospeed. Quando o webhook confirmar ou o cron rodar,
-- o status será atualizado.

-- ============================================================
-- VERIFICAÇÃO
-- ============================================================
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'bank_connections'
--   AND column_name IN ('openfinance_id', 'openfinance_status');
