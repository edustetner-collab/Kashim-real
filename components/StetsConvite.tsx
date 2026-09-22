import React from 'react';

/**
 * Convite compacto para o Stets, no topo do Plano em modo Open Finance.
 *
 * Substitui o card de lançamento, que ali era contraditório: quem conectou o
 * banco fez isso justamente para não digitar gasto, e o espaço mais nobre da
 * tela pedia exatamente isso. O lançamento manual continua no botão de baixo —
 * dinheiro vivo não é importado, e há a janela de 1 a 2 dias até a primeira
 * leva chegar (Eduardo, 2026-09-16).
 *
 * Claro e baixo de propósito: o card fica logo acima do botão de diagnóstico e
 * qualquer altura a mais encosta nele.
 */
interface Props {
  onAbrir: (pergunta?: string) => void;
}

/** Mesmo relevo do botão "Lançar" — o verde do app é sempre este. */
const RELEVO_LIMA: React.CSSProperties = {
  background: 'linear-gradient(180deg,#c5f23a 0%,#a2d800 50%,#8cc400 100%)',
  boxShadow: '0 4px 14px rgba(130,192,0,0.4),inset 0 1px 0 rgba(255,255,255,0.45)',
};

const ATALHOS = [
  'Como está minha vida financeira?',
  'Onde estou gastando demais?',
];

const StetsConvite: React.FC<Props> = ({ onAbrir }) => (
  <div className="mb-4 rounded-2xl bg-white border border-[#e8e8ed] px-3 py-2.5 shadow-sm">
    <div className="flex items-center gap-2.5">
      <div
        className="w-9 h-9 flex items-center justify-center shrink-0"
        style={{ ...RELEVO_LIMA, borderRadius: '12px' }}
      >
        <i className="fas fa-bolt text-[#182200] text-sm" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[#1d1d1f] font-black text-[13px] leading-tight">Pergunte ao Stets</p>
        <p className="text-[#6e6e73] text-[11px] leading-snug">
          Ele conhece seu plano e responde sobre seus gastos.
        </p>
      </div>

      <button
        onClick={() => onAbrir()}
        className="shrink-0 h-8 px-3.5 text-[#182200] font-black text-[10px] uppercase tracking-wider active:scale-95 transition-transform"
        style={{ ...RELEVO_LIMA, borderRadius: '10px' }}
      >
        Conversar
      </button>
    </div>

    <div className="flex gap-1.5 mt-2 justify-center flex-wrap">
      {ATALHOS.map((p) => (
        <button
          key={p}
          onClick={() => onAbrir(p)}
          className="shrink-0 text-[10px] text-[#6e6e73] bg-[#f5f5f7] border border-[#e8e8ed] rounded-full px-2.5 py-1 active:bg-[#ebebf0] transition-colors"
        >
          {p}
        </button>
      ))}
    </div>
  </div>
);

export default StetsConvite;
