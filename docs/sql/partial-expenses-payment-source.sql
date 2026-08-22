-- ============================================================
-- Forma de pagamento no lançamento
-- Rodar no SQL Editor do Supabase
-- ============================================================

-- Um item do plano ("Mercado", teto R$ 1.500) pode receber gasto pelos dois
-- caminhos: débito/Pix, que já saiu da conta, e crédito, que só sai na fatura.
-- O teto é do GASTO, não da forma de pagamento — mas o cliente precisa
-- enxergar a diferença para saber quanto ainda vai sair do bolso.
--
-- Sem esta coluna, os dois viram o mesmo número e a pergunta "quanto já saiu?"
-- fica sem resposta.
--
--   'debit'  → débito, Pix, dinheiro: já saiu
--   'credit' → cartão de crédito: entra na fatura
--   NULL     → lançamento antigo, anterior a esta coluna

ALTER TABLE partial_expenses
  ADD COLUMN IF NOT EXISTS payment_source TEXT;

ALTER TABLE partial_expenses
  DROP CONSTRAINT IF EXISTS partial_expenses_payment_source_check;

ALTER TABLE partial_expenses
  ADD CONSTRAINT partial_expenses_payment_source_check
  CHECK (payment_source IS NULL OR payment_source IN ('debit', 'credit'));

-- ============================================================
-- VERIFICAÇÃO
-- ============================================================
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'partial_expenses' AND column_name = 'payment_source';

-- ============================================================
-- Cartao POR LANCAMENTO (2026-08-14)
-- ============================================================
-- Antes o cartao vivia so em finance_items.linked_card_id — na LINHA. Com o
-- Open Finance a mesma linha ("Assinaturas") recebe gasto de cartoes
-- diferentes, e todos apareciam com o cartao da linha. Ex.: gasto do Bradesco
-- exibido como Latam.
ALTER TABLE partial_expenses
  ADD COLUMN IF NOT EXISTS card_last4 TEXT;
