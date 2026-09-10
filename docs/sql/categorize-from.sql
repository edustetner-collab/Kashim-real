-- A partir de quando esta conexão pede categorização.
--
-- O MÉTODO (Eduardo, 2026-09-10): o cliente da consultoria chega com faturas
-- que já existem. Elas são dívida assumida — entram CHEIAS na linha de fatura e
-- ninguém categoriza o que está dentro delas. A consultoria olha para frente:
-- "essas faturas você já deve; a partir de agora vamos gastar R$ 1.000 de
-- mercado, R$ 500 de gasolina". Só o que vier depois desse marco é categorizado.
--
-- POR QUE NA CONEXÃO E NÃO NO HOUSEHOLD: o marco é o instante em que o sistema
-- passa a enxergar aquele banco. Antes disso, tudo o que existe já está dentro
-- da fatura.
--
-- NULO É DE PROPÓSITO. Conexão que já existe fica sem data e segue a regra
-- antiga (corte pelo primeiro dia do mês do plano). O Eduardo e os testers do
-- Open Finance já conectaram e já categorizaram; mudar o corte deles agora
-- mexeria no que está funcionando. Só conexão NOVA nasce com a data carimbada.

alter table bank_connections
  add column if not exists categorize_from timestamptz;

comment on column bank_connections.categorize_from is
  'Marco do primeiro acesso: transações anteriores já estão dentro da fatura e não são categorizadas. Nulo = conexão anterior à regra, usa o start_month do household.';

-- Confere depois de rodar:
--   select bank_name, created_at, categorize_from from bank_connections order by created_at desc;
