# Semana de lançamento — checklist

Varredura de 2026-09-08, feita lendo o código (não a memória). Versão legível
para o Eduardo: artifact `314d4e65-8dc1-410e-933d-b1062c870b8d`.

**Contexto:** o Open Finance passou a funcionar em 2026-09-08 (era o aparelho
antigo — ver memória `openfinance-jornada-quebra-no-celular`). O produto
funciona; o que não acompanha é tudo que EXPLICA o produto para quem chega.

## Achados

**1. O tutorial ensina o contrário do Open Finance.** ⚠️ o mais grave
O passo `block-faturas` do `planoTour` diz *"Lance o valor TOTAL da fatura de
cada cartão — não detalhe os itens aqui"*. Para quem conectou o banco isso está
errado. Os 6 tours inteiros assumem digitação manual. **Não basta acrescentar
capítulo — os capítulos existentes precisam de duas versões.**

**2. O tour não conhece a tela de banco.**
`TourScreen = 'plan' | 'teto' | 'metas' | 'desempenho' | 'settings'` em
`lib/onboarding/types.ts`. Zero ocorrências de "open finance", "banco",
"extrato" ou "conectar" em `lib/onboarding/content/`.

**3. O wizard de entrada para na metade.**
`components/OnboardingWizard.tsx`: 29 passos (`STEPS`), ~25 perguntas de gasto,
nenhuma menção a conectar banco nem ao prazo de 24h. O roteiro do Eduardo é
boas-vindas → gastos → **conectar banco** → **explicar prazo e avisar** — os
dois últimos não existem.

**4. RESOLVIDO em 2026-09-08 pelo Eduardo, simulando conta nova.**
A causa não era alvo errado — era o MODELO do tour. Ele pede clique, e:
- o card do tour cobre a tela, então não dá para clicar no que ele pede;
- a sequência do tour não bate com o fluxo real (clicou em "variável" → o passo
  seguinte já pergunta débito/crédito, pulando o passo de escrever a descrição);
- passos descrevem o que não está na tela ("fechamento e vencimento" sem cartão
  lançado; "sem contar duas vezes" sem mostrar nada).

## DECISÕES DO EDUARDO (2026-09-08)

**D1. O tour deixa de ser clicável e passa a ser ILUSTRADO.**
Imagens com dado fictício mostrando o fluxo, em vez de mandar o usuário clicar.
Cada caminho tem seu conjunto: clicou em fixa → imagens da fixa; variável →
imagens da variável; lazer → imagens do lazer. Resolve os três problemas de uma
vez e mata a fragilidade de alvo/desktopOnly/mobileOnly.

**D2. Dois tours completos, não um com variações.**
Um SEM Open Finance (caminho de lançamento manual) e um COM Open Finance
(caminho da vinculação + contas pendentes de integrar).

**D4. Dois pontos de entrada da conexão bancária** (2026-09-08)
- **Cliente novo:** ao terminar o wizard de contas, **cai automaticamente** na
  tela de conexão. Induzido, não opcional. *"Vamos já cadastrar seus bancos
  para o Kashim puxar suas contas sozinho."* Não existe "de onde ele começa" —
  o tour É o início.
- **Cliente que já usa:** toca em **EXTRATO** na barra inferior e cai na mesma
  tela de conexão.

⚠️ **Conflito com o portão `lib/ofAccess.ts`.** Hoje só o Eduardo enxerga
qualquer superfície de Open Finance (regra dele, repetida 3× — ver CLAUDE.md).
O cenário do cliente novo **não pode** empurrar todo mundo para a conexão
enquanto o portão estiver fechado. Construir com `hasOpenFinanceAccess(user)`
decidindo entre DUAS saídas do wizard (com banco / sem banco), nunca troca
pura — mesmo padrão de `open-finance-nao-pode-remover-do-plano-normal`. No dia
em que o Eduardo abrir o portão, o fluxo já está pronto e não precisa deploy.

**D3. As ~25 perguntas do wizard FICAM.** (resposta à pergunta em aberto)
Razão dele: o cliente tem de entrar no app **já sabendo a expectativa de teto de
gastos**. Divergência depois é esperada e se resolve atualizando o valor. Ideia
associada: se passar ~3 meses sem bater o teto, o app sugere adaptar.

## Ordem (a sequência importa)

1. **Eduardo usa o app com o Itaú real.** Nenhum tutorial escrito antes disso
   estará certo. **Não fazer deploy enquanto ele testa** — recarrega a tela.
2. **Reescrever os 6 tours em duas versões** (manual × Open Finance). Único
   item que pode começar antes do 1, porque o problema é o que já está escrito.
3. **Tutorial de Open Finance do zero** — exige `TourScreen` novo.
4. **Fechar o fluxo de entrada** — wizard → conectar banco → prazo.
5. **FAQ** — texto pronto em `docs/openfinance/AJUDA-CONEXAO.md`, falta a tela.
   Modelo que o Eduardo gostou: escolher assunto e receber o artigo ANTES de
   abrir chamado (como a TecnoSpeed faz).
6. **Fluxo de pagamento** — ainda NÃO auditado. Não opinar sem ler.

## Aguardando o Eduardo

- print do passo exato onde o tour desanca + qual aparelho (achado 4)
- **decisão de método:** as 25 perguntas do wizard continuam para quem conecta
  o banco? É decisão dele, não de código. Implementar os dois caminhos.
- depois do teste: o que bateu e o que não bateu, com nome de conta e valor
- 3 prints para a página de vendas: conexão concluída, extrato populado,
  diagnóstico preenchido
