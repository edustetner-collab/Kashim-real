-- ============================================================
-- Open Finance — tabelas Supabase
-- Rodar no SQL Editor do Supabase (painel > SQL Editor)
-- Ordem: bank_connections → bank_transactions → merchant_memories
-- ============================================================

-- 1. Contas bancárias conectadas (uma por banco/conta do cliente) ------------

CREATE TABLE IF NOT EXISTS bank_connections (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id      UUID        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  account_hash      TEXT        NOT NULL,              -- accountHash da Technospeed (chave de idempotência)
  bank_code         TEXT,                              -- bankCode (ex.: "341" = Itaú, "208" = BTG)
  bank_name         TEXT,                              -- rótulo legível (derivado do bankCode ou preenchido pelo usuário)
  account_type      TEXT        NOT NULL DEFAULT 'checking'
                               CHECK (account_type IN ('credit_card', 'checking')),
  display_name      TEXT,                              -- nome amigável que o usuário dá à conta
  consent_status    TEXT        NOT NULL DEFAULT 'active'
                               CHECK (consent_status IN ('active', 'expired', 'revoked')),
  last_synced_at    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (household_id, account_hash)
);

ALTER TABLE bank_connections ENABLE ROW LEVEL SECURITY;

-- Membro da casa gerencia suas próprias conexões
DROP POLICY IF EXISTS "members_manage_bank_connections" ON bank_connections;
CREATE POLICY "members_manage_bank_connections"
  ON bank_connections FOR ALL
  USING (
    household_id IN (
      SELECT household_id FROM household_members
      WHERE clerk_user_id = (auth.jwt() ->> 'sub')
    )
  );

-- 2. Transações brutas importadas do Open Finance ---------------------------

CREATE TABLE IF NOT EXISTS bank_transactions (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id          UUID          NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  connection_id         UUID          REFERENCES bank_connections(id) ON DELETE SET NULL,

  -- Identificação (idempotência: household + transaction_id nunca duplica)
  transaction_id        TEXT          NOT NULL,
  fitid                 TEXT,

  -- Tipo de conta e direção semântica pré-calculada pelo parser
  account_type          TEXT          NOT NULL CHECK (account_type IN ('credit_card', 'checking')),
  transaction_type      TEXT          NOT NULL CHECK (transaction_type IN ('expense', 'income', 'savings', 'ignore')),

  -- Campos do provider
  of_code               TEXT,                          -- ex.: VEHICLEMAINTENANCE, PIX
  of_category           TEXT,                          -- label legível do provider
  amount                NUMERIC(12,2) NOT NULL,
  transaction_date      DATE          NOT NULL,
  description           TEXT,
  payment_method        TEXT,                          -- PIX / TED / BOLETO / DOC (conta corrente)
  card_last4            TEXT,                          -- últimos 4 dígitos (cartão)
  bill_due_date         DATE,                          -- dueDate da fatura (cartão) → mês do Kashim
  bill_total            NUMERIC(12,2),

  -- Sugestão de categoria (calculada pelo parser, gravada pra histórico)
  suggested_category    TEXT,
  suggestion_confidence TEXT,

  -- Parcelas
  installment_current   SMALLINT,
  installment_total     SMALLINT,

  -- Estado de categorização
  status                TEXT          NOT NULL DEFAULT 'pending'
                                      CHECK (status IN ('pending', 'categorized', 'ignored')),
  kashim_item_id        TEXT,                          -- UUID do finance_items
  kashim_category       TEXT,                          -- CategoryType string
  kashim_partial_id     TEXT,                          -- UUID do partial_expenses criado
  categorized_at        TIMESTAMPTZ,

  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),

  UNIQUE (household_id, transaction_id)
);

ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_manage_bank_transactions" ON bank_transactions;
CREATE POLICY "members_manage_bank_transactions"
  ON bank_transactions FOR ALL
  USING (
    household_id IN (
      SELECT household_id FROM household_members
      WHERE clerk_user_id = (auth.jwt() ->> 'sub')
    )
  );

-- Índices para as queries mais comuns
CREATE INDEX IF NOT EXISTS idx_bt_household_status
  ON bank_transactions (household_id, status);

CREATE INDEX IF NOT EXISTS idx_bt_household_date
  ON bank_transactions (household_id, transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_bt_household_type_status
  ON bank_transactions (household_id, transaction_type, status);

-- 3. Memória de categorização por merchant (aprendizado) --------------------

CREATE TABLE IF NOT EXISTS merchant_memories (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id     UUID        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  merchant_key     TEXT        NOT NULL,              -- chave normalizada do estabelecimento
  kashim_category  TEXT        NOT NULL,              -- CategoryType string escolhido pelo usuário
  kashim_item_id   TEXT,                              -- item específico (opcional, se repetiu)
  usage_count      INTEGER     NOT NULL DEFAULT 1,   -- quantas vezes o usuário confirmou
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (household_id, merchant_key)
);

ALTER TABLE merchant_memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_manage_merchant_memories" ON merchant_memories;
CREATE POLICY "members_manage_merchant_memories"
  ON merchant_memories FOR ALL
  USING (
    household_id IN (
      SELECT household_id FROM household_members
      WHERE clerk_user_id = (auth.jwt() ->> 'sub')
    )
  );

-- ============================================================
-- VERIFICAÇÃO rápida: rode depois e confirme 3 tabelas novas
-- ============================================================
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('bank_connections', 'bank_transactions', 'merchant_memories');
