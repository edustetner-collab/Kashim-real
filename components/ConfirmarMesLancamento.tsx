import React from 'react';
import { MONTHS_BR } from '../constants';
import { isNativeApp } from '../lib/onboarding/platform';

/**
 * Anti-erro de mês no lançamento manual.
 *
 * No celular o mês navegado fica fácil de esquecer: o cliente avança para
 * outubro para olhar algo, volta a lançar o mercado e o gasto cai em outubro.
 * Foi o erro mais comum nos clientes (Eduardo, 2026-09-17). Só no app — na web
 * o mês fica visível na tela o tempo todo.
 */
export function precisaConfirmarMes(ano: number, mes: number): boolean {
  if (!isNativeApp) return false;
  const hoje = new Date();
  return ano !== hoje.getFullYear() || mes !== hoje.getMonth();
}

interface Props {
  /** Mês (0-11) e ano em que o lançamento vai cair se o cliente mantiver. */
  ano: number;
  mes: number;
  onMesAtual: () => void;
  onManter: () => void;
  onFechar: () => void;
}

const ConfirmarMesLancamento: React.FC<Props> = ({ ano, mes, onMesAtual, onManter, onFechar }) => {
  const hoje = new Date();
  const mesAtual = MONTHS_BR[hoje.getMonth()];
  const outroAno = ano !== hoje.getFullYear();
  const mesNavegado = `${MONTHS_BR[mes]}${outroAno ? ` de ${ano}` : ''}`;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center px-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onFechar} />
      <div className="relative w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="w-12 h-12 rounded-2xl bg-[#fff8e6] flex items-center justify-center mb-4">
          <i className="fas fa-calendar-day text-xl text-[#e09b00]" />
        </div>
        <h3 className="text-[#1d1d1f] text-lg font-black leading-tight mb-2">
          Você está navegando em {mesNavegado}
        </h3>
        <p className="text-[#6e6e73] text-sm leading-relaxed mb-6">
          Este gasto vai ser lançado em <b className="text-[#1d1d1f]">{mesNavegado}</b>. Hoje estamos em{' '}
          <b className="text-[#1d1d1f]">{mesAtual}</b>. Quer lançar no mês atual?
        </p>
        <div className="flex flex-col gap-2.5">
          <button onClick={onMesAtual} className="k-btn-lime w-full py-3.5 font-black text-sm">
            Lançar em {mesAtual}
          </button>
          <button
            onClick={onManter}
            className="w-full py-3 rounded-2xl bg-[#f5f5f7] text-[#1d1d1f] font-bold text-sm active:scale-[0.98]"
          >
            Manter em {mesNavegado}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmarMesLancamento;
