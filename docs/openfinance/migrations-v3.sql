-- ============================================================
-- Open Finance v3 — controle de protocolo (rate limit da Technospeed)
-- Rodar no SQL Editor do Supabase DEPOIS de migrations-v2.sql
--
-- Motivo: POST /statement/openfinance aceita apenas
-- 1 requisição de SUCESSO a cada 6 HORAS por conta.
-- Precisamos lembrar o último protocolo gerado para reaproveitá-lo
-- em vez de pedir um novo e tomar bloqueio.
-- ============================================================

ALTER TABLE bank_connections
  ADD COLUMN IF NOT EXISTS last_protocol_id TEXT,          -- uniqueid devolvido pela Technospeed
  ADD COLUMN IF NOT EXISTS last_protocol_at TIMESTAMPTZ;   -- quando foi gerado (janela de 6h)

-- Verificação
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'bank_connections'
--   AND column_name IN ('last_protocol_id','last_protocol_at');
