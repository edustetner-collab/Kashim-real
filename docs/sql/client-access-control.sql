-- ============================================================
-- Acesso do cliente: conta a partir do PRIMEIRO ACESSO dele
-- Rodar no SQL Editor do Supabase
-- ============================================================

-- PROBLEMA
-- O grace de 5 meses era contado de `coaching_ends_at` (gravado uma vez na
-- criação do perfil e nunca atualizado) ou de `created_at` do household. Os
-- dois marcam quando o COACH criou o perfil, não quando o CLIENTE começou a
-- usar. Perfil criado em janeiro e acessado só em junho já nascia com metade
-- do prazo consumido.

-- 1. Quando o cliente entrou pela primeira vez -------------------------------
ALTER TABLE households
  ADD COLUMN IF NOT EXISTS first_access_at TIMESTAMPTZ;

-- Backfill: o melhor registro que já existe é `joined_at` do primeiro membro
-- (gravado quando a conta Clerk se liga ao household, ou seja, no 1º login).
-- Sem membro nenhum, cai no created_at — mesmo comportamento de antes.
UPDATE households h
SET first_access_at = COALESCE(
      (SELECT MIN(m.joined_at) FROM household_members m WHERE m.household_id = h.id),
      h.created_at
    )
WHERE h.first_access_at IS NULL;

-- 2. Reativação manual pelo coach --------------------------------------------
-- Depois dos 5 meses, o coach pode devolver acesso por um período, sem que o
-- cliente precise assinar. Data no futuro = acesso liberado, qualquer que seja
-- o resto do cálculo.
ALTER TABLE households
  ADD COLUMN IF NOT EXISTS access_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_households_access_until
  ON households (access_until) WHERE access_until IS NOT NULL;

-- ============================================================
-- VERIFICAÇÃO
-- ============================================================
-- SELECT id, created_at, first_access_at, access_until FROM households LIMIT 10;
