-- Dispositivos inscritos em push (OneSignal).
--
-- POR QUE UMA TABELA, se as preferências de notificação vivem no localStorage:
-- notificação LOCAL é agendada no próprio aparelho, então o liga/desliga mora
-- nele. Push é o contrário — quem dispara é o servidor, e ele precisa saber
-- para qual aparelho mandar. Daí o id do OneSignal ter de estar aqui.
--
-- Uma pessoa pode ter vários aparelhos (celular, tablet, o do cônjuge), por
-- isso a chave é (clerk_user_id, onesignal_id) e não só o usuário.

create table if not exists push_devices (
  id             uuid primary key default gen_random_uuid(),
  clerk_user_id  text not null,
  household_id   uuid references households(id) on delete cascade,
  -- Subscription ID do OneSignal. É o endereço do aparelho.
  onesignal_id   text not null,
  platform       text,               -- ios | android | web
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (clerk_user_id, onesignal_id)
);

create index if not exists push_devices_household_idx on push_devices (household_id);
create index if not exists push_devices_user_idx      on push_devices (clerk_user_id);

-- RLS ligado e SEM policy: só a service key (as rotas em api/) enxerga.
--
-- É de propósito. Em 2026-08 `admin_users` ficou com RLS aberto e vazava
-- leitura sem login; aqui a tabela guarda o endereço de push de cada cliente,
-- que é exatamente o tipo de dado que não pode escapar. O cliente nunca precisa
-- ler esta tabela pelo JWT — quem escreve é `api/push-register.ts` e quem lê é
-- `api/of-cron.ts`, ambos com service key.
alter table push_devices enable row level security;

-- Confere depois de rodar:
--   select clerk_user_id, platform, updated_at from push_devices order by updated_at desc;
