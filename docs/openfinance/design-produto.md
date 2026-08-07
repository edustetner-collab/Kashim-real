# Open Finance — desenho de produto

> Decisões travadas com o Eduardo em 2026-08-07. Este documento é a fonte da
> verdade do **comportamento**. Para o schema dos dados da Technospeed, ver
> [schema-notes.md](schema-notes.md). Para as tabelas, [migrations.sql](migrations.sql).

---

## 0. Premissa (não negociável)

**Ridiculamente simples de entender.** A consultoria do Eduardo nunca foi complexa
e o app não pode ser. Toda decisão abaixo foi tomada com esse filtro: se explicar
exige mais de uma frase, está errado.

Corolário: **não criar abas novas.** Aba nova é complexidade. O Open Finance
alimenta as telas que já existem.

---

## 1. A regra única

> **Cada transação conta uma vez, na categoria dela.
> A fatura não soma nada — ela só mostra o que já foi contado.**

### Por que isso resolve a dupla contagem

Hoje (sem OF) o cliente digita o total da fatura porque o app não sabe o que tem
dentro. A fatura é um **substituto** de um monte de gastos desconhecidos. Daí a
necessidade de tirar a conta fixa do mês corrente pra não contar duas vezes.

Com OF o app conhece cada transação da fatura. O substituto vira desnecessário —
e nocivo, porque duplica.

Então, para cliente OF:

- **A linha "Faturas de Cartão" deixa de ser custo.** Vira agrupamento visual.
- Clicar nela abre: *"Fatura de setembro — R$ 3.200 · mercado R$ 800 ·
  transporte R$ 400 · lazer R$ 600 · …"*
- O **Total de Custos soma as categorias**. Só.

Isso é **mais simples que o modelo atual**, não mais complexo. Some a regra de
"tira do mês corrente", some o "apaga da conta fixa quando virar o mês", some a
dupla contagem. O cliente OF nunca precisa saber que essas regras existiram.

---

## 2. Em que mês cada gasto cai

Uma data só: **o mês em que o gasto compromete o bolso.**

| Forma de pagamento | Cai no mês |
|---|---|
| Débito, PIX, TED, boleto, dinheiro | mês da compra |
| Crédito (à vista ou parcelado) | mês do **vencimento da fatura** |

> ✅ **Já implementado** em `resolveKashimMonth()` ([lib/openfinance/parser.ts:162](../../lib/openfinance/parser.ts#L162)) —
> usa `billDueDate` no cartão, `date` no resto.

### O que o cliente vê

Cada categoria, em cada mês, mostra **quanto já está comprometido naquele mês** —
misturando origens, com a composição visível ao clicar:

```
MERCADO · agosto            R$ 800 / R$ 1.500 planejado
████████████░░░░░░░░  53%

  ├ R$ 400  fatura Nubank (compras de julho no crédito)
  └ R$ 400  PIX e débito de agosto
```

E ao navegar para setembro, ele já enxerga o que está comprometido lá pelas
compras que fez no crédito agora:

```
MERCADO · setembro          R$ 400 / R$ 1.500 planejado
█████░░░░░░░░░░░░░░░  27%

  └ R$ 400  fatura Nubank (compras de agosto no crédito)
```

**Parcelas resolvem sozinhas.** A Technospeed manda cada parcela como transação
própria já no vencimento certo (ver schema-notes §1). Compra em 5x nasce
espalhada nos 5 meses. Nada a espalhar do nosso lado.

---

## 3. Decisões travadas

### 3.1 Categorização — categoriza tudo, marca as duvidosas

O cliente abre o app e **já está tudo preenchido**. Transações de baixa confiança
ganham um selo discreto `revisar`. **Nunca bloqueia, nunca cobra, nunca deixa
número incompleto.** Ele corrige se e quando quiser.

Motivo: fila de pendências vira tarefa, tarefa vira abandono. E número incompleto
é pior que número aproximado — o cliente perde a confiança na tela.

### 3.2 Plano × real — só avisa, não mexe no plano

Se o planejado é R$ 1.500 e o real é R$ 1.850, o app **mostra o estouro e sugere
ajustar**, mas quem muda o número é o cliente ou o coach.

Motivo: o teto é uma **meta**. Se o app ajusta sozinho, o teto vira espelho do
gasto e nunca mais acusa estouro — perde a função inteira.

### 3.3 Histórico — só do mês vigente pra frente

Linha de corte no mês atual do plano. Não reescreve passado que o cliente ou o
coach preencheram na mão. Parcelas futuras entram normalmente.

> ✅ **Já implementado** em `makeCutoffFilter()` ([lib/openfinance/parser.ts:174](../../lib/openfinance/parser.ts#L174)).

---

## 4. Telas

**Uma coisa nova só.** O resto é tela existente recebendo dado real.

| Tela | Status | O que muda |
|---|---|---|
| **Conectar banco** | 🆕 criar | Único fluxo novo. Vive dentro de Configurações — **não vira aba** |
| **Extrato** | casca existe | Ganha conteúdo: transações por banco e por mês, + as marcadas `revisar` |
| **Gastos Mensais** | existe | O "realizado" se preenche sozinho; fatura vira agrupamento |
| **Gastos Frequentes** | existe | Tetos alimentados pelas transações reais |
| **Notificação de teto** | infra existe | Push via Capacitor quando cruzar 80% |

### A gaveta de composição (o coração da UX)

Não precisa de tela nova: **clicar em qualquer número do plano abre uma gaveta com
as transações que formam aquele número.** A categoria se troca ali mesmo, inline.

Vale para célula de categoria, para fatura, para qualquer valor. É onde o cliente
faz *"peraí, isso aqui não é mercado, é comida do trabalho"*.

Trocar a categoria grava em `merchant_memories` → o app aprende e não erra de novo
naquele estabelecimento.

---

## 5. Isolamento: cliente sem Open Finance não muda nada

Flag `has_open_finance` no household.

| Flag | Comportamento |
|---|---|
| `false` (padrão) | **Exatamente como hoje.** Fatura é custo, regra de tirar do mês corrente vale, tudo manual |
| `true` | Fatura vira agrupamento, realizado automático, regra de tirar do mês corrente **desligada** |

Zero risco para quem já usa. As duas lógicas convivem no mesmo código, separadas
por essa flag.

---

## 6. O que já existe × o que falta

### Pronto

| Peça | Onde |
|---|---|
| Tabelas `bank_connections`, `bank_transactions`, `merchant_memories` | [migrations.sql](migrations.sql) — ⚠️ **confirmar se rodou no Supabase** |
| API de transações (GET / POST sync idempotente / PATCH categorizar) | [api/of-transactions.ts](../../api/of-transactions.ts) |
| API de memória por estabelecimento | [api/of-merchant-memory.ts](../../api/of-merchant-memory.ts) |
| Parser da Technospeed | [lib/openfinance/parser.ts](../../lib/openfinance/parser.ts) |
| Mapa de categorias + `suggestCategory` + `merchantKey` | [lib/openfinance/categoryMap.ts](../../lib/openfinance/categoryMap.ts) |
| Casca da tela de Extrato | [components/ExtratoBancario.tsx](../../components/ExtratoBancario.tsx) |
| Infra de notificação local (Capacitor) | [lib/notifications.ts](../../lib/notifications.ts) |

### Falta

1. **Conexão real com a Technospeed** — credenciais, fluxo de consentimento, callback.
   Nenhuma env var `TECHNOSPEED_*` existe ainda. (Eduardo já tem as credenciais em mãos.)
2. **Job de sync** — puxar statements periodicamente e chamar o POST que já existe.
3. **Flag `has_open_finance`** no household + branch nos cálculos do `monthlySummaries`.
4. **Gaveta de composição** — clicar no número → ver e recategorizar transações.
5. **Alimentar as barras/tetos** com transação real em vez de valor digitado.
6. **Notificação de 80% do teto** — a infra existe, falta o gatilho.
7. **Tela de conectar banco.**

---

## 7. Ordem sugerida de implementação

Cada etapa entrega algo verificável na tela — nada de big bang.

| # | Etapa | Entrega visível |
|---|---|---|
| 1 | Rodar `migrations.sql` + flag `has_open_finance` | nada quebra; flag existe |
| 2 | Conexão Technospeed + tela de conectar | cliente conecta e vê "conectado" |
| 3 | Sync + popular `bank_transactions` | Extrato deixa de estar vazio |
| 4 | Auto-categorização (parser + `suggestCategory`) | transações chegam já categorizadas |
| 5 | Alimentar categorias e tetos (branch pela flag) | números do plano se preenchem sozinhos |
| 6 | Gaveta de composição + recategorizar | cliente clica e corrige |
| 7 | Fatura vira agrupamento (dupla contagem morre) | Compilação bate com a realidade |
| 8 | Notificação de 80% | push chega no celular |

---

## 8. Riscos e pontos de atenção

- **Semântica de credit/debit inverte** entre conta corrente e cartão. Errar isso
  transforma renda em despesa. Ver schema-notes §"SEMÂNTICA".
- **Transferências não são gasto.** `TEV` (mesma titularidade) e `CREDITCARDPAYMENT`
  devem ser ignorados. PIX/TED para corretora = Poupar/Investir, não despesa.
- **Mojibake UTF-8** nas categorias do provider ("TransferÃªncia") — normalizar na ingestão.
- **Cartões virtuais**: vários `creditCardNumber` no mesmo cartão. Agrupar por nome
  do cartão + `dueDate`, não criar 8 cartões.
- **Idempotência** já resolvida por `UNIQUE (household_id, transaction_id)` com
  `ignoreDuplicates` no upsert — transação já categorizada nunca é resetada por um re-sync.
- **Não instalar pacote npm publicado há menos de 7 dias** (regra do CLAUDE.md).

---

## 9. Glossário para o cliente (linguagem da tela)

Palavras que o cliente vê. Nada de jargão técnico.

| Não escrever | Escrever |
|---|---|
| transação pendente de categorização | revisar |
| conciliação bancária | seus gastos |
| Open Finance / consentimento | conectar seu banco |
| categoria sugerida com baixa confiança | revisar |
| competência × caixa | (nunca aparece — o cliente vê um número só) |
