-- "Não quero mais e-mail de gasto novo."
--
-- O cron avisa por push E por e-mail a cada rodada com transações novas. Com
-- vários bancos conectados, a caixa de entrada enche (Eduardo, 2026-09-23).
-- A preferência mora no banco porque quem envia é o servidor, que não vê o
-- aparelho. Padrão: recebe (true), como era antes.

alter table public.user_preferences
  add column if not exists email_transacoes boolean not null default true;
