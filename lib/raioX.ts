// Gerador do Raio-X Financeiro (PDF da consultoria).
// Trabalha sobre um SNAPSHOT autocontido — tanto o estado atual da tela
// quanto um registro histórico de consultation_records renderizam idêntico.

export interface RaioXSummary {
  totalIncome: number;
  totalCreditCard: number;
  totalFixed: number;
  totalVariable: number;
  totalLeisure: number;
  totalCost: number;
  balance: number;
  accumulated: number;
}

export interface RaioXItem {
  description: string;
  category: string;
  values: number[];
}

export interface RaioXSnapshot {
  clientName: string;
  months: { monthName: string; year: number }[];
  items: RaioXItem[];
  summaries: RaioXSummary[];
}

// Valores devem bater com o enum CategoryType (types.ts)
const SECTIONS: Array<{ category: string; title: string; color: string }> = [
  { category: 'Renda',                   title: 'Entradas (Rendas)',        color: '#22c55e' },
  { category: 'Cartão de Crédito',       title: 'Faturas de Cartão',        color: '#f97316' },
  { category: 'Contas Fixas',            title: 'Contas Fixas',             color: '#ef4444' },
  { category: 'Contas Variáveis',        title: 'Contas Variáveis',         color: '#06b6d4' },
  { category: 'Lazer e Gastos Pessoais', title: 'Lazer e Gastos Pessoais',  color: '#a855f7' },
];

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

export function buildRaioXHtml(snap: RaioXSnapshot, emittedLabel: string, footerNote?: string): string {
  const { clientName, months, items, summaries } = snap;

  const monthHeaders = months
    .map(m => `<th>${m.monthName}<span class="year">${m.year}</span></th>`)
    .join('');

  const renderSection = (category: string, title: string, color: string) => {
    const catItems = items.filter(i => i.category === category);
    if (catItems.length === 0) return '';
    const rows = catItems.map(item => {
      const cells = months.map((_, idx) => {
        const v = item.values[idx] || 0;
        return `<td class="val">${v > 0 ? fmt(v) : ''}</td>`;
      }).join('');
      return `<tr><td class="desc">${item.description || '—'}</td>${cells}</tr>`;
    }).join('');
    const totals = months.map((_, idx) =>
      `<td class="total-val">${fmt(catItems.reduce((s, i) => s + (i.values[idx] || 0), 0))}</td>`
    ).join('');
    return `<div class="section">
      <h2 style="border-left:4px solid ${color}">${title}</h2>
      <table>
        <thead><tr><th class="desc-th">Descrição</th>${monthHeaders}</tr></thead>
        <tbody>${rows}<tr class="total-row"><td>TOTAL</td>${totals}</tr></tbody>
      </table></div>`;
  };

  const summaryRows = [
    { label: 'Total de Entradas',      vals: summaries.map(s => s.totalIncome),     cls: 'income' },
    { label: 'Faturas de Cartão',      vals: summaries.map(s => s.totalCreditCard), cls: 'credit' },
    { label: 'Custos Fixos',           vals: summaries.map(s => s.totalFixed),      cls: 'fixed' },
    { label: 'Custos Variáveis',       vals: summaries.map(s => s.totalVariable),   cls: 'variable' },
    { label: 'Gastos Pessoais e Lazer', vals: summaries.map(s => s.totalLeisure),   cls: 'leisure' },
    { label: 'Total de Custos',        vals: summaries.map(s => s.totalCost),       cls: 'costtotal' },
    { label: 'Saldo Mensal',           vals: summaries.map(s => s.balance),         cls: 'balance' },
    { label: 'Acumulado',              vals: summaries.map(s => s.accumulated),     cls: 'accumulated' },
  ].map(row =>
    `<tr class="sr-${row.cls}"><td>${row.label}</td>${row.vals.map(v =>
      `<td class="val${v < 0 ? ' neg' : ''}">${fmt(v)}</td>`).join('')}</tr>`
  ).join('');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Raio-X — ${clientName}</title><style>
@page{size:A4 landscape;margin:0.8cm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:7.5px;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
header{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #a8e716}
header h1{font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:-.5px}
header p{font-size:7px;color:#666}
.section{margin-bottom:12px}
.section h2{font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:1px;padding:3px 6px;margin-bottom:4px;background:#f5f5f5}
table{width:100%;border-collapse:collapse}
th,td{border:1px solid #ddd;padding:2.5px 4px;text-align:right;white-space:nowrap}
th{background:#f0f0f0;font-size:6.5px;font-weight:700}
.desc-th{text-align:left;min-width:110px}
.desc{text-align:left;max-width:140px;overflow:hidden;text-overflow:ellipsis}
.val{font-family:monospace}
.year{display:block;font-size:6px;color:#999;font-weight:400}
.total-row td{background:#e8e8e8;font-weight:800;border-top:2px solid #bbb}
.total-val{font-family:monospace;font-weight:800}
.sr-income td{color:#15803d;font-weight:700}
.sr-costtotal td{background:#f0f0f0;font-weight:800;border-top:2px solid #bbb}
.sr-balance td{background:#fff7f0}
.sr-accumulated td{background:#111;color:#a8e716;font-weight:900}
.neg{color:#dc2626!important}
.summary-section h2{background:#111;color:#a8e716}
footer{margin-top:8px;font-size:6px;color:#888}
</style></head><body>
<header>
  <div><h1>Raio-X Financeiro — ${clientName}</h1>
  <p>Período: ${months[0].monthName} ${months[0].year} → ${months[11].monthName} ${months[11].year}</p></div>
  <p>Emitido em ${emittedLabel} | Kashim</p>
</header>
${SECTIONS.map(s => renderSection(s.category, s.title, s.color)).join('')}
<div class="section summary-section">
  <h2>Compilação Financeira</h2>
  <table><thead><tr><th class="desc-th">Resumo</th>${monthHeaders}</tr></thead>
  <tbody>${summaryRows}</tbody></table>
</div>
${footerNote ? `<footer>${footerNote}</footer>` : ''}
</body></html>`;
}

export function openRaioXWindow(html: string): void {
  const win = window.open('', '_blank', 'width=1200,height=800');
  if (!win) { alert('Permita pop-ups para gerar o PDF.'); return; }
  win.document.write(html);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 400);
}
