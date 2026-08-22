-- ============================================================
-- Open Finance v9 — vários cartões por banco, ligados por padrão
-- Rodar no SQL Editor do Supabase DEPOIS de migrations-v8.sql
-- ============================================================

-- 1. A conta corrente também vira opcional -----------------------------------
-- Quem conectou o banco só pelo cartão pode não querer a conta. Padrão TRUE:
-- desligar é a exceção.
ALTER TABLE bank_connections
  ADD COLUMN IF NOT EXISTS account_import_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Vários cartões por conexão ----------------------------------------------
-- Uma conta pode ter mais de um cartão, e cada um precisa do próprio liga/
-- desliga. `card_last4` (singular) não comportava isso.
--
-- Formato de cada item:
--   { "last4": "2387", "enabled": true, "protocolId": null, "protocolAt": null }
--
-- `protocolId`/`protocolAt` moram AQUI, e não em colunas soltas, porque cada
-- cartão tem a própria janela de reaproveitamento de 6h. Com uma coluna só,
-- o segundo cartão apagaria o protocolo do primeiro.
ALTER TABLE bank_connections
  ADD COLUMN IF NOT EXISTS cards JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 3. Migra o cartão único que já existia -------------------------------------
UPDATE bank_connections
SET cards = jsonb_build_array(
      jsonb_build_object(
        'last4', card_last4,
        'enabled', COALESCE(card_import_enabled, TRUE),
        'protocolId', card_protocol_id,
        'protocolAt', card_protocol_at
      )
    )
WHERE card_last4 IS NOT NULL
  AND account_type <> 'credit_card'
  AND cards = '[]'::jsonb;

-- 4. Fatura passa a vir ligada por padrão ------------------------------------
-- Decisão do Eduardo (2026-08-11): o raro é quem NÃO quer a fatura. Ligado por
-- padrão, com desligar fácil, atende a maioria sem esconder a escolha.
ALTER TABLE bank_connections
  ALTER COLUMN card_import_enabled SET DEFAULT TRUE;

-- ============================================================
-- VERIFICAÇÃO
-- ============================================================
-- SELECT bank_name, account_import_enabled, cards FROM bank_connections;
