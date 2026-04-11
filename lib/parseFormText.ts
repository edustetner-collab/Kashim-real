
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
  'não',
  '0',
  '-',
];

export interface ParsedField {
  description: string;
  value: number;
  isIncome: boolean;
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

  for (const line of lines) {
    // Remove marcadores (* , - , •)
    const clean = line.replace(/^[\*\-•]\s*/, '').trim();

    // Encontra o separador :
    const colonIdx = clean.indexOf(':');
    if (colonIdx === -1) continue;

    const rawKey = clean.substring(0, colonIdx).trim().toLowerCase();
    const rawValue = clean.substring(colonIdx + 1).trim();

    // Verifica se é "não tenho esse gasto"
    const isNotApplicable = NOT_APPLICABLE_PATTERNS.some(p =>
      rawValue.toLowerCase().includes(p)
    );
    if (isNotApplicable) continue;

    // Busca o nome mapeado
    const mappedName = FIELD_MAP[rawKey];
    if (!mappedName) continue;

    const value = parseBRNumber(rawValue);
    if (isNaN(value) || value === 0) continue;

    const isIncome = rawKey === 'renda' || rawKey === 'salário' || rawKey === 'salario';

    results.push({ description: mappedName, value, isIncome });
  }

  return results;
}
