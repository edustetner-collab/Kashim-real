# Kashim — instruções do projeto

## 🚨 DEPLOY — LEIA ANTES DE PUBLICAR QUALQUER COISA

**Publicar em produção é `npx vercel deploy --prod --yes` nesta pasta.**
**`git push` NÃO publica nada. Nunca publicou.**

Existem dois projetos Vercel com nomes parecidos. Só um serve o site:

| projeto | serve kashim.com.br | o que é |
|---|---|---|
| **`kashim`** — `prj_Xkl4NHn217SXLasjw6dA4Ac2NwBS` / org `team_ewO9GMRlXiymxneeStBM7AjU` | **SIM — é o site real** | vinculado a esta pasta via `.vercel/project.json` |
| `kashim-real` — `prj_BWwFRBLot0dx2IcnpsycIuKrydG2` / org `team_TeJAgXJkUXM4ovEyagI0zs9v` | **NÃO — ignorar** | recebe os pushes do remote git; não serve nada |

### NUNCA mexer no projeto `kashim-real`

Decisão explícita do Eduardo (2026-08-07). O projeto `kashim-real` é entulho:
não serve nenhum domínio e seus builds falham há dias sem consequência. **Não
investigar, não corrigir, não olhar os logs dele, não usar como referência de
nada.** Se uma ferramenta do Vercel devolver `kashim-real`, é o projeto errado —
o certo é `kashim` (`prj_Xkl4…`).

O remote git desta pasta (`edustetner-collab/Kashim-real`) alimenta esse projeto
morto. Commitar segue valendo para histórico, mas **deploy é só pelo CLI**.

### Procedimento obrigatório

```bash
npx vercel deploy --prod --yes
```

Só afirmar que algo está no ar depois de ver na saída:

```
Aliased: https://kashim.com.br
```

Sem essa linha, **não está publicado** — não importa quantos commits foram feitos.

## 🔒 OPEN FINANCE — VISÍVEL SÓ PARA O EDUARDO

**Nenhuma superfície de Open Finance pode aparecer para cliente nenhum.**
Decisão explícita do Eduardo (2026-08-11), repetida três vezes na mesma conversa.

Vale para **tudo**: passo do onboarding, botão de Extrato, card na home, tela de
conectar banco, avisos por e-mail, badge, tooltip. Se uma alteração pode ser
vista por um cliente comum, ela está errada. **Na dúvida, esconde.**

Sequência combinada: só o Eduardo → depois uma lista nominal que ele indicar →
só então abre para todos. Nunca pular etapa.

### Como respeitar

- Quem vê é decidido em [`lib/ofAccess.ts`](lib/ofAccess.ts), **um lugar só**.
  Toda tela nova chama `hasOpenFinanceAccess(user)` — nunca um `if` solto com
  e-mail dentro do componente.
- O servidor repete a checagem em `api/of-connect.ts`. Esconder o botão não
  impede ninguém de chamar a rota.
- Ampliar a lista é por `VITE_OF_BETA_USER_IDS` / `OF_BETA_USER_IDS` (IDs do
  Clerk). Vazias, vale só o e-mail em código.

Em 2026-08-11 o botão **Extrato** estava no menu do desktop e na barra do celular
**sem portão nenhum**, visível para todos os clientes em produção, enquanto o
"Gerenciar bancos" das Configurações estava protegido. Foi assim que escapou:
a regra estava escrita dentro de um componente em vez de num lugar só.

## Se o Eduardo disser "continua do mesmo jeito"

Ao **segundo** "continua igual" depois de uma correção, parar de investigar a
lógica e provar que o código novo está rodando:

- um `console.log` marcador do fix aparece no console (F12)?
- alguma feature recém-adicionada está visível na tela?
- o deploy mostrou `Aliased: https://kashim.com.br`?

**Duas features independentes ausentes = problema de pipeline, não de lógica.**

Em 2026-08-07 quatro hipóteses diferentes foram investigadas e corrigidas ao
longo de horas contra um bundle antigo que não continha nenhuma delas, porque os
`git push` não deployavam. Os sinais estavam lá e foram subestimados: o
`console.log` de diagnóstico não aparecia, e o botão Extrato (de outra sessão)
também estava ausente.

Quando o Eduardo questionar um diagnóstico ("você está vendo o projeto errado",
"não tem como ser há dias"), tratar como informação de alta confiança — ele
conhece a infra — e **verificar**, em vez de reafirmar a hipótese.

## Regra de acesso (quem pode usar o app)

**Revisada em 2026-08-12 pelo Eduardo. A regra antiga — `approved` = acesso
ilimitado, bloqueio só por revogação — não vale mais.**

- O relógio começa no **primeiro acesso do cliente** (`households.first_access_at`,
  carimbado quando ele abre o app pela primeira vez). Criar o perfil **não**
  inicia a contagem: perfil criado em janeiro e acessado em junho conta a partir
  de junho.
- A partir daí são **5 meses**, valendo **mesmo com a consultoria ativa**.
  Vencido o prazo sem o coach postergar, **bloqueia** até regularizar.
- O aviso aparece com **30 dias** de antecedência e vai apertando.
- O coach posterga pelo botão **Reativar** no painel (`households.access_until`),
  que vence qualquer outro cálculo. Clientes fora do prazo caem sozinhos no
  filtro **Antigos**.
- Cadastro espontâneo (pela landing) → 30 dias a partir do `created_at`.
- **`coaching_ends_at` não serve para nada disto**: é gravado uma única vez no
  `create-client.ts` e nunca atualizado. Foi ele que causou o incidente de
  2026-08-07, derrubando clientes ativos. Quem substitui é `first_access_at`.
- **Na dúvida, libera** continua valendo para *falha de infraestrutura*: erro de
  rede ou query sem resposta nunca pode virar bloqueio. O que mudou é que prazo
  vencido, com data confiável, agora bloqueia de propósito.

### Cuidado com `.order()` em queries do Supabase

`.order('coluna_que_nao_existe')` derruba a query **inteira** e devolve
`data: null` — não um resultado parcial. Foi o que fazia `check-coach-access`
reportar "sem coach" para quem tinha consultoria ativa. Preferir queries mínimas
(`select('*').eq(...)`) em checagens de acesso.

## Segurança

- **NUNCA** instalar pacote npm/pip publicado há menos de 7 dias (supply chain).
- `getToken` **sempre** com `template: 'supabase'`.
- Rotas `api/` verificam assinatura HS256 com `SUPABASE_JWT_SECRET`.
- Vercel **não** empacota import local em `api/` — embutir o helper de auth em
  cada rota (é por isso que `verifyAuthToken` está duplicado).
