
export const MONTHS_BR = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

export const IDEAL_LIMITS = {
  FIXED: 0.55,    // 55%
  EDUCATION: 0.10, // 10% (Included in fixed/variable usually)
  SAVINGS: 0.20,  // 20%
  LEISURE: 0.15   // 15%
};

export const getNext12Months = (startMonthIndex?: number) => {
  const result = [];
  const now = new Date();
  const currentMonth = startMonthIndex !== undefined ? startMonthIndex : now.getMonth();
  const currentYear = now.getFullYear();

  for (let i = 0; i < 12; i++) {
    const d = new Date(currentYear, currentMonth + i, 1);
    result.push({
      monthName: MONTHS_BR[d.getMonth()],
      year: d.getFullYear(),
      index: d.getMonth()
    });
  }
  return result;
};

export const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
};
