# Open Finance (Technospeed) — schema real dos dados + mapeamento p/ o Kashim

Baseado nos exemplos enviados pela Technospeed (2026-08-07): `exemplo_cartaoCredito.json`
(fatura de cartão) e `Extrato.json` (conta corrente). Sintéticos, valores fake.

## Dois tipos de "statement" (têm shapes diferentes)
- **`type: "credit_card"`** (fatura): tem `creditCardCurrentCreditLimit`, e cada transação tem
  `creditCardNumber` (últimos 4), `creditCardBill{dueDate,totalAmount,minimumPaymentAmount,allowsInstallments}`,
  `code`/`category` (ex.: VEHICLEMAINTENANCE, DIGITALSERVICES, WELLNESSANDFITNESS), `creditCardMerchant`.
- **Conta corrente (extrato)**: sem `type`; transações têm `paymentMethod` (PIX/TED/BOLETO/DOC/TEV),
  `code`, `category` (Salário, Moradia, Utilidades, Investimentos...), `paymentBarcode`,
  `paymentBaseAmount/DiscountAmount/InterestAmount/PenaltyAmount`, `name` (contraparte).
  E traz **`balance{inicial,final}`** (saldo!).

## ⚠️ SEMÂNTICA de credit/debit MUDA conforme o tipo (crítico — fácil errar)
- **Conta corrente:** `transaction.credit[]` = **ENTRADAS** (renda/recebimentos); `transaction.debit[]` = **SAÍDAS** (despesas).
- **Cartão:** `transaction.debit[]` = **COMPRAS/GASTOS**; `transaction.credit[]` = **pagamentos da fatura + estornos**
  (contém `CREDITCARDPAYMENT` "Pagamento recebido" — IGNORAR no controle de gasto).

## Campos comuns por transação
`transactionId` (UUID, idempotência), `transactionType` (credit/debit), `code` (enum categoria),
`amount` (STRING — parsear p/ número), `date` (YYYY-MM-DD), `sequence`, `description` (texto/merchant),
`fitid` (id bancário, presente na conta, null no cartão), `name`, `category` (rótulo legível).
Há também `transactionDuplicated{credit,debit}` — **a Technospeed já marca duplicadas** (ajuda no dedup).

## Achados que MOLDAM a implementação
1. **Parcelamento vem PRONTO no cartão:** a descrição traz "NN/NN" ("ACADEMIAS GR-CT IF01/12",
   "MP*CIMGLOBALPARTS 01/05") e **cada parcela é uma transação própria, em sua `creditCardBill.dueDate`**.
   → NÃO precisamos espalhar parcelas: cada uma já cai no mês certo. Casa com o modelo do Kashim.
2. **Fatura = agrupar por `creditCardBill.dueDate`**; `totalAmount` = total da fatura. Mapeia direto
   pro "Cartão" do Kashim. dueDate null = fatura ainda não fechada (futura/projeção).
3. **Vários `creditCardNumber` num mesmo cartão** (cartões virtuais). Decidir: agrupar tudo por `name`
   do cartão numa fatura só por dueDate (provável), não criar 8 "cartões".
4. **Categoria/`code` enriquecidos** = 1º chute forte de auto-categoria. Montar mapa
   provider→bucket Kashim (ex.: Moradia/Utilidades→Fixa; Salário→Renda; Investimentos→Poupar/Investir;
   Wellness/Academia→Fixa ou Lazer; Vehicle maintenance→Variável). Stets refina o resto.
5. **Ignorar/segregar transferências:** `TEV` (mesma titularidade) e `CREDITCARDPAYMENT` NÃO são
   gasto — ignorar. `TED`/PIX p/ corretora (category Investimentos) = **Poupar/Investir (20%)**, não despesa.
   Ou seja: nem todo débito é "gasto" — separar despesa × investimento × transferência interna.
6. **PIX/TED/BOLETO/DOC:** confirmados. No modelo do Kashim (só débito/crédito) → tudo que sai da conta
   = "débito/saída"; mostrar o método como TAG opcional. O que importa é a categoria.
7. **Saldo real** disponível (conta) → futura feature "saldo".
8. **Histórico longo + parcelas FUTURAS** (exemplo vai de 2025-07 a 2027-01). Ótimo p/ a projeção de 12
   meses (parcelas a vencer pré-preenchem meses futuros). Mas a "linha de corte" do IMPORT começa no mês
   vigente do plano p/ não reescrever passado.
9. **Encoding:** no exemplo da conta, categorias vieram com mojibake ("TransferÃªncia"=Transferência) —
   tratar/normalizar UTF-8 na ingestão.
10. **Chaves de idempotência:** `transactionId` (+ `fitid` na conta) p/ não duplicar a cada sync.

## Reaproveitamento no Kashim (o que já serve)
- Cada transação categorizada vira um `partialExpense` no item/categoria certo → diagnóstico/teto/barras
  já refletem automaticamente (a EXIBIÇÃO já existe).
- Parcelas já mês-a-mês = casa com o espalhamento que o app já entende.
- Stets como motor de sugestão pro que a categoria do provider não resolver.

Ver [[project-open-finance-readiness]] (gaps) e [[project-open-finance-pricing]] (planos/preço).
Amostras cruas: docs/openfinance/exemplo_cartaoCredito.json e Extrato.json.
