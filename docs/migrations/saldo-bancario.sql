-- Saldo da conta corrente, como o banco informou na última leitura.
--
-- O extrato do Open Finance já traz `balance.inicial` e `balance.final` e o
-- Kashim ignorava os dois. Guardar o final é o que permite mostrar "No banco
-- hoje: R$ X · há 3 h" ao lado da sobra do plano, e explicar a diferença entre
-- os dois números (Eduardo, 2026-09-23).
--
-- `saldo_em` é quando NÓS lemos, não a data que o banco carimbou: é isso que o
-- cliente precisa saber para julgar se o número está velho.

alter table public.bank_connections
  add column if not exists saldo_atual numeric,
  add column if not exists saldo_em timestamptz;
