-- ─── CONVERSAS DO STETS ──────────────────────────────────────────────────────
--
-- Antes existia UMA conversa por pessoa (`coach_conversations`, chave única por
-- household + usuário). Começar uma nova apagava a anterior, sem aviso
-- (Eduardo, 2026-09-20).
--
-- Esta tabela guarda várias. A antiga continua de pé e é importada na primeira
-- leitura — nada se perde, e nenhum ALTER arriscado é feito na tabela viva.
--
-- Espaço não é problema: são textos curtos e o servidor mantém no máximo 20
-- conversas por pessoa, cada uma com até 100 mensagens. E isto NÃO muda o custo
-- do modelo: o Stets recebe só a conversa aberta, nunca o arquivo inteiro.

CREATE TABLE IF NOT EXISTS coach_chats (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  clerk_user_id   TEXT        NOT NULL,
  -- Primeira pergunta da pessoa, cortada: é o que ela reconhece na lista.
  titulo          TEXT,
  messages        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coach_chats_dono_idx
  ON coach_chats (household_id, clerk_user_id, updated_at DESC);

ALTER TABLE coach_chats ENABLE ROW LEVEL SECURITY;
-- Sem POLICY: só a service key enxerga. O app fala com `api/coach-history`,
-- que confere se a pessoa pertence ao household antes de devolver qualquer coisa.
