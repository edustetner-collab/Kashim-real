
// Mapeamento do formulário para os nomes do sistema
const FIELD_MAP: Record<string, string> = {
  'renda': 'Renda',
  'salário': 'Renda',
  'salario': 'Renda',
  'telefone fixo': 'Telefone fixo',
  'internet': 'Internet',
  'celular': 'Celular',
  'compras de mercado': 'Compras de mercado',
  'compras mercado': 'Compras de mercado',
  'gás de cozinha': 'Gás de cozinha',
  'gas de cozinha': 'Gás de cozinha',
  'gás': 'Gás de cozinha',
  'conta de luz': 'Conta de luz',
  'luz': 'Conta de luz',
  'conta de água': 'Conta de água',
  'agua': 'Conta de água',
  'água': 'Conta de água',
  'plano de saúde': 'Plano de saúde',
  'convenio': 'Plano de saúde',
  'convênio': 'Plano de saúde',
  'transporte': 'Transporte',
  'gasolina': 'Transporte',
  'uber': 'Transporte',
  'iptu': 'IPTU',
  'escola ou faculdade': 'Educação',
  'escola': 'Educação',
  'faculdade': 'Educação',
  'educação': 'Educação',
  'educacao': 'Educação',
  'diarista ou empregada': 'Diarista',
  'diarista': 'Diarista',
  'empregada': 'Diarista',
  'ração do pet': 'Ração do pet',
  'racao do pet': 'Ração do pet',
  'comida pet': 'Ração do pet',
  'banho e tosa': 'Banho e tosa',
  'banho pet': 'Banho e tosa',
  'academia': 'Academia',
  'personal trainer': 'Personal trainer',
  'personal': 'Personal trainer',
  'streaming e apps': 'Streaming e apps',
  'streaming': 'Streaming e apps',
  'netflix': 'Streaming e apps',
  'spotify': 'Streaming e apps',
  'terapia ou psicólogo': 'Terapia',
  'terapia': 'Terapia',
  'psicólogo': 'Terapia',
  'psicologo': 'Terapia',
  'previdência privada': 'Previdência privada',
  'previdencia privada': 'Previdência privada',
  'previdência': 'Previdência privada',
  'seguro do carro': 'Seguro do carro/moto',
  'seguro carro': 'Seguro do carro/moto',
  'parcela do carro': 'Parcela do carro/moto',
  'parcela do carro/moto': 'Parcela do carro/moto',
  'parcela de empréstimo': 'Parcela de empréstimo',
  'parcela de emprestimo': 'Parcela de empréstimo',
  'emprestimo': 'Parcela de empréstimo',
  'empréstimo': 'Parcela de empréstimo',
  'aluguel': 'Moradia',
  'moradia': 'Moradia',
  'condominio': 'Condomínio',
  'condomínio': 'Condomínio',
};

const NOT_APPLICABLE_PATTERNS = [
  'não tenho esse gasto',
  'nao tenho esse gasto',
  'não tenho',
  'nao tenho',
  'não se aplica',
  'nao se aplica',
  'n/a',
];

export type ParsedCategory = 'income' | 'fixed' | 'credit' | 'variable';

export interface ParsedField {
  description: string;
  value: number;               // valor mensal (fixa/renda) — 1º mês em cartão/variável
  isIncome: boolean;
  category?: ParsedCategory;   // ausente = fixa/renda (decidido pelo isIncome)
  monthlyValues?: number[];    // cartão/variável: um valor por mês, a partir do INÍCIO do plano
}

// Cabeçalho de seção colado do Excel muda como as linhas seguintes são lidas.
function sectionOf(lineLower: string): ParsedCategory | null {
  if (/cart[õo]es?\s+de\s+cr[eé]dito/.test(lineLower)) return 'credit';
  if (/(contas?|gastos?)\s+vari[aá]ve/.test(lineLower)) return 'variable';
  if (/contas?\s+fixas?/.test(lineLower)) return 'fixed';
  return null;
}

// Linha tabular "Nome  R$ x  R$ y ..." → nome + valores por mês (Excel usa TAB).
function parseTabularRow(line: string): { name: string; values: number[] } | null {
  const cells = line.split('\t').map(c => c.trim()).filter(Boolean);
  if (cells.length >= 2) {
    const values = cells.slice(1).map(parseBRNumber).filter(v => !isNaN(v) && v > 0);
    if (values.length > 0) return { name: cells[0], values };
  }
  // Sem tabs (colado com espaços): acha os R$ e separa o nome do resto.
  const money = line.match(/R\$\s*[\d.]+(?:,\d+)?/gi);
  if (money && money.length > 0) {
    const firstIdx = line.search(/R\$/i);
    const name = line.slice(0, firstIdx >= 0 ? firstIdx : 0).replace(/\t/g, ' ').trim();
    const values = money.map(parseBRNumber).filter(v => !isNaN(v) && v > 0);
    if (name && values.length > 0) return { name, values };
  }
  return null;
}

// Converte string de valor BR para número
function parseBRNumber(raw: string): number {
  let s = raw.trim();
  // Remove R$, espaços
  s = s.replace(/R\$\s*/gi, '').trim();

  // Se tem ponto E vírgula: formato padrão BR (1.234,56)
  if (s.includes('.') && s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
    return parseFloat(s);
  }

  // Só ponto: checa se é decimal (1.5) ou milhar (1.500)
  if (s.includes('.') && !s.includes(',')) {
    const afterDot = s.split('.')[1];
    if (afterDot && afterDot.length === 3) {
      // Milhar: 1.500 → 1500
      s = s.replace('.', '');
    }
    // Senão: decimal padrão
    return parseFloat(s);
  }

  // Só vírgula: checa se é decimal (1,50) ou milhar (1,500)
  if (s.includes(',') && !s.includes('.')) {
    const afterComma = s.split(',')[1];
    if (afterComma && afterComma.length === 3) {
      // Milhar: 1,933 → 1933
      s = s.replace(',', '');
    } else {
      // Decimal: 93,40 → 93.40
      s = s.replace(',', '.');
    }
    return parseFloat(s);
  }

  return parseFloat(s) || 0;
}

export function parseFormText(text: string): ParsedField[] {
  const results: ParsedField[] = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Seção atual. null = questionário de conta fixa/renda (formato "label: valor",
  // comportamento original). Um cabeçalho "CARTÕES DE CRÉDITO" ou "CONTAS
  // VARIÁVEIS" liga o modo tabular multi-mês para as linhas seguintes.
  let section: ParsedCategory | null = null;

  for (const line of lines) {
    const clean = line.replace(/^[\*\-•]\s*/, '').trim();

    // Troca de seção?
    const sec = sectionOf(clean.toLowerCase());
    if (sec) { section = sec; continue; }

    // Modo tabular (cartão/variável): "Nome  R$ x  R$ y ..."
    if (section === 'credit' || section === 'variable') {
      if (/^(sub\s*)?total/i.test(clean)) continue; // ignora linhas de SUBTOTAL/TOTAL
      const row = parseTabularRow(clean);
      if (!row) continue; // linha de cabeçalho de meses (sem valores) etc.
      results.push({
        description: row.name,
        value: row.values[0],
        isIncome: false,
        category: section,
        monthlyValues: row.values,
      });
      continue;
    }

    // Modo conta fixa/renda (original): separador ":"
    const colonIdx = clean.indexOf(':');
    if (colonIdx === -1) continue;

    const rawKey = clean.substring(0, colonIdx).trim().toLowerCase();
    const rawValue = clean.substring(colonIdx + 1).trim();

    // Verifica se é "não tenho esse gasto"
    const isNotApplicable = NOT_APPLICABLE_PATTERNS.some(p =>
      rawValue.toLowerCase().includes(p)
    );
    if (isNotApplicable) continue;

    const value = parseBRNumber(rawValue);
    if (isNaN(value) || value === 0) continue;

    // Usa o nome mapeado se existir, senão usa o nome original capitalizado
    const mappedName = FIELD_MAP[rawKey] ?? clean.substring(0, colonIdx).trim();

    const isIncome = rawKey === 'renda' || rawKey === 'salário' || rawKey === 'salario';

    results.push({ description: mappedName, value, isIncome });
  }

  return results;
}
