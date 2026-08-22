-- ============================================================================
-- BLINDAGEM: tabela `admin_users` — Kashim
-- Rodar no Supabase: Dashboard -> SQL Editor. Rodar os blocos NA ORDEM.
-- Achado em auditoria 2026-08-20: admin_users estava LEGÍVEL sem login pela
-- chave anon (que vive no bundle do front). Ver contexto no fim do arquivo.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- BLOCO 1 (CRÍTICO): fechar leitura e escrita da chave anon/authenticated
-- ----------------------------------------------------------------------------
-- Por que importa: `admin_users` é a lista de quem tem poder de STAFF. As rotas
-- api/gen-link.ts e api/list-clients.ts concedem acesso de assistente a quem
-- estiver nessa tabela (casando pelo e-mail do Clerk). Portanto:
--   • LEITURA aberta = qualquer um na internet lê o e-mail dos administradores
--     (reconhecimento: saber quem atacar por phishing).
--   • ESCRITA aberta = qualquer um se INSERE na tabela e vira staff (escalada de
--     privilégio). Este é o risco grave; a leitura é o alerta que o revelou.
--
-- O app NUNCA lê nem escreve admin_users pelo cliente — só as rotas /api/*, que
-- usam a service key e IGNORAM estes grants. Logo, revogar não quebra nada.
revoke all on public.admin_users from anon;
revoke all on public.admin_users from authenticated;


-- ----------------------------------------------------------------------------
-- BLOCO 2 (defesa em profundidade): ligar RLS sem nenhuma policy permissiva
-- ----------------------------------------------------------------------------
-- Com RLS habilitado e ZERO policy, a tabela fica invisível para anon e
-- authenticated mesmo que um grant volte por engano no futuro. A service key
-- (usada pelas rotas /api/*) tem BYPASSRLS e continua funcionando normalmente.
alter table public.admin_users enable row level security;
alter table public.admin_users force row level security;


-- ----------------------------------------------------------------------------
-- BLOCO 3 (verificação) — rode e confira que retorna ZERO linhas
-- ----------------------------------------------------------------------------
-- Lista grants residuais de anon/authenticated. Esperado: vazio.
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'admin_users'
  and grantee in ('anon', 'authenticated');


-- ============================================================================
-- CONTEXTO DA AUDITORIA (2026-08-20)
-- Teste feito em produção com a chave anon extraída do bundle público:
--   households, household_members, coach_access, finance_items, debts,
--   consultation_records, short_links  -> RLS OK, leitura devolveu vazio.
--   admin_users -> devolveu 1 linha SEM login. Corrigido por este arquivo.
-- Nenhuma rota /api/* devolveu dado sem token (34/35 rejeitaram; short-redirect
-- é público por desenho). O furo era só de RLS na admin_users.
-- ============================================================================
