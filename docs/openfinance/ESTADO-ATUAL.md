# Open Finance — estado atual

> Última atualização: **2026-08-10**
> Leia isto primeiro ao retomar. Para o **comportamento** desejado do produto,
> ver [design-produto.md](design-produto.md). Este documento é sobre **onde
> paramos**.

---

## Resumo em uma frase

Todo o código está escrito, deployado e verificado — mas **nenhuma chamada real
à API da Technospeed jamais funcionou**, porque o acesso está bloqueado por
firewall no lado deles. Eles confirmaram que liberam **por IP**; o proxy de IP
fixo já está no ar (`137.184.195.94`) e o IP foi enviado no formulário deles em
**2026-08-10**. Aguardando a liberação para o primeiro teste real.

---

## O bloqueio

Toda requisição a `api.pagamentobancario.com.br` e
`staging.pagamentobancario.com.br` devolve **403 com HTML do load balancer**
(`server: awselb/2.0`).

Não é problema nosso. Já foi descartado, com teste direto:

| Hipótese | Como foi descartada |
|---|---|
| Credencial inválida | 403 acontece **sem enviar credencial nenhuma** |
| User-Agent ausente/genérico | 7 formatos testados, incluindo `insomnia/2023.5.8` da collection oficial |
| Payload suspeito (WAF por conteúdo) | 403 em **GET na raiz do domínio**, sem corpo |
| Ambiente errado | Idêntico em produção e staging |
| Rate limit | Esse devolve **429**, não 403; e o bloqueio é permanente |
| Rede/DNS local | `docs.pagamentobancario.com.br` responde 200 do mesmo IP |

**Diagnóstico:** bloqueio de borda por origem (IP não liberado, ou credenciais
ainda não ativadas). Só a Technospeed resolve.

### Reproduzir o diagnóstico

Rodar **de dentro do Droplet** (`ssh root@137.184.195.94`) — é o único IP que a
Technospeed vai liberar. Rodar do PC ou do Vercel dá 403 para sempre.

```bash
curl -i https://api.pagamentobancario.com.br/
# 403 + HTML + "server: awselb/2.0"  → segue bloqueado
# qualquer outra coisa               → destravou, testar o fluxo
```

---

## Duas perguntas que mudam decisões de produto

Ambas estão nos chamados. **Não construir mais nada até serem respondidas.**

### 1. Exigem IP fixo? — **RESPONDIDA: sim**

Confirmado em 2026-08-10: eles liberam por IP, via formulário. Como o Vercel não
tem IP de saída estável, foi montado um proxy dedicado — ver
[a seção do proxy](#proxy-de-ip-fixo) abaixo.

### 2. O limite de 1 protocolo a cada 6h é por conta ou por Software House?

Se for **por Software House**, o modelo não fecha para finanças pessoais: seriam
4 sincronizações por dia divididas entre *todos* os clientes. Nesse caso vale
reavaliar ir direto na Pluggy (que a Technospeed usa por baixo), Belvo ou Klavi.

---

## Proxy de IP fixo

A Technospeed libera acesso **por IP**. Vercel serverless muda de IP a cada
execução, então nenhuma rota `api/of-*.ts` fala com a Technospeed diretamente:
todas passam por um proxy próprio com IP fixo.

| item | valor |
|---|---|
| Servidor | Droplet DigitalOcean, Ubuntu 24.04, US$4/mês, região NYC1 |
| **IP liberado na Technospeed** | **`137.184.195.94`** |
| Porta | 3000 |
| Código | repo privado `edustetner-collab/Kashim-proxy`, clonado em `/app` |
| Processo | PM2, app `kashim-proxy` |
| Credenciais Technospeed | vivem **só** em `/app/.env` no Droplet, nunca no Vercel |

### Como funciona

O Vercel chama `POST http://137.184.195.94:3000/proxy` com
`Authorization: Bearer $PROXY_SECRET` e corpo
`{ method, path, payerCpf, body }`. O proxy anexa `cnpjsh`/`tokensh`, repassa
para a Technospeed e devolve `{ status, body }` com o status original.

Nas rotas, `tsReq()` desvia para `tsViaProxy()` quando `PROXY_URL` está
definida. Sem `PROXY_URL`, o caminho direto antigo continua valendo — útil em
dev, inútil em produção (o IP do Vercel não está liberado).

Variáveis no Vercel (produção): `PROXY_URL`, `PROXY_SECRET`.
As `TECHNOSPEED_*` ficaram no Vercel mas **não são mais usadas** enquanto
`PROXY_URL` existir.

### Operação no Droplet

```bash
ssh root@137.184.195.94
pm2 status                 # estado
pm2 logs kashim-proxy      # logs
cd /app && git pull        # atualizar código
set -a; . .env; set +a; pm2 restart kashim-proxy --update-env
```

Teste de vida (de qualquer lugar):

```bash
curl -H "Authorization: Bearer $PROXY_SECRET" http://137.184.195.94:3000/health
# {"ok":true}
```

### Pendência: o tráfego Vercel→proxy é HTTP puro

O CPF do usuário e as transações bancárias trafegam **sem TLS** entre o Vercel e
o Droplet. As credenciais da Technospeed não passam por aí (ficam no Droplet),
mas dado pessoal em claro na internet é problema de LGPD. **Resolver antes do
primeiro usuário real**: apontar `proxy.kashim.com.br` (registro A) para
`137.184.195.94`, instalar Caddy no Droplet (certificado Let's Encrypt
automático) e trocar `PROXY_URL` para `https://proxy.kashim.com.br`.

---

## O que está pronto

| Arquivo | Papel |
|---|---|
| [api/of-connect.ts](../../api/of-connect.ts) | Cadastra pagador + conta, devolve o link de autorização. GET lista, DELETE revoga |
| [api/of-sync.ts](../../api/of-sync.ts) | Sincronização sob demanda (botão) |
| [api/of-cron.ts](../../api/of-cron.ts) | **Job 9h e 21h — é ele quem realmente traz os dados** |
| [api/of-webhook.ts](../../api/of-webhook.ts) | Recebe `transaction_deleted` e `transactions_updated` |
| [api/of-transactions.ts](../../api/of-transactions.ts) | GET/POST/PATCH das transações (pré-existente) |
| [components/ConectarBanco.tsx](../../components/ConectarBanco.tsx) | Tela de conectar banco, com busca e 43 bancos |
| `public/bancos/*.png` | 40 logos, 69 KB |

Migrations rodadas no Supabase: [migrations.sql](migrations.sql),
[migrations-v2.sql](migrations-v2.sql), [migrations-v3.sql](migrations-v3.sql),
[migrations-v4.sql](migrations-v4.sql). **Todas aplicadas.**

Variáveis no Vercel (todas marcadas Sensitive): `TECHNOSPEED_CNPJ_SH`,
`TECHNOSPEED_TOKEN_SH`, `TECHNOSPEED_BASE_URL`, `OF_WEBHOOK_SECRET`.

### Verificação de saúde das rotas

```bash
curl -o /dev/null -w "%{http_code}\n" https://kashim.com.br/api/of-connect   # 401
curl -o /dev/null -w "%{http_code}\n" https://kashim.com.br/api/of-sync      # 405
curl -o /dev/null -w "%{http_code}\n" https://kashim.com.br/api/of-cron      # 401
curl -o /dev/null -w "%{http_code}\n" https://kashim.com.br/api/of-webhook   # 405
```

**500 em qualquer uma = import local quebrou.** Ver "armadilhas" abaixo.

O webhook foi testado de ponta a ponta: rejeita sem segredo (401), rejeita com
segredo errado (401), aceita com o correto (200).

---

## Armadilhas que já custaram caro

### 1. Vercel não empacota import local em `api/`

Está no [CLAUDE.md](../../CLAUDE.md) e foi ignorado uma vez: `of-connect.ts` e
`of-sync.ts` importavam de `lib/openfinance/` e **retornavam 500**, enquanto
`of-transactions.ts` (sem imports) funcionava. Por isso o cliente HTTP, o parser
e o mapa de categorias estão **duplicados dentro de cada rota**.

Consequência: mudou a lógica de categorização? Tem que mudar em **três** lugares
— `of-sync.ts`, `of-cron.ts` e `lib/openfinance/categoryMap.ts` (este último só
serve ao frontend).

### 2. `npm run build` não valida TypeScript

É só `vite build`. Rodar sempre antes de deployar:

```bash
npx tsc --noEmit --pretty false 2>&1 | Select-String "^api/|ConectarBanco"
```

Os erros em `App.tsx`, `index.tsx`, `lib/supabase.ts` e `OnboardingWizard.tsx`
são **pré-existentes** — ignorar.

### 3. A documentação deles se contradiz

O spec OpenAPI diz `uniqueid`; o artigo do suporte diz `uniqueId`. O código
aceita as duas grafias. O mesmo vale para `openfinanceLink` / `openFinanceLink`.

E o mais traiçoeiro: no exemplo oficial, `transaction` vem **vazio** e as
transações estão todas em `transactionDuplicated`. O parser lê os dois blocos.

### 4. Documentação só abre pela API JSON

O HTML de `atendimento.tecnospeed.com.br` dá 403. Use:

```
https://atendimento.tecnospeed.com.br/api/v2/help_center/articles/search.json?query=<termo>
https://atendimento.tecnospeed.com.br/api/v2/help_center/pt-br/articles/<id>.json
https://docs.pagamentobancario.com.br/api.json          # spec completo, 808 KB
```

---

## Limites da API (definem a arquitetura)

| Operação | Limite |
|---|---|
| Gerar protocolo | **1 sucesso a cada 6 horas** por conta (créditos mensais) |
| Ler extrato | 3 req/min, **cache de 1 hora** |
| Latência do banco após autorização | **6 a 24 horas** |

Por isso **não existe "sincronizar agora"**. Nunca fazer polling: com cache de
1 hora, insistir devolve a mesma resposta e queima a cota. O `of-cron.ts`
reaproveita o protocolo dentro da janela de 6h (`last_protocol_id` /
`last_protocol_at` em `bank_connections`) e espera ~21s entre contas.

---

## Decisões de produto travadas com o Eduardo

1. **CPF** é pedido só na hora de conectar o banco, não no cadastro
2. **Cliente existente que ativa OF**: corte limpo no mês atual, passado intocado
3. **OF aparece no onboarding**, não escondido em Configurações
4. **Paywall no app**: aviso + redirect para a web, sem preço (regra da Apple)
5. **Visível só para `eduardo_cda@hotmail.com`** durante os testes — o gate está
   em [ClientSettings.tsx](../../components/ClientSettings.tsx), procurar por
   `eduardo_cda`

---

## Dúvida de desenho ainda aberta

A tela pede banco, agência e conta. Mas o artigo "Criar Pagador e Conta" e o
vídeo de lançamento dizem que **o cliente escolhe o banco dentro do conector da
Technospeed** — ou seja, ele escolheria duas vezes.

Pior: o enum de `bankCode` do `POST /account` aceita só 18 códigos corporativos e
**não inclui Nubank (260)**, embora o Open Finance suporte 47 instituições.

Se a resposta do chamado for "o `bankCode` é apenas formal", a tela simplifica
muito: cliente informa só o CPF e vai direto para a autorização, e o seletor de
bancos sai inteiro. **Por isso não vale mexer na tela antes da resposta.**

---

## Próximos passos, na ordem

1. ⏳ Technospeed liberar o IP `137.184.195.94` (formulário enviado em 2026-08-10)
2. Assim que liberar: rodar o curl de diagnóstico **de dentro do Droplet** —
   é o único lugar com o IP liberado
3. Testar o fluxo real ponta a ponta em **staging**
4. Cadastrar o webhook na API deles:
   `https://kashim.com.br/api/of-webhook?secret=<OF_WEBHOOK_SECRET>`
5. Colocar TLS no proxy antes de qualquer usuário real
   (ver [Pendência: HTTP puro](#pendência-o-tráfego-vercelproxy-é-http-puro))
6. Simplificar a tela conforme a resposta sobre `bankCode`
7. Retomar a [ordem de implementação](design-produto.md#7-ordem-sugerida-de-implementação)
   a partir da etapa 5 — alimentar categorias e tetos com transação real
