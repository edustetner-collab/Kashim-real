# O fluxo de conexão, tela a tela

Mapeado dos prints que o Eduardo tirou em 2026-09-08 conectando o Banco Inter.
É a fonte para montar o tour ilustrado de Open Finance (decisão D1 em
`docs/LANCAMENTO.md`).

**Todos os dados aqui já são FICTÍCIOS.** Os prints originais tinham CPF, CEP,
endereço, agência e conta reais do Eduardo, e não entram no repositório nem no
app. Use exatamente os valores falsos abaixo em qualquer mock.

| campo | valor fictício a usar |
|---|---|
| Nome | Marina Alves Ferreira |
| CPF | 000.000.000-00 |
| CEP | 00000-000 |
| Endereço | Rua das Laranjeiras, 120 — Centro |
| Banco | 077 — Banco Inter |
| Agência / Conta | 0001 / 12345-6 |
| Cartões | ·· 1234, ·· 5678 |
| Renda | R$ 8.000 |

## As 13 telas

Três donos diferentes. Isso importa: só podemos mudar o que é nosso, e o
tutorial precisa preparar o usuário para o que NÃO controlamos.

### Parte 1 — dentro do Kashim (nossas telas, fundo escuro)

**1. Passo 1 de 2 · Seus dados** — nome, CPF, CEP (com validação que preenche
rua/cidade), número, bairro. Rodapé: *"Seus dados são usados apenas para
autorizar a conexão com o banco. Nada é compartilhado."*

**2. Passo 2 de 2 · Dados do banco** — busca de banco (Banco do Brasil, Caixa,
Inter, C6…), agência + dígito, conta + dígito → **Conectar banco**.

**3. Autorize no seu banco** — a tela de instruções, com os quatro passos, o
botão verde **Abrir autorização do banco**, o **Copiar link da autorização**, o
**Já autorizei no banco** e o aviso de 6 a 24 horas.

### Parte 2 — fora do Kashim (Technospeed → Pluggy → banco, fundo claro)

A partir daqui o usuário sai do app e vê `api.pagamentobancario.com.br` na barra
do navegador. **É o momento de maior desistência**, porque a marca some.

**4. Autorize a sua conta** (Technospeed) — repete Banco / Agência / Conta para
conferência → **+ Conectar conta**.

**5. "OpenFinance usa a Pluggy para se conectar às suas contas"** — blocos de
Segurança e Privacidade → **Continuar**. Primeira vez que o nome *Pluggy*
aparece; o usuário nunca ouviu falar dela.

**6. Verificação de Segurança** — logo do banco → **Conectar**.

**7. "Confirme os dados que serão compartilhados"** (tela DO BANCO) — ⚠️ **o
momento crítico de confiança.** O banco lista tudo que pode compartilhar:
Conta, Investimentos, Cartão de crédito, Cadastro, Operações de crédito. E o
Prazo aparece como **"Termina em: Indeterminado"**.

> O Kashim lê **apenas extrato de conta e de cartão** — é só o que as chamadas
> `statementType: BANK` e `CREDIT_CARD` pedem. Mas o consentimento que o banco
> apresenta é mais largo que isso, e quem está com medo vai parar aqui. O tour
> **tem** que falar disso antes, senão perde o usuário nesta tela.

**8. "Te levando para o PLUGGY BRASIL INSTITUICAO DE PAGAMENTO LTDA"** — a razão
social completa, em caixa alta, sem acento. Assusta mais que tranquiliza.

**9. Autenticando a sua conta · 100%** — *"Seus dados foram coletados com
sucesso"* + link "Faça a gestão dos seus consentimentos no portal Meu Pluggy"
→ **Fechar**. É aqui que aparece o código que o usuário acha que precisa copiar
(ver `AJUDA-CONEXAO.md`, pergunta 1).

### Parte 3 — de volta ao Kashim

**10. Bancos conectados** — lista com ✅ Conectado e a data.

**11. Extrato bancário · Escolha o banco para categorizar** — por banco, conta
corrente e cada cartão, com contador laranja do que falta categorizar e chave
liga/desliga.

**12. Pop-up "N transações esperando você"** — *bora organizar* →
**Categorizar agora** / *Agora não, depois eu faço*.

**13. Plano com o cartão alimentado** — a linha da fatura mostrando
`Rastreado (mês) − R$ x` e `A categorizar R$ 0,00`.

## Duas observações de produto

**O banco é escolhido duas vezes.** Na tela 2 (dentro do Kashim) e de novo na 6
(na Pluggy). A tela 3 já avisa — *"O banco pede para escolher a instituição de
novo — é normal"* —, e o print prova que o aviso está certo. Manter.

**A marca desaparece por seis telas.** Da 4 à 9 o usuário não vê Kashim em lugar
nenhum, vê `api.pagamentobancario.com.br`, "Pluggy" e a razão social em caixa
alta. O tour precisa avisar que isso vai acontecer e que é normal — é a diferença
entre "que site é esse?" e "ah, é a parte que ele falou".

## O que ainda falta capturar

Os 13 prints cobrem o caminho que deu certo. Faltam os estados em que o usuário
realmente vai precisar de ajuda:

- **espera** — o Extrato logo depois de autorizar, com nada ainda (é onde a
  pessoa acha que quebrou);
- **falha** — a tela do banco mandando baixar o app;
- **categorização** — a tela onde se atribui a categoria a uma transação (temos
  o convite, na tela 12, mas não o ato);
- **ponto de partida** — de onde no app se chega à tela 1, que é onde o tour
  começa.
