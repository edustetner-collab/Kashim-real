-- ============================================================
-- Open Finance v7 — lançamento automático por memória
-- Rodar no SQL Editor do Supabase DEPOIS de migrations-v6.sql
-- ============================================================

-- Quando a memória do estabelecimento já sabe ONDE o gasto entra, guardamos o
-- item aqui. Sem isto o app sabia a categoria mas não o item do plano, e ainda
-- precisava perguntar — o que anulava o ganho da memória.
ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS suggested_item_id TEXT;

-- `suggestion_confidence` passa a aceitar 'memory': é o valor que marca
-- "isto veio de uma escolha anterior do cliente, não de heurística nossa".
-- Só transação com 'memory' é lançada sozinha; heurística continua perguntando.
ALTER TABLE bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_suggestion_confidence_check;

-- ============================================================
-- VERIFICAÇÃO
-- ============================================================
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'bank_transactions' AND column_name = 'suggested_item_id';
