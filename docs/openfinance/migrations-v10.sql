-- ============================================================
-- Open Finance v10 — modo casal
-- Rodar no SQL Editor do Supabase DEPOIS de migrations-v9.sql
-- ============================================================

-- 1. Documento da contraparte -------------------------------------------------
-- O PROBLEMA: ele manda R$ 2.000 de Pix para ela todo mês. No extrato dele é
-- débito (despesa); no dela é crédito (renda). Como o household é o mesmo, o
-- casal ganha R$ 2.000 de renda que não existe e gasta R$ 2.000 que nunca saiu
-- de casa — e a proporção 55/20/15/10 sai errada para os dois.
--
-- É a mesma doença do SAMEPERSONTRANSFER (R$ 19.960 no extrato do Eduardo), mas
-- o banco não marca como "mesma pessoa" porque são CPFs diferentes.
--
-- A solução está no payload: `participantReceiver.documentNumber` traz o CPF de
-- quem recebeu. Guardando aqui, dá para comparar com os `payer_cpf` do próprio
-- household e ignorar a transferência interna.
--
-- Guardamos SÓ dígitos, sem pontuação — a API devolve "368.062.738-66".
ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS counterparty_doc TEXT;

CREATE INDEX IF NOT EXISTS idx_bank_tx_counterparty
  ON bank_transactions (household_id, counterparty_doc)
  WHERE counterparty_doc IS NOT NULL;

-- 2. Nome do titular da conexão ----------------------------------------------
-- Com duas pessoas no mesmo household, a lista mostrava "Bradesco · Conta
-- Corrente" duas vezes, sem dizer de quem é cada uma. O nome já é digitado no
-- cadastro do pagador — só não estava sendo guardado.
ALTER TABLE bank_connections
  ADD COLUMN IF NOT EXISTS payer_name TEXT;

-- ============================================================
-- VERIFICAÇÃO
-- ============================================================
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'bank_transactions' AND column_name = 'counterparty_doc';
-- SELECT bank_name, payer_name FROM bank_connections;
