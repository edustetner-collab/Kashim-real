-- ============================================================
-- Open Finance v6 — nome do estabelecimento
-- Rodar no SQL Editor do Supabase DEPOIS de migrations-v5.sql
-- ============================================================

-- O extrato real traz a contraparte em `participantReceiver.name`
-- ("EDP SAO PAULO DISTRIBUICAO DE ENERGIA S.A."), preenchida em ~75% das
-- transações. Sem esta coluna, a tela mostrava só a descrição do banco
-- ("PIX QR CODE DINAMICO - DES: EDP SP"), que o cliente não reconhece — e sem
-- reconhecer, ele não consegue categorizar.
--
-- Atenção: o campo `name` do payload NÃO serve para isto. No extrato real ele
-- é o titular da conta em 110 de 110 transações.

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS merchant TEXT;

-- Índice para a memória por estabelecimento consultar rápido
CREATE INDEX IF NOT EXISTS idx_bank_tx_merchant
  ON bank_transactions (household_id, merchant)
  WHERE merchant IS NOT NULL;

-- ============================================================
-- VERIFICAÇÃO
-- ============================================================
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'bank_transactions' AND column_name = 'merchant';
