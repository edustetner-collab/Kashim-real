// Perguntas frequentes — mostradas ANTES do formulário de chamado.
//
// Modelo que o Eduardo gostou na TecnoSpeed (2026-09-08): o usuário escolhe o
// assunto e já recebe o artigo que provavelmente resolve, em vez de abrir
// chamado e esperar. Cada chamado que não precisa existir é um dia a menos de
// espera para ele e uma hora a menos de suporte para o Eduardo.
//
// Os artigos de Open Finance só aparecem para quem tem acesso ao módulo — o
// portão é `hasOpenFinanceAccess`, igual ao resto do app. Mostrar "conecte seu
// banco" para quem não pode conectar é justamente o tipo de vazamento que a
// regra de `lib/ofAccess.ts` existe para impedir.
//
// O texto dos artigos de conexão vem de docs/openfinance/AJUDA-CONEXAO.md.

export interface FaqAssunto {
  id: string;
  rotulo: string;
  icone: string;
  /** true = só para quem tem Open Finance liberado. */
  openFinance?: boolean;
}

export interface FaqArtigo {
  assunto: string;
  pergunta: string;
  /** Parágrafos. O primeiro é a resposta curta; os demais explicam. */
  resposta: string[];
}

export const FAQ_ASSUNTOS: FaqAssunto[] = [
  { id: 'conexao', rotulo: 'Conectar o banco', icone: 'fa-building-columns', openFinance: true },
  { id: 'categorizar', rotulo: 'Categorizar gastos', icone: 'fa-tags', openFinance: true },
  { id: 'lancar', rotulo: 'Lançar gastos', icone: 'fa-plus' },
  { id: 'cartao', rotulo: 'Cartão e fatura', icone: 'fa-credit-card' },
  { id: 'plano', rotulo: 'Meu plano e diagnóstico', icone: 'fa-chart-pie' },
];

export const FAQ_ARTIGOS: FaqArtigo[] = [
  // ── Conectar o banco ──────────────────────────────────────────────────────
  {
    assunto: 'conexao',
    pergunta: 'Apareceu um código no final. O que eu faço com ele?',
    resposta: [
      'Nada. Pode fechar.',
      'No fim da autorização o banco mostra um "identificador do Open Finance" com um botão de copiar. Esse código é só uma confirmação de que deu certo — não é senha, e não precisa ser colado em lugar nenhum. O Kashim busca esse código sozinho.',
    ],
  },
  {
    assunto: 'conexao',
    pergunta: 'Ele mandou baixar o app do banco, mas eu já tenho instalado',
    resposta: [
      'É o problema mais comum, e quase sempre é o aparelho — não o banco.',
      'A página pede ao seu celular que abra o app do banco. Se o celular responder "não tenho esse app", mesmo tendo, ele faz a única coisa que sabe: manda para a loja. E o processo morre ali.',
      '1. Tente em outro celular. É o teste que mais resolve, e o mais rápido.',
      '2. Use o navegador de verdade. Se abriu pelo WhatsApp ou Instagram, foi num navegador interno que não chama o app do banco. Copie o link e cole no Chrome ou no Safari, abrindo pela tela inicial.',
      '3. No Android: Ajustes → Aplicativos → o app do seu banco → Abrir por padrão → ligue "Abrir links compatíveis".',
      '4. No iPhone: em vez de tocar no link, segure pressionado e escolha "Abrir no (banco)".',
      '5. Celular antigo pode simplesmente não fazer essa ponte. No nosso próprio teste foram 30 dias de investigação, e funcionou de primeira num aparelho novo.',
    ],
  },
  {
    assunto: 'conexao',
    pergunta: 'O banco pediu para escolher a instituição de novo. É normal?',
    resposta: [
      'É normal, pode escolher.',
      'Você informa o banco uma vez no Kashim e outra na tela do Open Finance. São etapas diferentes do mesmo processo — a segunda é o banco confirmando com quem vai compartilhar.',
      'Nessas telas o Kashim some e aparecem outros endereços e o nome Pluggy, que é a empresa que faz a ponte com os bancos. Também é normal. Continue até o fim.',
    ],
  },
  {
    assunto: 'conexao',
    pergunta: 'O banco quer compartilhar investimentos e crédito. Preciso disso?',
    resposta: [
      'O Kashim lê apenas o extrato da conta e o do cartão.',
      'O banco lista tudo que ele poderia compartilhar, e a lista é maior do que a gente usa. É o padrão dele, não um pedido nosso.',
      'A autorização é de leitura: o Kashim não movimenta dinheiro, não paga conta e não vê sua senha. E você pode cancelar quando quiser, pelo app do banco ou aqui mesmo.',
    ],
  },
  {
    assunto: 'conexao',
    pergunta: 'Meu banco não abre o app de jeito nenhum',
    resposta: [
      'Se o seu banco deixar autorizar pelo navegador, com a senha do internet banking, prefira esse caminho — é o que menos quebra.',
      'Nem todo banco oferece essa alternativa para pessoa física. Quando não houver, vale rodar a lista da pergunta sobre "mandou baixar o app".',
    ],
  },

  // ── Categorizar ───────────────────────────────────────────────────────────
  {
    assunto: 'categorizar',
    pergunta: 'Conectei, mas não apareceu nenhum lançamento',
    resposta: [
      'Conectar e receber os dados são duas etapas. Você concluiu a primeira.',
      'O banco tem até 24 horas para liberar seu histórico. Esse prazo é do Open Finance, não do Kashim — não há como acelerar.',
      'O Kashim busca os dados quatro vezes por dia. Se você conectou agora, o mais provável é que apareça na próxima busca ou, no pior caso, amanhã.',
      'Não fique apertando "sincronizar": cada pedido consome uma cota limitada, e gastá-la agora significa não poder buscar quando os dados estiverem prontos.',
    ],
  },
  {
    assunto: 'categorizar',
    pergunta: 'O Kashim colocou a categoria errada',
    resposta: [
      'Toque na etiqueta da transação e escolha a certa.',
      'O Kashim chuta a categoria a partir do nome do estabelecimento. Quando você corrige, ele guarda a sua escolha e passa a acertar aquele estabelecimento sozinho.',
    ],
  },
  {
    assunto: 'categorizar',
    pergunta: 'Preciso categorizar tudo?',
    resposta: [
      'A fatura e o saldo fecham mesmo sem categorizar. O que muda é o diagnóstico.',
      'Sem categoria, o Kashim sabe que o dinheiro saiu, mas não sabe se foi mercado, lazer ou conta fixa — e é essa divisão que diz se seus pilares estão em dia.',
      'Categorizar é o que transforma extrato em plano.',
    ],
  },

  // ── Lançar ────────────────────────────────────────────────────────────────
  {
    assunto: 'lancar',
    pergunta: 'Qual a diferença entre conta fixa, variável e lazer?',
    resposta: [
      'Conta fixa é o que se repete todo mês sem fim previsto: aluguel, condomínio, internet, escola. Parcelamento em mais de 12 vezes também entra aqui.',
      'Conta variável é imprevisto: conserto, farmácia, um boleto que aparece num mês e some no outro. Parcelamento curto também.',
      'Lazer e gastos pessoais é estilo de vida: restaurante, roupa, presente, hobby.',
      'Escolher certo importa porque o diagnóstico compara cada grupo com o ideal — e um gasto no grupo errado acusa o pilar errado.',
    ],
  },
  {
    assunto: 'lancar',
    pergunta: 'Esqueci de lançar um gasto de dias atrás',
    resposta: [
      'Dá para lançar retroativo: no lançador, mude a "Data da compra" para o dia certo.',
      'O gasto entra no mês correspondente àquela data, não no mês em que você lançou.',
    ],
  },

  // ── Cartão ────────────────────────────────────────────────────────────────
  {
    assunto: 'cartao',
    pergunta: 'Para que servem os campos "Fecha" e "Vence"?',
    resposta: [
      '"Fecha" é o dia em que a fatura fecha: compras depois desse dia caem na fatura do mês seguinte. "Vence" é o dia de pagar.',
      'Com o fechamento preenchido, o Kashim sabe em qual mês cada compra — à vista ou parcelada — vai cair de verdade.',
    ],
  },
  {
    assunto: 'cartao',
    pergunta: 'Por que aparece uma linha azul subtraindo valor?',
    resposta: [
      'Porque o mesmo dinheiro está em dois lugares da tela e só pode somar uma vez.',
      'Uma conta que você paga no cartão aparece cheia na linha da categoria dela — é o que sustenta o diagnóstico — e também dentro da fatura, porque é lá que o dinheiro vai sair da sua conta.',
      'A linha azul desconta essa parte para o total fechar certo. Ela soma conta fixa, variáveis e lazer: tudo que você paga no cartão.',
    ],
  },
  {
    assunto: 'cartao',
    pergunta: 'A fatura do app não bate com a do banco',
    resposta: [
      'Confira primeiro o dia de fechamento do cartão no Kashim.',
      'Se o fechamento estiver errado, compras caem no mês errado e a diferença aparece exatamente aí.',
      'Vale lembrar também que a fatura do app projeta o que você planejou gastar no cartão, então ela mostra como a fatura vai terminar o mês — não como ela está hoje.',
    ],
  },

  // ── Plano ─────────────────────────────────────────────────────────────────
  {
    assunto: 'plano',
    pergunta: 'O diagnóstico diz que estou no vermelho, mas meus pilares estão em dia',
    resposta: [
      'Quando conta fixa, educação e lazer estão dentro do ideal e ainda falta dinheiro, o vazamento está fora dos pilares.',
      'Os suspeitos são contas variáveis, fatura de cartão maior do que o previsto, e gasto que você ainda não anotou.',
      'Bater o limite de um pilar não é erro — o limite existe para ser usado. O problema é o que não está sendo contado.',
    ],
  },
  {
    assunto: 'plano',
    pergunta: 'O que é o Acumulado?',
    resposta: [
      'É quanto dinheiro você terá guardado se seguir o plano até o fim dos 12 meses.',
      'Cada mês soma a sobra (ou desconta a falta) do mês anterior. É a bússola: ver esse número crescer é o que mantém a disciplina.',
    ],
  },
];

/** Artigos do assunto, respeitando o portão do Open Finance. */
export function artigosDoAssunto(assunto: string): FaqArtigo[] {
  return FAQ_ARTIGOS.filter((a) => a.assunto === assunto);
}

export function assuntosVisiveis(temOpenFinance: boolean): FaqAssunto[] {
  return FAQ_ASSUNTOS.filter((a) => !a.openFinance || temOpenFinance);
}
