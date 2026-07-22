
const EDUCATION_KEYWORDS = [
  'educação', 'educacao',
  'escola',
  'faculdade',
  'curso',
  'creche',
  'colégio', 'colegio',
  'colegial',
  'ensino',
  'universidade',
  'graduação', 'graduacao',
  'mestrado',
  'doutorado',
  'inglês', 'ingles',
  'idioma',
  'mentoria',
  'aula',
  'treinamento',
  'capacitação', 'capacitacao',
  'certificação', 'certificacao',
];

export function isEducationItem(description: string): boolean {
  const lower = description.toLowerCase().trim();
  return EDUCATION_KEYWORDS.some(kw => lower.includes(kw));
}
