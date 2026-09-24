-- "Está tudo certo" tem de valer em todo aparelho.
--
-- O resumo "o Kashim lançou X por você" guardava o conferido no localStorage:
-- o Eduardo conferia no celular e o MESMO aviso reaparecia ao abrir a web
-- (2026-09-23). Notificação terminada não volta — e isso só se garante no
-- servidor, na própria transação.

alter table public.bank_transactions
  add column if not exists resumo_visto boolean not null default false;
