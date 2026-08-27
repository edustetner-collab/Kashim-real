import React from 'react';
import { SummaryData, FinanceItem } from '../types';
import { IDEAL_LIMITS, formatCurrency } from '../constants';
import { getPlanTotals } from '../lib/planTotals';

interface DiagnosisProps { summary: SummaryData; items: FinanceItem[]; monthIdx: number; monthName: string; isCurrentMonth?: boolean; }

/**
 * Diagnóstico — o coração da consultoria. O cliente bate o olho e VÊ onde está o
 * problema: o relógio grande do % de conta fixa (o número que destrava tudo), o
 * veredito, a ação do mês, e "onde vai o seu salário" comparando REAL vs IDEAL.
 *
 * Metodologia Kashim (Eduardo): 55% conta fixa · 10% educação · 15% lazer/pessoal
 * · 20% para juntar (= 100%). Variáveis NÃO entra nos pilares (só consome a
 * sobra). "Para juntar" = a sobra do mês, comparada aos 20% ideais.
 *
 * Totais BRUTOS (getPlanTotals): a conta fixa aparece cheia, independente da
 * forma de pagamento.
 */

type TierKey = 'bom' | 'limite' | 'alto' | 'critico';
interface Tier {
  key: TierKey; label: string; badge: string; color: string; glow: string;
  headline: string; msg: string; acao: string;
}

function contaFixaTier(pct: number): Tier {
  if (pct <= IDEAL_LIMITS.FIXED) return {
    key: 'bom', label: 'Saudável', badge: 'No controle',
    color: '#34d77a', glow: 'rgba(52,215,122,.25)',
    headline: 'Sua base está no controle.',
    msg: 'Suas contas fixas cabem no salário com folga. É daqui que a vida financeira destrava e sobra dinheiro para crescer.',
    acao: 'Mantenha o ritmo e direcione a folga para as suas metas.',
  };
  if (pct <= 0.65) return {
    key: 'limite', label: 'No limite', badge: 'No limite',
    color: '#f0b64a', glow: 'rgba(240,182,74,.25)',
    headline: 'Você está no limite do aceitável.',
    msg: 'As contas fixas ocupam boa parte da renda. Dá para viver, mas sobra pouco para imprevisto — qualquer susto aperta.',
    acao: 'Segure novas contas fixas e ataque as que dá para reduzir.',
  };
  if (pct < 0.90) return {
    key: 'alto', label: 'Alta', badge: 'Atenção',
    color: '#fb923c', glow: 'rgba(251,146,60,.25)',
    headline: 'Suas contas fixas estão altas.',
    msg: 'Grande parte do salário já está comprometida antes de você gastar qualquer coisa. Essa base pesa e trava o resto.',
    acao: 'O primeiro passo é reduzir conta fixa: renegocie ou corte o que não é essencial.',
  };
  return {
    key: 'critico', label: 'Crítica', badge: 'Risco crítico',
    color: '#f87171', glow: 'rgba(248,113,113,.28)',
    headline: 'Suas contas fixas estão sufocando sua renda.',
    msg: 'Só as contas fixas já consomem quase todo (ou mais que) o seu salário. Sem mexer nisso, a conta não fecha de jeito nenhum.',
    acao: 'Prioridade máxima: reduzir conta fixa agora. É o que trava tudo.',
  };
}

const asPct = (v: number) => `${(v * 100).toFixed(0)}%`;
const polar = (frac: number, radius: number) => {
  const ang = (135 + Math.min(1, Math.max(0, frac)) * 270) * Math.PI / 180;
  return { x: 100 + radius * Math.cos(ang), y: 100 + radius * Math.sin(ang) };
};

/** Relógio SVG de 270° com o preenchimento real + a MARCA do ideal (55%). */
const Gauge: React.FC<{ pct: number; color: string; glow: string }> = ({ pct, color, glow }) => {
  const r = 80, C = 2 * Math.PI * r, track = 0.75 * C;
  const fill = Math.min(1, Math.max(0, pct)) * track;
  const ti = polar(IDEAL_LIMITS.FIXED, r - 13);
  const to = polar(IDEAL_LIMITS.FIXED, r + 13);
  return (
    <svg viewBox="0 0 200 200" width="176" height="176" role="img" aria-label={`Conta fixa em ${asPct(pct)}, ideal ${asPct(IDEAL_LIMITS.FIXED)}`}>
      <g transform="rotate(135 100 100)">
        <circle cx="100" cy="100" r={r} fill="none" stroke="rgba(255,255,255,.09)" strokeWidth="15"
          strokeDasharray={`${track} ${C}`} strokeLinecap="round" />
        <circle cx="100" cy="100" r={r} fill="none" stroke={color} strokeWidth="15"
          strokeDasharray={`${fill} ${C}`} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 9px ${glow})`, transition: 'stroke-dasharray .6s cubic-bezier(.16,1,.3,1)' }} />
      </g>
      {/* Marca do ideal 55% */}
      <line x1={ti.x} y1={ti.y} x2={to.x} y2={to.y} stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity="0.9" />
      <text x="100" y="94" textAnchor="middle" fontFamily="Archivo, system-ui, sans-serif" fontWeight="900" fontSize="44" fontStyle="italic" fill="#f5f7f2">{asPct(pct)}</text>
      <text x="100" y="116" textAnchor="middle" fontFamily="Archivo, system-ui, sans-serif" fontWeight="800" fontSize="11" letterSpacing="2" fill="#9aa091">CONTA FIXA</text>
    </svg>
  );
};

type Dir = 'cost' | 'save';

/** Interpola dois hex (#rrggbb) por t∈[0,1]. */
function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const [pa, pb] = [p(a), p(b)];
  const c = pa.map((x, i) => Math.round(x + (pb[i] - x) * Math.min(1, Math.max(0, t))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/**
 * Comparação de pilar contra o ideal, na MESMA escala que o cliente vê.
 *
 * Regra do Eduardo (2026-08-24): bater o limite não é erro — quem fecha a conta
 * fixa em 56% com ideal de 55% cumpriu o que planejou. Só passar do limite é
 * problema. Por isso a comparação é feita nos pontos percentuais arredondados,
 * com 1 ponto de folga: 56% contra 55% é "no limite", 57% é que estoura.
 */
const pp = (v: number) => Math.round(v * 100);
const isOver = (real: number, ideal: number) => pp(real) > pp(ideal) + 1;
const atLimit = (real: number, ideal: number) => pp(real) > pp(ideal);

type StatusKey = 'ok' | 'warn' | 'over';

/** Paleta dos selos — tons Apple-like (fundo pastel, traço saturado). */
const BADGE: Record<StatusKey, { bg: string; border: string; ink: string }> = {
  ok:   { bg: '#f2fbdd', border: 'rgba(122,184,0,0.3)',  ink: '#5f9000' },
  warn: { bg: '#fff8e6', border: 'rgba(224,155,0,0.28)', ink: '#e09b00' },
  over: { bg: '#fff1f0', border: 'rgba(255,69,58,0.26)', ink: '#d92b1f' },
};

/** Selo circular 30px com ícone SVG traçado (check / alerta / xis). */
const StatusBadge: React.FC<{ status: StatusKey }> = ({ status }) => {
  const b = BADGE[status];
  return (
    <span className="w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0"
      style={{ background: b.bg, border: `1px solid ${b.border}`, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <svg viewBox="0 0 24 24" style={{ width: 15, height: 15, display: 'block' }}>
        {status === 'ok' && (
          <path d="M5.5 12.6 L10 17 L18.5 7.6" fill="none" stroke={b.ink} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {status === 'warn' && (
          <>
            <path d="M12 5.6 V13.4" fill="none" stroke={b.ink} strokeWidth="2.6" strokeLinecap="round" />
            <circle cx="12" cy="18.2" r="1.5" fill={b.ink} />
          </>
        )}
        {status === 'over' && (
          <path d="M6.6 6.6 L17.4 17.4 M17.4 6.6 L6.6 17.4" fill="none" stroke={b.ink} strokeWidth="2.6" strokeLinecap="round" />
        )}
      </svg>
    </span>
  );
};

interface PillarBarProps {
  name: string; value: number; realPct: number; idealPct: number;
  color: string; glow: string; dir: Dir;
}

const PillarBar: React.FC<PillarBarProps> = ({ name, value, realPct, idealPct, color, glow, dir }) => {
  // Só pilar de CUSTO fica "sem lançamentos". Em "Para juntar" um valor
  // negativo é informação real (o mês fechou no vermelho), não ausência de dado.
  const noData = dir === 'cost' && value <= 0;

  // 'save' (Para juntar) é a variável BOA: guardar qualquer coisa positiva já
  // conta. Nos pilares de custo, BATER o limite não é erro — só PASSAR dele é
  // (regra do Eduardo: quem fecha em 56% com ideal 55% cumpriu o plano).
  let status: StatusKey;
  if (dir === 'save') status = realPct <= 0 ? 'over' : realPct >= idealPct ? 'ok' : 'warn';
  else if (noData) status = 'warn';
  else status = isOver(realPct, idealPct) ? 'over' : atLimit(realPct, idealPct) ? 'warn' : 'ok';

  const barColor = noData ? '#d2d2d7'
    : dir === 'save' ? mixHex('#166534', '#84cc16', realPct / idealPct)
    : color;
  const barGlow = noData ? 'rgba(0,0,0,0)' : glow;
  const pctInk = noData ? '#c7c7cc' : status === 'over' ? '#d92b1f' : '#1d1d1f';
  const rowBg = noData ? '#fcfcfd' : status === 'over' ? '#fff6f5' : '#fafafb';
  const rowBorder = noData ? '#f0f0f3' : status === 'over' ? 'rgba(255,69,58,0.18)' : '#ececf0';

  const fillW = `${Math.min(100, Math.max(0, realPct * 100))}%`;
  const idealLeft = `${Math.min(100, Math.max(0, idealPct * 100))}%`;
  const valueLabel = noData ? 'sem lançamentos' : formatCurrency(value);
  const pctLabel = noData ? '—' : asPct(realPct);

  /** Trilho: preenchimento + marca vertical do ideal. */
  const rail = (
    <div className="relative h-[14px] rounded-full" style={{ background: '#ececf0', overflow: 'visible' }}>
      <div className="absolute left-0 top-0 bottom-0 rounded-full" style={{
        width: fillW, background: barColor,
        boxShadow: `0 1px 0 rgba(255,255,255,0.5) inset, 0 2px 8px ${barGlow}`,
        transition: 'width .6s cubic-bezier(.16,1,.3,1)',
      }} />
      <div className="absolute rounded-sm" style={{
        top: -5, bottom: -5, width: 2, left: idealLeft,
        transform: 'translateX(-50%)', background: 'rgba(29,29,31,0.42)',
      }} />
    </div>
  );

  const idealTag = (
    <span className="text-[9px] font-black uppercase whitespace-nowrap" style={{ letterSpacing: '.1em', color: '#aeaeb2' }}>
      ideal {asPct(idealPct)}
    </span>
  );

  const swatch = <span className="shrink-0" style={{ width: 10, height: 10, borderRadius: 3, background: color }} />;

  return (
    <div className="rounded-2xl" style={{ background: rowBg, border: `1px solid ${rowBorder}` }}>
      {/* ── DESKTOP: grid de 4 colunas, título com espaço de sobra ── */}
      <div className="hidden lg:grid items-center" style={{ gridTemplateColumns: '30px 158px 1fr 92px', gap: 16, padding: '13px 16px' }}>
        <StatusBadge status={status} />
        <div className="flex items-center gap-2.5 min-w-0">
          {swatch}
          <div className="flex flex-col gap-px min-w-0">
            <span className="text-[12px] font-extrabold uppercase whitespace-nowrap" style={{ letterSpacing: '.04em', color: '#1d1d1f' }}>{name}</span>
            <span className="text-[11px] font-semibold tabular-nums" style={{ color: '#8e8e93' }}>{valueLabel}</span>
          </div>
        </div>
        <div className="relative" style={{ paddingTop: 20 }}>
          <div className="absolute top-0" style={{ left: idealLeft, transform: 'translateX(-50%)' }}>{idealTag}</div>
          {rail}
        </div>
        <div className="flex justify-end">
          <span className="text-[20px] font-black tabular-nums" style={{ letterSpacing: '-.02em', color: pctInk }}>{pctLabel}</span>
        </div>
      </div>

      {/* ── CELULAR: título em linha própria (não trunca), barra abaixo ── */}
      <div className="lg:hidden flex flex-col gap-2.5" style={{ padding: '13px 14px' }}>
        <div className="flex items-center gap-2.5">
          <StatusBadge status={status} />
          {swatch}
          <span className="flex-1 min-w-0 text-[12px] font-extrabold uppercase leading-tight" style={{ letterSpacing: '.03em', color: '#1d1d1f' }}>{name}</span>
          <span className="text-[20px] font-black tabular-nums shrink-0" style={{ letterSpacing: '-.02em', color: pctInk }}>{pctLabel}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold tabular-nums" style={{ color: '#8e8e93' }}>{valueLabel}</span>
          {idealTag}
        </div>
        {rail}
      </div>
    </div>
  );
};

interface Verdict { titulo: string; texto: string; acao: string; }

/**
 * O veredito do mês — quem é o culpado de verdade.
 *
 * Antes daqui, fechar no vermelho sempre imprimia "reduza a conta fixa". Isso
 * mente quando a conta fixa está dentro do plano: em 2026-08-24 o Eduardo viu
 * conta fixa 56% (ideal 55%), educação 0% e lazer 15% — os três pilares em dia —
 * e mesmo assim o app mandava cortar conta fixa. O buraco estava FORA dos
 * pilares: variáveis, fatura de cartão e gasto ainda não categorizado.
 *
 * A ordem da acusação é a mesma que o consultor usa: primeiro o pilar que
 * ESTOUROU (não o que apenas bateu o limite); se nenhum estourou, o vazamento
 * está no que não entra nos pilares.
 */
function buildVerdict(a: {
  income: number; balance: number;
  fixedPct: number; eduPct: number; leisurePct: number; savePct: number;
  variable: number; fora: number;
}): Verdict {
  const { balance, fixedPct, eduPct, leisurePct, savePct, variable, fora } = a;

  if (balance >= 0) {
    if (savePct >= IDEAL_LIMITS.SAVINGS) return {
      titulo: 'Mês fechado como manda o plano.',
      texto: `Você guarda ${asPct(savePct)} da renda — acima da meta de ${asPct(IDEAL_LIMITS.SAVINGS)}. É assim que se constrói patrimônio.`,
      acao: 'Mantenha o ritmo e direcione a sobra para as suas metas.',
    };
    return {
      titulo: 'Você fecha no positivo.',
      texto: `Sobram ${asPct(savePct)} da renda para juntar. A meta é ${asPct(IDEAL_LIMITS.SAVINGS)} — falta pouco.`,
      acao: 'Ataque o maior gasto que não é essencial e leve essa diferença para a meta.',
    };
  }

  // Fechou no vermelho. Quem passou do limite? (`de` já vem contraído para não
  // ter que adivinhar gênero na hora de montar a frase)
  const estourados = ([
    { nome: 'conta fixa', de: 'da conta fixa', ela: 'A conta fixa', pct: fixedPct, ideal: IDEAL_LIMITS.FIXED,
      acao: 'Reduzir conta fixa é o caminho mais rápido: renegocie ou corte o que não é essencial.' },
    { nome: 'lazer / pessoal', de: 'do lazer', ela: 'O lazer / pessoal', pct: leisurePct, ideal: IDEAL_LIMITS.LEISURE,
      acao: 'Segurar o lazer neste mês é o ajuste mais rápido para virar o jogo.' },
    { nome: 'educação', de: 'da educação', ela: 'A educação', pct: eduPct, ideal: IDEAL_LIMITS.EDUCATION,
      acao: 'A educação passou do teto de 10%. É dívida boa, mas precisa caber no plano.' },
  ] as const)
    .filter(p => isOver(p.pct, p.ideal))
    .sort((x, y) => (y.pct - y.ideal) - (x.pct - x.ideal));

  if (estourados.length > 0) {
    const p = estourados[0];
    const outros = estourados.slice(1).map(o => o.nome).join(' e ');
    return {
      titulo: `O mês fecha no vermelho por causa ${p.de}.`,
      texto: `${p.ela} está em ${asPct(p.pct)}, acima do ideal de ${asPct(p.ideal)}`
        + (outros ? `, e ${outros} também passou do limite.` : '.'),
      acao: p.acao,
    };
  }

  // Nenhum pilar estourou — o dinheiro está indo para fora deles.
  return {
    titulo: 'Seus pilares estão em dia. O vazamento está fora deles.',
    texto: `Conta fixa, educação e lazer estão dentro do plano — o problema não está aí. `
      + `${fora > 0 ? `São ${formatCurrency(fora)} em ` : 'O buraco está em '}`
      + `gastos variáveis, fatura de cartão e lançamentos ainda não categorizados`
      + `${variable > 0 ? ` (só as variáveis já somam ${formatCurrency(variable)})` : ''}. É aí que precisa olhar.`,
    acao: 'Abra Gastos e confira as variáveis e a fatura do cartão — é onde o dinheiro está saindo.',
  };
}

const Diagnosis: React.FC<DiagnosisProps> = ({ summary, items, monthIdx, monthName, isCurrentMonth }) => {
  const income = summary.totalIncome;
  const t = getPlanTotals(items, monthIdx);

  const fixedPct = income > 0 ? t.fixedCore / income : 0;
  const eduPct = income > 0 ? t.education / income : 0;
  const leisurePct = income > 0 ? t.leisure / income : 0;
  const savePct = income > 0 ? summary.balance / income : 0; // sobra = "para juntar"

  const tier = contaFixaTier(fixedPct);
  const metaValor = income * IDEAL_LIMITS.FIXED;
  const balOk = summary.balance >= 0;

  // Quanto saiu ALÉM dos pilares (variáveis, fatura de cartão, não categorizado).
  // É a diferença entre o que deveria sobrar olhando só os pilares e o que de
  // fato sobrou — o número que explica um vermelho com os pilares em dia.
  const fora = Math.max(0, (income - t.fixedCore - t.education - t.leisure) - summary.balance);
  const verdict = buildVerdict({
    income, balance: summary.balance,
    fixedPct, eduPct, leisurePct, savePct,
    variable: t.variable, fora,
  });

  const TIERS: { k: TierKey; label: string }[] = [
    { k: 'bom', label: 'Saudável' }, { k: 'limite', label: 'No limite' },
    { k: 'alto', label: 'Alta' }, { k: 'critico', label: 'Crítica' },
  ];

  return (
    <div className="bg-white border border-zinc-200 rounded-3xl p-5 md:p-6 mb-8 shadow-sm">
      {/* Header + trilha de faixas */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-3">
          <i className="fas fa-heart-pulse text-zinc-900 text-xl"></i>
          <div>
            <h3 className="text-lg font-black text-zinc-900 uppercase tracking-wider leading-none">
              Diagnóstico <span className="text-green-600">· {monthName}</span>
            </h3>
            <span className="text-[11px] font-bold text-zinc-400">metodologia Kashim</span>
          </div>
        </div>
        <div className="flex gap-1 bg-zinc-100 rounded-full p-1">
          {TIERS.map(x => (
            <span key={x.k} className={`text-[10px] font-black uppercase tracking-wide px-2.5 py-1 rounded-full transition-all ${x.k === tier.key ? 'text-white' : 'text-zinc-400'}`}
              style={x.k === tier.key ? { background: tier.color } : undefined}>{x.label}</span>
          ))}
        </div>
      </div>

      {/* Recado: mês corrente ainda "em andamento" */}
      {isCurrentMonth && (
        <div className="mb-4 flex items-start gap-2.5 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3">
          <i className="fas fa-circle-info text-amber-600 mt-0.5"></i>
          <p className="text-[12.5px] text-amber-800 leading-snug">
            Você está vendo <b>{monthName}, o mês em andamento</b>. A conta fixa é a mesma todo mês, mas o
            <b> "para juntar"</b> ainda muda conforme as faturas deste mês fecham. Para o retrato mais fiel, olhe um <b>mês futuro</b>.
          </p>
        </div>
      )}

      {/* HERO escuro */}
      <div className="rounded-3xl p-6 md:p-7 mb-6 relative overflow-hidden"
        style={{ background: `radial-gradient(120% 120% at 15% 0%, ${tier.glow} 0%, rgba(0,0,0,0) 45%), linear-gradient(160deg,#15171a,#0a0b0c)` }}>
        <div className="flex flex-col md:flex-row items-center gap-6">
          <div className="shrink-0 flex flex-col items-center">
            <Gauge pct={fixedPct} color={tier.color} glow={tier.glow} />
            <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mt-1">
              <span className="inline-block w-3 h-[2px] align-middle bg-white mr-1"></span>ideal {asPct(IDEAL_LIMITS.FIXED)}
            </div>
          </div>

          <div className="flex-1 min-w-0 text-center md:text-left">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full mb-3"
              style={{ background: `${tier.color}22`, color: tier.color }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: tier.color }}></span>{tier.badge}
            </span>
            {/* Manchete e ação vêm do veredito do MÊS (olha os quatro pilares),
                não só da faixa de conta fixa — senão o app manda cortar conta
                fixa que já está dentro do plano. */}
            <h4 className="text-white font-black text-2xl md:text-3xl leading-tight tracking-tight" style={{ textWrap: 'balance' }}>{verdict.titulo}</h4>
            <p className="text-zinc-400 text-sm leading-relaxed mt-2 max-w-xl mx-auto md:mx-0">{verdict.texto}</p>

            <div className="mt-4 rounded-2xl bg-white/5 border border-white/10 p-3.5 flex items-start gap-3 text-left">
              <i className="fas fa-circle-check mt-0.5" style={{ color: tier.color }}></i>
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-0.5">O que fazer agora</div>
                <div className="text-zinc-100 text-sm font-semibold leading-snug">{verdict.acao}</div>
              </div>
            </div>

            {/* Comparação evidente: seu status vs ideal */}
            <div className="mt-4 grid grid-cols-2 gap-3 max-w-md mx-auto md:mx-0">
              <div className="rounded-xl bg-white/5 border border-white/10 px-3 py-2">
                <div className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Seu status</div>
                <div className="font-black text-lg" style={{ color: tier.color }}>{asPct(fixedPct)} <span className="text-[11px] font-bold text-zinc-500">· {formatCurrency(t.fixedCore)}</span></div>
              </div>
              <div className="rounded-xl bg-white/5 border border-white/10 px-3 py-2">
                <div className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Ideal</div>
                <div className="font-black text-lg text-white">{asPct(IDEAL_LIMITS.FIXED)} <span className="text-[11px] font-bold text-zinc-500">· {formatCurrency(metaValor)}</span></div>
              </div>
            </div>

            {t.education > 0 && (
              <p className="text-[12px] text-zinc-400 mt-3 leading-snug max-w-xl mx-auto md:mx-0">
                <i className="fas fa-circle-info mr-1 text-zinc-500"></i>
                Sua conta fixa total é <b className="text-zinc-200">{formatCurrency(t.fixedCore + t.education)}</b> —
                sendo {formatCurrency(t.fixedCore)} de conta fixa + {formatCurrency(t.education)} em <b className="text-blue-300">educação</b>,
                que medimos à parte (é o pilar de 10%). <b>Nada fica de fora.</b>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Onde vai o seu salário — real vs ideal */}
      <div className="flex items-baseline gap-2.5 flex-wrap mb-1">
        <h4 className="text-[12px] font-black uppercase" style={{ letterSpacing: '.16em', color: '#1d1d1f' }}>Onde vai o seu salário</h4>
        <span className="text-[12px] font-semibold" style={{ color: '#aeaeb2' }}>real vs. ideal Kashim</span>
      </div>
      <div className="grid gap-2.5 mt-3">
        <PillarBar name="Conta fixa" value={t.fixedCore} realPct={fixedPct} idealPct={IDEAL_LIMITS.FIXED} color={tier.color} glow={tier.glow} dir="cost" />
        <PillarBar name="Educação" value={t.education} realPct={eduPct} idealPct={IDEAL_LIMITS.EDUCATION} color="#007aff" glow="rgba(0,122,255,0.28)" dir="cost" />
        <PillarBar name="Lazer / Pessoal" value={t.leisure} realPct={leisurePct} idealPct={IDEAL_LIMITS.LEISURE} color="#7c3aed" glow="rgba(124,58,237,0.28)" dir="cost" />
        {/* Valor REAL (pode ser negativo) — mostrar R$ 0,00 ao lado de -229%
            fazia o cliente duvidar do número. */}
        <PillarBar name="Para juntar" value={summary.balance} realPct={savePct} idealPct={IDEAL_LIMITS.SAVINGS} color="#00b8a9" glow="rgba(0,184,169,0.28)" dir="save" />
      </div>

      {/* Sobra do mês — mesmo veredito do topo, sem repetir palavra por palavra */}
      <div className={`mt-5 rounded-2xl border p-4 flex items-center justify-between gap-3 flex-wrap ${balOk ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Sobra do mês · o que vai para juntar</div>
          <div className="text-[12px] text-zinc-600 font-semibold mt-0.5 max-w-md">{verdict.texto}</div>
        </div>
        <div className={`font-black text-xl tabular-nums shrink-0 ${balOk ? 'text-green-700' : 'text-red-600'}`}>{formatCurrency(summary.balance)}</div>
      </div>

      {/* Onde o mês REALMENTE termina.
          Os pilares acima medem só este mês contra o salário — e não mudam,
          de propósito: é a régua do diagnóstico. Mas quem guardou nos meses
          anteriores fecha em outro lugar, e sem esta linha a tela mostrava dois
          negativos diferentes sem explicar a diferença (o Hugo via -R$ 4.101
          aqui e -R$ 601 no card do acumulado). */}
      {Math.abs(summary.accumulated - summary.balance) >= 0.01 && (() => {
        const anterior = summary.accumulated - summary.balance;
        const fechaOk = summary.accumulated >= 0;
        const salvou = anterior > 0 && !balOk;
        return (
          <div className={`mt-2.5 rounded-2xl border p-4 ${fechaOk ? 'bg-green-50/70 border-green-200' : 'bg-zinc-50 border-zinc-200'}`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                  Onde {monthName} termina de verdade
                </div>
                <div className="text-[12px] text-zinc-600 font-semibold mt-0.5 max-w-md leading-snug">
                  {salvou
                    ? `Você fecha ${monthName} em ${formatCurrency(summary.balance)}, mas tinha ${formatCurrency(anterior)} guardado dos meses anteriores. É esse dinheiro que segura o mês.`
                    : anterior > 0
                      ? `Somando ${formatCurrency(anterior)} que você já tinha guardado, seu caixa chega em ${formatCurrency(summary.accumulated)}.`
                      : `Você vinha devendo ${formatCurrency(Math.abs(anterior))} dos meses anteriores, e isso entra na conta.`}
                </div>
              </div>
              <div className={`font-black text-xl tabular-nums shrink-0 ${fechaOk ? 'text-green-700' : 'text-red-600'}`}>
                {formatCurrency(summary.accumulated)}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default Diagnosis;
