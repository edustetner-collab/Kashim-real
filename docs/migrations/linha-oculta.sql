-- Linha do plano OCULTA: fica guardada, mas fora de todas as somas.
--
-- Nasceu de uma necessidade do coach: ao montar o planejamento, a decisão pode
-- ser NÃO pagar um cartão. Hoje a saída é excluir a linha — e aí as faturas mês
-- a mês se perdem. Quando o cliente volta meses depois dizendo "entrou um
-- dinheiro, quero pagar aquele cartão", o coach precisa pedir tudo de novo
-- (Eduardo, 2026-09-23).
--
-- Oculta ≠ excluída: some das contas, continua consultável em cinza.

alter table public.finance_items
  add column if not exists oculto boolean not null default false;
