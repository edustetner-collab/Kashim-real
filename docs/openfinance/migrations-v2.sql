-- ============================================================
-- Open Finance v2 — migrações adicionais
-- Rodar no SQL Editor do Supabase DEPOIS de migrations.sql
-- ============================================================

-- 1. Flag Open Finance no household -------------------------------------
ALTER TABLE households
  ADD COLUMN IF NOT EXISTS has_open_finance BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. CPF do titular em bank_connections --------------------------------
-- Precisamos do CPF para chamar a Technospeed (payercpfcnpj header)
ALTER TABLE bank_connections
  ADD COLUMN IF NOT EXISTS payer_cpf TEXT,                  -- CPF sem formatação (11 dígitos)
  ADD COLUMN IF NOT EXISTS open_finance_link TEXT,          -- URL de autorização devolvida pela Technospeed
  ADD COLUMN IF NOT EXISTS card_last4 TEXT;                 -- últimos 4 dígitos (cartões de crédito)

-- 3. Verificação rápida
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'households' AND column_name = 'has_open_finance';
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'bank_connections' AND column_name IN ('payer_cpf','open_finance_link','card_last4');
