# O que o Kashim chama na API da Technospeed

Documento para o suporte. Estado em 2026-09-08.

## Especificação usada

**Uma só:** o Swagger 2.0 "API de Pagamento - TecnoSpeed", baixado de
`docs.pagamentobancario.com.br/api.json` (cópia local em `ts-api.json`,
813 KB, 51 rotas). Não usamos nenhum outro contrato — nem SDK, nem Postman
collection de terceiros. O restante veio dos artigos do Zendesk de vocês.

Base: `https://api.pagamentobancario.com.br`

## Autenticação (igual em todas as chamadas)

```
Content-Type: application/json
cnpjsh:       <CNPJ da software house>
tokensh:      <token da software house>
payercpfcnpj: <CPF do pagador da conta em questão>
```

Saída por IP fixo (`proxy.kashim.com.br` → `137.184.195.94`), liberado por
vocês no chamado #884774.

## Rotas que usamos

| # | Método | Rota | Para quê |
|---|--------|------|----------|
| 1 | POST | `/api/v1/payer` | cria o pagador com `statementActived: true` |
| 2 | GET  | `/api/v1/payer` | lê o pagador quando o POST devolve 422 "já cadastrado" |
| 3 | PUT  | `/api/v1/payer` | `{ "statementActived": true }` — liga o Extrato de pagador já existente |
| 4 | POST | `/api/v1/account` | cria a conta com `statementActived: true`; devolve `accountHash` e `openfinanceLink` |
| 5 | GET  | `/api/v1/account/{accountHash}` | lê `statusOpenfinance` e `openfinanceId` (é assim que sabemos se autorizou) |
| 6 | PUT  | `/api/v1/account/{accountHash}` | `{ "statementActived": true }` — só quando o POST não confirmou |
| 7 | PUT  | `/api/v1/account/{accountHash}/openfinance/revoke` | cliente desconecta o banco |
| 8 | POST | `/api/v1/statement/openfinance` | gera o protocolo do extrato |
| 9 | GET  | `/api/v1/statement/openfinance/{uniqueId}` | lê o resultado do protocolo |
| 10 | GET | `/api/v1/statement/credit-card/openfinance?accountHash=` | lista os cartões da conta |

`POST /api/v1/notification` (webhook) está na spec mas **nunca foi cadastrado**
por nós — é por isso que a leitura hoje é por consulta agendada.

## Corpos exatos

**1. POST /api/v1/payer**
```json
{ "name": "...", "cpfCnpj": "...", "neighborhood": "...", "city": "...",
  "state": "..", "zipcode": "...", "street": "...", "addressNumber": "...",
  "statementActived": true }
```

**4. POST /api/v1/account** — repare que o corpo é um ARRAY
```json
[ { "bankCode": "341", "agency": "1234", "agencyDigit": "",
    "accountNumber": "56789", "accountNumberDigit": "0",
    "statementActived": true } ]
```

**8. POST /api/v1/statement/openfinance**
```json
{ "accountHash": "...", "dateStart": "AAAA-MM-DD", "dateEnd": "AAAA-MM-DD",
  "statementType": "BANK" }
```
Para cartão: `"statementType": "CREDIT_CARD"` + `"cardNumber": "<4 últimos>"`.

## Sobre `statementActived`

Mandamos `true` em **três** pontos, nesta ordem, porque nenhum sozinho se
mostrou suficiente:

1. no POST do pagador (rota 1);
2. no POST da conta (rota 4);
3. no PUT de correção (rotas 3 e 6), disparado só quando a resposta do POST
   **não** volta com `statementActived: true`.

O PUT do pagador existe porque um CPF já cadastrado antes pode estar com o
Extrato desligado, e o POST devolve 422 sem ligar nada. Foi orientação de
vocês. **Confirmem se essa é mesmo a sequência correta** e se algum outro
campo precisa acompanhar.

## Onde estamos travados

Conta do Bradesco: `statusOpenfinance = ATIVO`, `openfinanceId` preenchido.
Itaú e Nubank: `statusOpenfinance = PENDENTE_ATIVACAO`, `openfinanceId` vazio
e mensagem de erro vazia — a jornada quebra na tela do banco ("você não é
correntista, baixe o aplicativo"), antes de voltar para vocês. Chamado #884775.

## Um defeito na spec de vocês

Em `ts-api.json` existem duas chaves para `/api/v1/statement/openfinance`: uma
normal (POST) e outra com **espaço em branco no início** do path (GET). Quem
gerar cliente a partir do Swagger produz uma rota inválida.
