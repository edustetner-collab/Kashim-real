export interface Quote {
  numero: number;
  categoria: 'conforto' | 'exortacao' | 'instrucao';
  frase: string;
}

export const QUOTES: Quote[] = [
  { numero: 1, categoria: 'conforto', frase: 'Respira. Organizar a vida financeira não é correr atrás do prejuízo de uma vez — é dar um passo de cada vez, semana após semana. O que importa não é onde você está hoje, mas a direção que você decidiu seguir.' },
  { numero: 2, categoria: 'conforto', frase: 'Você não está atrasado. Não existe idade certa para começar a cuidar do seu dinheiro: existe o hoje. Quem planta agora colhe depois — e depois sempre chega.' },
  { numero: 3, categoria: 'conforto', frase: 'Dinheiro guardado não é luxo, é sono tranquilo. Uma reserva, por menor que seja, transforma um imprevisto em "já resolvo" no lugar de "e agora?".' },
  { numero: 4, categoria: 'conforto', frase: 'Não compare o seu capítulo 1 com o capítulo 20 de outra pessoa. Cada jornada financeira tem o seu ritmo — e o seu ritmo é suficiente, desde que você não pare.' },
  { numero: 5, categoria: 'conforto', frase: 'Ter pouco para começar não é vergonha. Toda fortuna sólida já foi, um dia, a primeira moedinha guardada por alguém que acreditou no futuro.' },
  { numero: 6, categoria: 'conforto', frase: 'Se o mês apertou, não significa que você fracassou. Significa que você é humano. Recomeçar é uma habilidade financeira — talvez a mais importante de todas.' },
  { numero: 7, categoria: 'conforto', frase: 'Paz financeira não é ter muito dinheiro. É saber que, aconteça o que acontecer, você tem um plano e um fôlego. E isso está ao seu alcance.' },
  { numero: 8, categoria: 'conforto', frase: 'Errar com dinheiro faz parte de aprender com dinheiro. Cada decisão ruim que você entende vira uma decisão melhor amanhã.' },
  { numero: 9, categoria: 'conforto', frase: 'O medo de olhar o extrato costuma ser maior que o extrato. Encare os números: quase nunca são tão assustadores quanto a imaginação pinta.' },
  { numero: 10, categoria: 'conforto', frase: 'Sua reserva de emergência é o abraço que o seu "eu do futuro" vai te dar num dia difícil. Comece a construí-la hoje, mesmo que devagar.' },
  { numero: 11, categoria: 'conforto', frase: 'Não se cobre por não saber tudo sobre finanças. Ninguém nasce sabendo. O que você precisa é da coragem de aprender um pouco a cada semana.' },
  { numero: 12, categoria: 'conforto', frase: 'Dinheiro não resolve tudo, mas resolve problema de dinheiro — e só isso já libera a sua cabeça para o que realmente importa.' },
  { numero: 13, categoria: 'conforto', frase: 'Calma. Construir patrimônio é maratona, não tiro de 100 metros. A pressa é amiga do erro; a constância é amiga da liberdade.' },
  { numero: 14, categoria: 'conforto', frase: 'Você é maior que as suas dívidas. Elas são um número; você é uma pessoa com a capacidade de mudar esse número, mês após mês.' },
  { numero: 15, categoria: 'conforto', frase: 'Cada real que você guarda é um voto de confiança no seu futuro. E quem aposta em si mesmo dificilmente sai perdendo no longo prazo.' },
  { numero: 16, categoria: 'conforto', frase: 'Não precisa ser perfeito com o dinheiro. Precisa ser consistente. Pequenos acertos repetidos vencem grandes acertos esporádicos.' },
  { numero: 17, categoria: 'conforto', frase: 'Se hoje você só conseguiu guardar o troco, guardou. Quem guarda o troco hoje aprende a guardar o salário amanhã.' },
  { numero: 18, categoria: 'conforto', frase: 'Você não precisa ganhar mais para viver melhor agora. Às vezes basta enxergar com clareza para onde o seu dinheiro está indo.' },
  { numero: 19, categoria: 'exortacao', frase: 'O melhor dia para começar a investir foi há dez anos. O segundo melhor dia é hoje. Não deixe o amanhã carregar o peso da sua procrastinação.' },
  { numero: 20, categoria: 'exortacao', frase: 'Ninguém vai cuidar do seu dinheiro com mais carinho do que você. Assuma o volante da sua vida financeira — o banco do passageiro não leva ninguém à liberdade.' },
  { numero: 21, categoria: 'exortacao', frase: 'Disciplina é escolher entre o que você quer agora e o que você quer mais. Decida hoje o que o seu "eu do futuro" vai agradecer.' },
  { numero: 22, categoria: 'exortacao', frase: 'Não espere sobrar para guardar. Guarde primeiro e viva com o resto. Quem espera sobrar quase nunca vê sobra.' },
  { numero: 23, categoria: 'exortacao', frase: 'O maior risco não é investir e perder um pouco. É nunca começar e perder tudo o que o tempo poderia ter multiplicado por você.' },
  { numero: 24, categoria: 'exortacao', frase: 'Pare de financiar o estilo de vida dos outros com a sua ansiedade. Compre o que cabe na sua realidade, não o que cabe no limite do cartão.' },
  { numero: 25, categoria: 'exortacao', frase: 'Conhecimento é o único investimento que ninguém tira de você. Antes de buscar o melhor ativo, invista nas melhores ideias.' },
  { numero: 26, categoria: 'exortacao', frase: 'Você não precisa de sorte. Precisa de método e de repetição. Faça o simples, faça sempre, e o tempo faz o resto.' },
  { numero: 27, categoria: 'exortacao', frase: 'Dívida cara é incêndio: quanto mais cedo você apaga, menos ela consome. Ataque primeiro a que cobra os juros mais altos.' },
  { numero: 28, categoria: 'exortacao', frase: 'Coragem não é gastar sem pensar. Coragem é dizer "não" hoje para poder dizer "sim" a coisas maiores amanhã.' },
  { numero: 29, categoria: 'exortacao', frase: 'Se você acha que educação financeira é cara, experimente a conta da falta dela. Aprender custa tempo; ignorar custa o futuro.' },
  { numero: 30, categoria: 'exortacao', frase: 'Não terceirize a sua liberdade. Entenda para onde vai cada real seu — o controle que você não exerce, alguém exerce por você.' },
  { numero: 31, categoria: 'exortacao', frase: 'Comece pequeno, mas comece. Cem reais investidos hoje valem mais que mil reais que você jura que vai investir "mês que vem".' },
  { numero: 32, categoria: 'exortacao', frase: 'O seu salário define o quanto você ganha. Os seus hábitos definem o quanto você fica. Cuide dos dois, mas não esqueça do segundo.' },
  { numero: 33, categoria: 'exortacao', frase: 'Pare de esperar o momento perfeito. O momento perfeito é uma desculpa bem vestida. O momento bom o suficiente é agora.' },
  { numero: 34, categoria: 'exortacao', frase: 'Faça o seu dinheiro trabalhar enquanto você dorme — senão você vai trabalhar a vida inteira para conseguir dinheiro.' },
  { numero: 35, categoria: 'exortacao', frase: 'Sua liberdade financeira não vai cair do céu. Ela se constrói tijolo por tijolo, escolha por escolha, segunda-feira por segunda-feira.' },
  { numero: 36, categoria: 'instrucao', frase: 'A regra mais antiga e mais poderosa das finanças: gaste menos do que você ganha. Toda construção de riqueza começa nessa única frase.' },
  { numero: 37, categoria: 'instrucao', frase: 'Antes de investir, monte sua reserva de emergência: de 3 a 6 meses do seu custo de vida, guardados em algo seguro e de fácil resgate.' },
  { numero: 38, categoria: 'instrucao', frase: 'Juros compostos são juros sobre juros — o efeito bola de neve do dinheiro. Quanto mais cedo você começa, mais o tempo trabalha a seu favor.' },
  { numero: 39, categoria: 'instrucao', frase: 'Pague-se primeiro. Assim que o dinheiro entra, separe uma parte para você (poupar e investir) antes de pagar qualquer outra coisa.' },
  { numero: 40, categoria: 'instrucao', frase: 'Separe desejo de necessidade. A necessidade você atende; o desejo você planeja. Confundir os dois é a origem de boa parte das dívidas.' },
  { numero: 41, categoria: 'instrucao', frase: 'Automatize o que puder: uma transferência automática para a reserva no dia do salário. Disciplina que depende de força de vontade toda hora costuma falhar.' },
  { numero: 42, categoria: 'instrucao', frase: 'Olhe seus gastos pelo menos uma vez por semana. O que não é medido não é controlado — e o que não é controlado controla você.' },
  { numero: 43, categoria: 'instrucao', frase: 'Antes de assumir uma parcela, pergunte: e se a renda cair? Compromissos longos com renda incerta são a receita do sufoco.' },
  { numero: 44, categoria: 'instrucao', frase: 'Não invista no que você não entende. Se não consegue explicar onde está o seu dinheiro em uma frase simples, estude antes de aplicar.' },
  { numero: 45, categoria: 'instrucao', frase: 'Diversifique. Não coloque todos os ovos na mesma cesta: distribua entre diferentes ativos para que um tropeço não derrube tudo.' },
  { numero: 46, categoria: 'instrucao', frase: 'Cartão de crédito é ferramenta, não extensão do salário. Gaste só o que consegue pagar na fatura — o resto vira armadilha de juros.' },
  { numero: 47, categoria: 'instrucao', frase: 'Defina objetivos com prazo e valor. "Quero juntar dinheiro" não funciona; "quero R$ 6.000 em 12 meses" vira um plano de R$ 500 por mês.' },
  { numero: 48, categoria: 'instrucao', frase: 'Renegocie as dívidas caras antes de qualquer coisa. Cada ponto de juros que você reduz hoje é dinheiro que volta para o seu bolso amanhã.' },
  { numero: 49, categoria: 'instrucao', frase: 'Invista em conhecimento antes de investir em ativos. A melhor proteção contra perder dinheiro é entender o que você está fazendo.' },
  { numero: 50, categoria: 'instrucao', frase: 'Tenha um orçamento simples: o que entra, o que sai e o que sobra. Não precisa de planilha complexa — precisa de constância em preenchê-la.' },
  { numero: 51, categoria: 'instrucao', frase: 'Aumento de salário não é licença para subir o padrão na mesma proporção. Faça parte do aumento virar investimento, não só conforto.' },
  { numero: 52, categoria: 'instrucao', frase: 'Não existe "o melhor investimento do mundo". Existe o melhor para o seu objetivo e o seu prazo. Comece pelo que faz sentido para você, agora.' },
  { numero: 53, categoria: 'instrucao', frase: 'Revise suas finanças todo mês, como quem confere o GPS numa viagem. Pequenos ajustes de rota evitam grandes desvios no destino.' },
];

// Frase determinística para o household numa data específica. Usada tanto para
// a frase da semana atual quanto para pré-agendar as notificações das próximas
// semanas (o mesmo cálculo tem que rodar no app e no agendamento local).
export function getQuoteForDate(householdId: string, when: Date): Quote {
  // ISO week number da data informada
  const d = new Date(when);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const year = d.getFullYear();

  // Offset estável por usuário: usuários diferentes recebem frases diferentes na mesma semana
  const userOffset = [...householdId].reduce((acc, c) => acc + c.charCodeAt(0), 0) % QUOTES.length;
  const absoluteWeek = year * 53 + weekNum;
  const quoteIndex = (absoluteWeek + userOffset) % QUOTES.length;
  return QUOTES[quoteIndex];
}

export function getQuoteForUser(householdId: string): Quote {
  return getQuoteForDate(householdId, new Date());
}

export function getMondayKey(): string {
  const now = new Date();
  const diff = (now.getDay() === 0 ? -6 : 1 - now.getDay());
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toISOString().split('T')[0];
}
