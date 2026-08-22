-- ============================================================================
-- RATE LIMITING — Kashim
-- Rodar no Supabase: Dashboard -> SQL Editor. Rodar o arquivo inteiro de uma vez.
-- Fecha a lacuna da auditoria 2026-08-20: nenhuma rota tinha limite de tentativas.
--
-- Como funciona: uma função no Postgres conta requisições por chave (ex.:
-- "set-password:<ip>") dentro de uma janela de tempo, de forma ATÔMICA (sem
-- corrida entre requisições simultâneas). As rotas /api/* chamam essa função
-- com a service key. Enquanto este SQL não roda, as rotas seguem funcionando
-- normalmente (o limiter "falha aberto" — nunca bloqueia cliente legítimo).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- BLOCO 1: tabela de contadores
-- ----------------------------------------------------------------------------
create table if not exists public.rate_limits (
  key          text primary key,
  count        int not null default 0,
  window_start timestamptz not null default now()
);


-- ----------------------------------------------------------------------------
-- BLOCO 2: função atômica de verificação (janela fixa)
-- ----------------------------------------------------------------------------
-- Retorna TRUE = pode passar, FALSE = estourou o limite.
-- Um único UPDATE...ON CONFLICT garante que dois cliques ao mesmo tempo não
-- furam a contagem. Se a janela expirou, zera e recomeça.
create or replace function public.check_rate_limit(
  p_key text,
  p_limit int,
  p_window_seconds int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.rate_limits as rl (key, count, window_start)
    values (p_key, 1, now())
  on conflict (key) do update
    set count = case
          when rl.window_start < now() - make_interval(secs => p_window_seconds)
            then 1
            else rl.count + 1
          end,
        window_start = case
          when rl.window_start < now() - make_interval(secs => p_window_seconds)
            then now()
            else rl.window_start
          end
  returning rl.count into v_count;

  return v_count <= p_limit;
end;
$$;


-- ----------------------------------------------------------------------------
-- BLOCO 3: blindagem (lição do admin_users) — ninguém acessa isto pelo cliente
-- ----------------------------------------------------------------------------
alter table public.rate_limits enable row level security;
alter table public.rate_limits force row level security;
revoke all on public.rate_limits from anon, authenticated;
revoke all on function public.check_rate_limit(text, int, int) from anon, authenticated;
-- A service key (rotas /api/*) tem BYPASSRLS e continua chamando a função.


-- ----------------------------------------------------------------------------
-- BLOCO 4 (opcional): faxina de chaves velhas. Rodar de vez em quando, ou
-- agendar. A tabela é pequena, mas isto evita crescimento infinito.
-- ----------------------------------------------------------------------------
-- delete from public.rate_limits where window_start < now() - interval '1 day';
