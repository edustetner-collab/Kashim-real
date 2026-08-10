# Open Finance — estado atual

> Última atualização: **2026-08-10**
> Leia isto primeiro ao retomar. Para o **comportamento** desejado do produto,
> ver [design-produto.md](design-produto.md). Este documento é sobre **onde
> paramos**.

---

## Resumo em uma frase

**O bloqueio acabou em 2026-08-10.** A Technospeed liberou o IP do nosso proxy
(`137.184.195.94`) e a primeira chamada autenticada da história funcionou:

```
GET /api/v1/payer  →  404 {"code":404,"message":"Pagador não encontrado"}
```

Esse 404 é sucesso: eles aceitaram as credenciais da Software House e
consultaram o CPF, que de fato não existe. Falta agora testar o fluxo real
ponta a ponta com um CPF verdadeiro.

---

## O bloqueio (histórico — resolvido em 2026-08-10)

> Mantido porque o diagnóstico custou dias e pode se repetir se o IP mudar.
> Se um dia voltar o `403` com HTML do `awselb`, é isto de novo.

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
| Endereço público | `https://proxy.kashim.com.br` (registro A na GoDaddy) |
| TLS | Caddy 2.6.2, certificado Let's Encrypt renovado sozinho |
| Firewall | `ufw` ativo — só 22, 80 e 443. A porta 3000 do Node só responde de dentro |
| Código | repo privado `edustetner-collab/Kashim-proxy`; cópia local em `Sistemas/kashim-proxy` |
| No servidor | `/app` — **não é mais um clone git**, os arquivos foram copiados por `scp` (ver incidente abaixo) |
| Processo | PM2, app `kashim-proxy` |
| Credenciais Technospeed | vivem **só** em `/app/.env` no Droplet, nunca no Vercel |

### Como funciona

O Vercel chama `POST https://proxy.kashim.com.br/proxy` com
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
pm2 status                 # estado do proxy
pm2 logs kashim-proxy      # logs do proxy
systemctl status caddy     # estado do TLS
```

Para publicar código novo (do PC, na pasta `Sistemas/kashim-proxy`):

```bash
scp index.js package.json root@137.184.195.94:/app/
ssh root@137.184.195.94 "cd /app && set -a && . ./.env && set +a && pm2 restart kashim-proxy --update-env"
```

Só chave SSH — a autenticação por senha está desligada
(`/etc/ssh/sshd_config.d/99-kashim-hardening.conf`). Para reverter, apagar esse
arquivo e rodar `systemctl reload ssh`.

O acesso é por chave SSH (`~/.ssh/id_ed25519` do PC do Eduardo, a mesma do
GitHub) — não pede senha. Se a chave se perder, o caminho de recuperação é o
painel da DigitalOcean: **Droplets → ⋯ → Access console** entra sem senha
nenhuma; **Access → Reset Root Password** gera uma senha nova por e-mail.

`caddy`, `pm2-root` e `ufw` estão todos `enabled` no boot — o servidor pode
reiniciar sozinho que tudo volta.

Teste de vida (de qualquer lugar):

```bash
curl -H "Authorization: Bearer $PROXY_SECRET" https://proxy.kashim.com.br/health
# {"ok":true}
```

### TLS — resolvido em 2026-08-10

O CPF do usuário e as transações bancárias trafegam entre Vercel e Droplet, então
o canal precisa de TLS por LGPD. Montado assim:

- registro A `proxy` → `137.184.195.94` no DNS da GoDaddy (o domínio fica lá,
  nameservers `ns11/ns12.domaincontrol.com` — **não** no Vercel)
- Caddy no Droplet, `/etc/caddy/Caddyfile` fazendo `reverse_proxy localhost:3000`
- certificado Let's Encrypt emitido e renovado pelo Caddy, sem intervenção
- `ufw` fechou a 3000 para fora; o Node só é alcançável pelo Caddy

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

### 5. Variável "Sensitive" no Vercel não volta nunca mais

`vercel env pull` devolve `""` para variáveis marcadas como *Sensitive* —
é write-only por definição. Vale para `TECHNOSPEED_CNPJ_SH`,
`TECHNOSPEED_TOKEN_SH`, `TECHNOSPEED_BASE_URL`, `OF_WEBHOOK_SECRET` e
`SUPABASE_JWT_SECRET`.

**O Vercel não é backup de segredo.** A cópia recuperável dessas credenciais
está em `Kashim/.env.local` (fora do git). Se esse arquivo sumir, só a
Technospeed pode reemitir.

### 6. `set -a` sem o hífen roda sem credencial e não reclama

`set a` (sem hífen) atribui um parâmetro posicional em vez de ligar o
auto-export. As variáveis viram locais do shell, o PM2 não herda nada, e o proxy
sobe **sem as credenciais da Technospeed** — respondendo `{"ok":true}` no
`/health` normalmente, porque o health check não usa credencial.

Foi o que aconteceu em 2026-08-10 e só apareceu quando a Technospeed liberou o
IP. Depois de qualquer restart, conferir de verdade:

```bash
curl -s -X POST https://proxy.kashim.com.br/proxy \
  -H "Authorization: Bearer $PROXY_SECRET" -H 'Content-Type: application/json' \
  -d '{"method":"GET","path":"/api/v1/payer","payerCpf":"11111111111"}'
# esperado: {"status":404,...,"Pagador não encontrado"}  → credenciais OK
# 401/403 → credenciais não chegaram no processo
```

### 7. Incidente: `/app` apagado em 2026-08-10

A pasta sumiu do Droplet enquanto o processo seguia rodando em memória (por isso
o `/health` continuava respondendo). Investigado: **não foi invasão** — só a
chave do Eduardo e a do console da DigitalOcean estavam autorizadas, e todos os
logins bem-sucedidos vieram do IP dele ou do console. As 489 tentativas de senha
falhas eram varredura automática da internet.

Reconstruído por `scp` a partir da cópia local. Depois disso a autenticação por
senha no SSH foi desligada.

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

1. ✅ ~~Technospeed liberar o IP~~ — liberado em 2026-08-10, chamada autenticada OK
2. Testar o fluxo real ponta a ponta com um CPF verdadeiro (cadastrar pagador,
   cadastrar conta, obter o link de autorização do Open Finance)
4. Cadastrar o webhook na API deles:
   `https://kashim.com.br/api/of-webhook?secret=<OF_WEBHOOK_SECRET>`
5. Simplificar a tela conforme a resposta sobre `bankCode`
6. Retomar a [ordem de implementação](design-produto.md#7-ordem-sugerida-de-implementação)
   a partir da etapa 5 — alimentar categorias e tetos com transação real
