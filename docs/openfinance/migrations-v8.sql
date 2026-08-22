-- ============================================================
-- Open Finance v8 — importação do cartão é opcional e reversível
-- Rodar no SQL Editor do Supabase DEPOIS de migrations-v7.sql
-- ============================================================

-- O consentimento do Open Finance cobre conta E cartão de uma vez — não existe
-- tela no banco para autorizar só um. Ou seja: a escolha de importar ou não a
-- fatura é NOSSA, e precisa existir dentro do Kashim.
--
-- Por que começa DESLIGADO: um cliente que já lançava a fatura à mão veria os
-- gastos do cartão entrarem duplicados, um a um, sem ter pedido nada. Ligar é
-- uma decisão dele; desligar tem que ser igualmente fácil.

ALTER TABLE bank_connections
  ADD COLUMN IF NOT EXISTS card_import_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Últimos 4 dígitos do cartão descoberto na conta. `card_last4` já existia para
-- o modelo antigo (uma conexão por cartão); aqui ele passa a guardar o cartão
-- QUE VEIO JUNTO da conta, descoberto pela API, não digitado pelo cliente.
-- Nenhuma migração de dado é necessária: o formato é o mesmo.

-- Protocolo do extrato de CARTÃO, separado do da conta.
-- Conta e fatura são dois protocolos distintos para o mesmo accountHash; com
-- uma coluna só, o segundo sobrescreveria o primeiro e a janela de
-- reaproveitamento de 6h se perderia — gastando o limite de 4 por dia à toa.
ALTER TABLE bank_connections
  ADD COLUMN IF NOT EXISTS card_protocol_id TEXT,
  ADD COLUMN IF NOT EXISTS card_protocol_at TIMESTAMPTZ;

-- ============================================================
-- VERIFICAÇÃO
-- ============================================================
-- SELECT column_name, column_default FROM information_schema.columns
-- WHERE table_name = 'bank_connections' AND column_name = 'card_import_enabled';
