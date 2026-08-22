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

const PillarBar: React.FC<{ name: string; value: number; realPct: number; idealPct: number; color: string; dir: Dir }>
  = ({ name, value, realPct, idealPct, color, dir }) => {
  const fillW = Math.max(0, Math.min(100, realPct * 100));
  const idealLeft = Math.min(100, Math.max(0, idealPct * 100));

  // 'save' (Para juntar) é a única variável BOA: nunca fica vermelha se guarda
  // algo positivo. Vermelho só se não guardou nada / negativo. Do contrário,
  // degradê verde escuro → verde limão conforme se aproxima da meta (20%).
  let barColor: string;
  let textRed: boolean;
  if (dir === 'save') {
    if (realPct <= 0) { barColor = '#ef4444'; textRed = true; }
    else { barColor = mixHex('#166534', '#84cc16', realPct / idealPct); textRed = false; }
  } else {
    const onTarget = realPct <= idealPct;
    barColor = onTarget ? color : '#ef4444';
    textRed = !onTarget;
  }
  return (
    <div className="flex items-center gap-4 pt-6 pb-3">
      <div className="w-36 shrink-0">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }}></span>
          <span className="font-black text-[12px] uppercase tracking-wide text-zinc-800 truncate">{name}</span>
        </div>
        <div className="text-[11px] text-zinc-400 font-semibold ml-[18px]">{formatCurrency(value)}</div>
      </div>

      <div className="flex-1 relative h-5 rounded-full bg-zinc-100">
        <div className="h-full rounded-full" style={{ width: `${fillW}%`, background: barColor, transition: 'width .6s cubic-bezier(.16,1,.3,1)' }}></div>
        {/* Marca do ideal — linha + etiqueta bem visível */}
        <div className="absolute -top-6 -bottom-1.5" style={{ left: `${idealLeft}%`, transform: 'translateX(-50%)' }}>
          <span className="absolute -top-0 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-black uppercase tracking-wide text-zinc-500 bg-white px-1">ideal {asPct(idealPct)}</span>
          <div className="w-[2px] h-full mx-auto mt-4 bg-zinc-800 rounded"></div>
        </div>
      </div>

      <div className="w-16 shrink-0 text-right">
        <div className={`font-black text-lg tabular-nums leading-none ${textRed ? 'text-red-500' : 'text-zinc-900'}`}>{asPct(realPct)}</div>
        <div className="text-[9px] font-black uppercase tracking-wide text-zinc-400 mt-0.5">você</div>
      </div>
    </div>
  );
};

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
  const saveOk = savePct >= IDEAL_LIMITS.SAVINGS;

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
            <h4 className="text-white font-black text-2xl md:text-3xl leading-tight tracking-tight" style={{ textWrap: 'balance' }}>{tier.headline}</h4>
            <p className="text-zinc-400 text-sm leading-relaxed mt-2 max-w-xl mx-auto md:mx-0">{tier.msg}</p>

            <div className="mt-4 rounded-2xl bg-white/5 border border-white/10 p-3.5 flex items-start gap-3 text-left">
              <i className="fas fa-circle-check mt-0.5" style={{ color: tier.color }}></i>
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-0.5">O que fazer agora</div>
                <div className="text-zinc-100 text-sm font-semibold leading-snug">{tier.acao}</div>
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
      <div className="mb-1">
        <h4 className="text-[13px] font-black text-zinc-900 uppercase tracking-wider">
          Onde vai o seu salário <span className="text-zinc-400 normal-case font-semibold tracking-normal">· real vs. ideal</span>
        </h4>
      </div>
      <div className="divide-y divide-zinc-100">
        <PillarBar name="Conta fixa" value={t.fixedCore} realPct={fixedPct} idealPct={IDEAL_LIMITS.FIXED} color="#16a34a" dir="cost" />
        <PillarBar name="Educação" value={t.education} realPct={eduPct} idealPct={IDEAL_LIMITS.EDUCATION} color="#2563eb" dir="cost" />
        <PillarBar name="Lazer / Pessoal" value={t.leisure} realPct={leisurePct} idealPct={IDEAL_LIMITS.LEISURE} color="#9333ea" dir="cost" />
        <PillarBar name="Para juntar" value={Math.max(0, summary.balance)} realPct={savePct} idealPct={IDEAL_LIMITS.SAVINGS} color="#22c55e" dir="save" />
      </div>

      {/* Sobra do mês */}
      <div className={`mt-5 rounded-2xl border p-4 flex items-center justify-between gap-3 ${balOk ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Sobra do mês · o que vai para juntar</div>
          <div className="text-[12px] text-zinc-600 font-semibold mt-0.5 max-w-md">
            {balOk
              ? (saveOk
                  ? `Você guarda ${asPct(savePct)} da renda — acima da meta de ${asPct(IDEAL_LIMITS.SAVINGS)}. Excelente, é assim que se constrói patrimônio.`
                  : `Você já guarda ${asPct(savePct)} da renda — bom começo! A meta é ${asPct(IDEAL_LIMITS.SAVINGS)}; reduzindo custos você chega lá.`)
              : 'Você fecha no vermelho — não sobra para juntar. Reduzir a conta fixa é o caminho mais rápido para virar o jogo.'}
          </div>
        </div>
        <div className={`font-black text-xl tabular-nums shrink-0 ${balOk ? 'text-green-700' : 'text-red-600'}`}>{formatCurrency(summary.balance)}</div>
      </div>
    </div>
  );
};

export default Diagnosis;
