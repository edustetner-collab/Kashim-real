-- Cliente de consultoria com Open Finance liberado no nascimento.
--
-- Decisão do Eduardo em 2026-09-28: todo cliente NOVO criado pelo coach (ou
-- pela Giane) já entra no fluxo de Open Finance. Quem já existia NÃO muda —
-- continua sendo liberado um a um, pelo e-mail, quando ele conversar com cada
-- pessoa. Foi a opção "B" entre abrir para a base inteira de uma vez e abrir
-- só para os novos.
--
-- Por que uma coluna, e não uma data de corte no código: com a coluna o
-- Eduardo consegue desligar de UM cliente específico se precisar. Uma data de
-- corte seria invisível e não teria exceção.
--
-- `default false` é de propósito: a coluna nasce desligada para TODA a base
-- existente. Mostrar Open Finance a quem não deveria é a falha que não se
-- desfaz — na dúvida, fechado.

alter table households
  add column if not exists open_finance boolean not null default false;

-- Os que estão no filtro "Novos" do painel entram junto.
-- "Novos" é exatamente `status = 'draft'`: cliente que o coach criou e que
-- ainda não teve a primeira reunião. Como o Eduardo apresenta o Open Finance
-- NA reunião, esses já nascem no fluxo certo.
--
-- Cliente já ativado (`status = 'active'`) NÃO entra aqui de propósito: é a
-- base que ele vai liberando um a um, pela lista de e-mails, conforme as
-- reuniões acontecem.
update households set open_finance = true where status = 'draft';

comment on column households.open_finance is
  'Cliente criado já com Open Finance (create-client a partir de 2026-09-28). A lista OF_BETA_EMAILS continua valendo como exceção manual.';
