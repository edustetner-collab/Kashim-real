-- ============================================================================
-- COLUNAS DE ASSINATURA em households — Rodar no Supabase SQL Editor. Uma vez.
--
-- DESCOBERTA 2026-07-16: o webhook do Pagar.me (api/pagarme-webhook.ts) grava
-- subscription_status / subscription_started_at / subscription_expires_at ao
-- aprovar um pagamento, mas subscription_expires_at NÃO EXISTIA na tabela →
-- o UPDATE inteiro falhava e o cliente pagante continuava como trial/expirado.
--
-- IF NOT EXISTS torna seguro rodar mesmo que alguma coluna já exista.
-- ============================================================================

alter table public.households
  add column if not exists subscription_status text,
  add column if not exists subscription_started_at timestamptz,
  add column if not exists subscription_expires_at timestamptz;
