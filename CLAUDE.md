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

- Registro `approved` em `coach_access` → **acesso ilimitado**. Quem encerra é o
  coach, revogando no painel (`status='revoked'`) — **nunca uma data**.
- Já foi cliente do coach (revogado) → 5 meses de grace period.
- Cadastro espontâneo (pela landing) → 30 dias.
- **`coaching_ends_at` não serve para bloquear**: é gravado uma única vez no
  `create-client.ts` (`created_at + 5 meses`) e nunca atualizado, então está no
  passado para todo cliente com mais de 5 meses de casa.
- **Na dúvida, libera.** Falha de rede ou erro de query nunca pode virar
  bloqueio — isso mostrava o gate de pagamento para cliente pagante.

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
