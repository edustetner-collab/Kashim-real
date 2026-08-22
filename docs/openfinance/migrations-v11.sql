-- ============================================================
-- Open Finance v11 — fatura do cartão, mês a mês
-- Rodar no SQL Editor do Supabase DEPOIS de migrations-v10.sql
-- ============================================================

-- Total da fatura por mês, já com as parcelas futuras projetadas.
--
-- Formato: { "2026-08": 25867.57, "2026-09": 8120.00, "2026-10": 8120.00 }
-- A chave é AAAA-MM do VENCIMENTO da fatura, não da compra.
--
-- Por que no servidor e não calculado na tela: o extrato só existe durante a
-- sincronização. Depois dela, ninguém mais tem as 117 transações do cartão em
-- mãos — só o resultado agregado. Guardar aqui deixa o Plano preencher a linha
-- "Faturas de Cartão" sem precisar reabrir o Extrato.
--
-- O mês corrente vem do próprio extrato (fatura fechada ou em aberto). Os meses
-- seguintes vêm da projeção das parcelas: uma compra 1/10 de R$ 100 soma R$ 100
-- em cada uma das 9 faturas seguintes. É o que preenche a visão de 12 meses.
ALTER TABLE bank_connections
  ADD COLUMN IF NOT EXISTS bill_totals JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ============================================================
-- VERIFICAÇÃO
-- ============================================================
-- SELECT bank_name, card_last4, bill_totals FROM bank_connections;
