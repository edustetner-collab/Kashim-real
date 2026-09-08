# Conectar o banco — conteúdo de ajuda para o usuário

Texto pronto para virar tela de Perguntas Frequentes e/ou aparecer para quem
falhou ao conectar. Escrito para leigo: nada de `intent://`, `openfinanceId`
ou "app-to-app". Origem: investigação de 2026-08-25 a 2026-09-08, encerrada
quando o Eduardo conectou o Itaú num aparelho novo depois de 30 dias travado.

**Onde deve aparecer:**
1. Antes de clicar em "Abrir autorização do banco" → só o item 1 (o código).
2. Quando a conexão fica `pending_authorization` por mais de um dia → itens 2 e 3.
3. Numa aba de Perguntas Frequentes → tudo.

---

## 1. "Apareceu um código no final. O que eu faço com ele?"

**Nada.** Pode fechar.

No fim da autorização o banco mostra um "identificador do Open Finance" com um
botão de copiar. Esse código é uma confirmação de que deu certo — não é uma
senha, e não precisa ser colado em lugar nenhum. O Kashim busca esse código
sozinho, direto com o banco.

Se você copiou, tudo bem. É só descartar e voltar para o app.

> **Nota interna:** o botão de copiar é da tela da Pluggy, não é nosso — não dá
> para remover. Por isso o aviso precisa vir ANTES, na nossa tela. Botão de
> copiar comunica "isto serve para algo depois", e é isso que gera a dúvida.

---

## 2. "Cliquei para autorizar e ele me mandou baixar o app do banco — mas eu já tenho o app instalado"

Esse é o problema mais comum, e quase sempre é **o aparelho**, não o banco.

Quando você autoriza, a página pede ao seu celular que abra o app do banco. Se o
celular responder "não tenho esse app" — mesmo tendo — a página faz a única coisa
que sabe fazer: manda para a loja. E o processo morre ali.

Tente nesta ordem:

**1. Tente em outro celular.** É o teste que mais resolve, e o mais rápido. Se
funcionar no outro aparelho, o problema é o seu — e você já conectou.

**2. Use o navegador de verdade.** Se você abriu o link pelo WhatsApp,
Instagram ou e-mail, ele abriu num navegador interno que não consegue chamar o
app do banco. Copie o link e cole no **Chrome** (Android) ou no **Safari**
(iPhone), abrindo o navegador pela tela inicial.

**3. No Android:** Ajustes → Aplicativos → *(o app do seu banco)* → **Abrir por
padrão** → ligue "Abrir links compatíveis". Desligado, o sistema responde
"não instalado" mesmo com o app lá.

**4. No iPhone:** em vez de tocar no link, **segure pressionado**. Se aparecer
"Abrir no *(banco)*" no menu, escolha por ali.

**5. Aparelho antigo.** Celular velho pode simplesmente não fazer essa ponte.
Foi exatamente o que aconteceu no nosso próprio teste: 30 dias de investigação,
e a conexão funcionou de primeira num aparelho novo.

---

## 3. "Conectei, mas não apareceu nenhum lançamento"

Conectar e receber os dados são duas etapas. Você concluiu a primeira.

**O banco tem até 24 horas** para liberar seu histórico. Esse prazo é do Open
Finance, não do Kashim — não há nada que a gente acelere.

O Kashim busca os dados **quatro vezes por dia**. Se você conectou agora, o
mais provável é que apareça na próxima busca ou, no pior caso, amanhã.

**Não fique apertando "sincronizar".** Cada pedido consome uma cota limitada, e
gastá-la agora significa não poder buscar quando os dados de fato estiverem
prontos. Deixe quieto que ele busca sozinho.

---

## 4. "Meu banco não abre o app de jeito nenhum"

Alguns bancos deixam você autorizar **pelo navegador**, digitando a senha do
internet banking, sem precisar abrir o app. O Bradesco é assim.

Quando essa opção existir na tela do banco, prefira ela — é o caminho que menos
quebra. Itaú e Nubank não oferecem essa alternativa para pessoa física: neles o
app é obrigatório, e aí vale rodar a lista da pergunta 2.

---

## 5. "Nada disso resolveu"

Abra um chamado pelo **Suporte**, dentro do app, com um print da tela onde
travou. Conte:

- qual banco você tentou;
- se está no celular ou no computador;
- em que ponto parou (a tela do banco abriu? pediu para baixar o app? deu erro?).

O print do momento exato da falha economiza dias de conversa.
