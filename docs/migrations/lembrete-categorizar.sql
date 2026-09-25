-- Quando a casa recebeu o último lembrete de "tem gasto para categorizar".
--
-- Por que existe: o lembrete diário dependia do RELÓGIO ("roda só na hora 12
-- UTC"), o que só funcionava enquanto o cron rodava uma vez por hora. Em
-- 2026-09-24 o cron passou a rodar de 5 em 5 minutos e a mesma hora virou 12
-- rodadas: o Eduardo recebeu 3 avisos do MESMO gasto em 8 minutos.
--
-- Depender de estado, e não de cadência, torna o lembrete imune à próxima
-- mudança de agenda do cron.

alter table households
  add column if not exists lembrete_em timestamptz;

comment on column households.lembrete_em is
  'Último lembrete de fila parada enviado. O cron não reenvia dentro de 20h.';
