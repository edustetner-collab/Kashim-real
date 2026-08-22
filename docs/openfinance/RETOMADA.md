# Open Finance — onde paramos (2026-08-14)

> Documento de retomada. Leia isto antes de `ESTADO-ATUAL.md`, que tem a
> história técnica completa e as armadilhas já pagas.

## Em uma frase

O Open Finance **funciona de ponta a ponta** no Bradesco: conecta, importa conta
e cartão, calcula a fatura mês a mês com projeção de parcelas, categoriza e
lança. O que resta é acabamento de fluxo na interface e o Itaú, que depende da
Tecnospeed.

## O que está funcionando

- **Conexão** — Bradesco `ATIVO`. Só fecha pelo **navegador**; pelo app do banco
  a jornada quebra.
- **Importação** — conta corrente e cartão, com o cartão opcional por chave
  (ligado por padrão, um liga/desliga por cartão).
- **Fatura mês a mês** — dentro de ~3% do que o app do Bradesco mostra.
- **Categorização** — mapa de códigos + memória por estabelecimento +
  casamento por nome. Lança sozinho quando já ensinado ou quando o nome é óbvio.
- **Notificação** — e-mail quando a autorização conclui e quando chegam
  lançamentos novos. Portão de acesso vale para o e-mail também.

## Bloqueios externos

| Item | Situação |
|---|---|
| Itaú | `zy2Z3xmvyg` deu `FALHA` com `openfinanceId` `6c6fe044-…`; as de agência 7440 seguem `PENDENTE_ATIVACAO`. Chamado aberto. |
| Webhook | Cadastro é **por pagador** (`payercpfcnpj` obrigatório). Nunca cadastrado — precisa ir dentro do `ensurePayer`. |
| Programa de Incentivo | Comprovante pronto: protocolo `ETnif0f_tI-ys4` (produção, com transações). Falta abrir o ticket. |

## Migrações — TODAS já rodadas, menos uma

**Todas aplicadas e conferidas em 2026-08-14**: `migrations-v5` a `v11`,
`client-access-control.sql` e `partial-expenses-payment-source.sql` (as duas
partes, incluindo `card_last4`).

Nenhuma migração pendente. Ao criar migração nova, conferir se rodou antes de
investigar comportamento estranho — coluna faltando faz o `SELECT` do cron
falhar inteiro e nada sincroniza, em silêncio.

## O padrão que explica quase todo bug desta fase

Coisas modeladas no nível da **linha** que o Open Finance passou a exigir no
nível do **lançamento**. Aconteceu três vezes:

1. débito × crédito → `PartialExpense.paymentSource`
2. transferência entre o casal → `bank_transactions.counterparty_doc`
3. qual cartão → `PartialExpense.cardLast4`

Ao encontrar comportamento estranho envolvendo cartão, suspeite disto primeiro.

## Regras de produto que não se descobrem no código

- **Card na aba Gastos** existe para linha que acumula **vários** gastos no mês
  (mercado, gasolina, lazer, assinaturas). Gasto único não precisa. Mas clicar
  para inspecionar cria o card sob demanda — senão o lançamento fica
  inalcançável e não há como recategorizar.
- **Todo lançamento tem que poder ser recategorizado**, sempre, de qualquer
  origem. É o requisito que sustenta o lançamento automático.
- **Valor de gasto vindo do cartão é travado** — já foi cobrado, mudar descasa
  da fatura.
- **A fatura não duplica** com as despesas categorizadas: o custo do mês faz
  `Math.max(0, fatura − rastreado)`. Isto já existia antes do Open Finance.

## Pendências de interface

1. **Lançamento manual caindo no mês errado (ABERTO)** — na versão **web**,
   lançar uma variável à vista jogou o gasto na **coluna de setembro** estando
   em agosto. O lançamento usa `months[mobileMonthIdx]`, e na web não há
   seletor de mês. Investigar por onde o desktop dispara o ExpenseSheet e qual
   índice chega lá. *Não foi diagnosticado — evitar chutar.*
2. Perguntas desnecessárias já removidas do fluxo vindo do extrato (forma de
   pagamento, qual cartão, à vista/parcelado). Conferir se sobrou alguma.
3. Tour guiado precisa ser refeito — ver `docs/onboarding-plan.md`.

## Como testar sem esperar o cron

```bash
npx vercel env pull .env.production --environment=production --yes
# gerar protocolo (gasta 1 dos 4 diários por conta)
curl -H "Authorization: Bearer $CRON_SECRET" 'https://kashim.com.br/api/of-cron?force=generate'
# importar o que ficou pronto (não gasta protocolo)
curl -H "Authorization: Bearer $CRON_SECRET" 'https://kashim.com.br/api/of-cron'
# reprocessar com regras novas (apaga só as pendentes)
curl -H "Authorization: Bearer $CRON_SECRET" 'https://kashim.com.br/api/of-cron?reimport=1'
rm -f .env.production   # não deixar segredo em disco
```

**Sempre apague o `.env.production` depois.**

## Duas armadilhas que custaram horas nesta sessão

- **Correção no código ≠ correção no dado.** Categoria e fatura são gravadas na
  importação. Trocar o mapa ou o cálculo não reescreve o que já entrou — precisa
  de `?reimport=1`. Isso enganou três vezes.
- **Campo escondido não pode ser obrigatório.** Esconder a pergunta "qual
  cartão?" mantendo a validação dela travou o botão Lançar sem nada na tela
  explicando.

## Carimbo de versão

Configurações → embaixo de "Sair da conta" mostra dia/hora do build. Ao receber
"não entrou", **olhar isso antes** de investigar lógica.
