-- ─── DICIONÁRIO DE ESTABELECIMENTOS ──────────────────────────────────────────
--
-- "AC ANTONIO FARIA LTDA" não diz nada para o cliente; "Malharia Caçapava" diz.
-- O extrato do banco manda razão social (ou uma descrição crua de maquininha), e
-- o cliente perde tempo procurando CNPJ no Google para lembrar o que comprou
-- (Eduardo, 2026-09-20).
--
-- Esta tabela é o dicionário do Kashim: cada nome descoberto vale para TODOS os
-- clientes, para sempre, e não custa uma segunda consulta a API nenhuma.
--
-- A chave tem duas formas:
--   cnpj:00000000000191   → veio do documento da outra parte (Pix, boleto, TED)
--   desc:posto ipiranga   → veio da descrição normalizada (compra no cartão)
--
-- Acesso: só o servidor (service key). Sem políticas de RLS, o cliente não lê
-- nem escreve direto — o app fala com as rotas em api/, que já autenticam.

CREATE TABLE IF NOT EXISTS merchant_directory (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  chave         TEXT        NOT NULL UNIQUE,
  nome          TEXT        NOT NULL,
  -- 'brasilapi' (consulta de CNPJ), 'cliente' (quem renomeou no app),
  -- 'manual' (você, corrigindo à mão).
  fonte         TEXT        NOT NULL DEFAULT 'brasilapi',
  -- Quantas vezes um cliente confirmou este nome. Serve para você priorizar o
  -- que revisar: nome com muita confirmação é seguro, com uma só pode ser erro.
  confirmacoes  INTEGER     NOT NULL DEFAULT 1,
  -- Guarda o que o banco mandava, para dar para auditar de onde veio o apelido.
  origem_texto  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merchant_directory_chave_idx ON merchant_directory (chave);

ALTER TABLE merchant_directory ENABLE ROW LEVEL SECURITY;
-- Sem POLICY nenhuma: só a service key enxerga. É intencional.
