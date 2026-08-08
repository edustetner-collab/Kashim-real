-- ============================================================
-- Open Finance v4 — webhook e ressincronização
-- Rodar no SQL Editor do Supabase DEPOIS de migrations-v3.sql
-- ============================================================

-- 1. Sinalização de ressincronização -----------------------------------------
-- O webhook 'transactions_updated' avisa que o extrato foi reprocessado e há
-- transações novas. Marcamos aqui e o cron reimporta na próxima execução
-- (não dá para sincronizar na hora: 1 protocolo a cada 6h).

ALTER TABLE bank_connections
  ADD COLUMN IF NOT EXISTS needs_resync BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Status 'deleted' em bank_transactions -----------------------------------
-- Quando o banco remove uma transação na origem, marcamos em vez de apagar:
-- preserva a categorização que o cliente já fez, caso a transação retorne.

ALTER TABLE bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_status_check;

ALTER TABLE bank_transactions
  ADD CONSTRAINT bank_transactions_status_check
  CHECK (status IN ('pending', 'categorized', 'ignored', 'deleted'));

-- 3. Histórico de eventos do webhook -----------------------------------------
-- Volume baixo e essencial para auditar divergência de saldo depois.

CREATE TABLE IF NOT EXISTS of_webhook_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event           TEXT        NOT NULL,
  statement_id    TEXT,
  transaction_ids TEXT[],
  message         TEXT,
  payload         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_of_webhook_created
  ON of_webhook_events (created_at DESC);

-- Sem policy de leitura: só o service key (backend) escreve e lê.
ALTER TABLE of_webhook_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- VERIFICAÇÃO
-- ============================================================
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'bank_connections' AND column_name = 'needs_resync';
-- SELECT table_name FROM information_schema.tables WHERE table_name = 'of_webhook_events';
