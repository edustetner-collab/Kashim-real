
import React, { useState } from 'react';
import { useAuth } from '@clerk/clerk-react';

interface SubscriptionGateProps {
  onClose: () => void;
  /** App nativo (iOS/Android): versão neutra, sem QUALQUER menção a pagamento
      nem direcionamento de compra (Apple 3.1.1 — modelo Netflix). */
  isNative?: boolean;
  onSignOut?: () => void;
}

const BASE_FEATURES = [
  'Planejamento completo dos 12 meses',
  'Diagnóstico financeiro em tempo real',
  'Gastos frequentes e cartões',
  'Conta compartilhada (casal)',
  'Suporte prioritário',
];

// Diferenciais exclusivos do plano com Open Finance.
const OF_FEATURES = [
  'Conexão automática com seu banco (Open Finance)',
  'Lançamento automático das suas transações',
  'Saldos e faturas sempre atualizados',
];

// Preços espelham api/create-checkout.ts. O valor cobrado é SEMPRE o do backend;
// aqui é só exibição. base: 1499/13188 · of: 2990/29880 (centavos).
const PRICES = {
  base: {
    monthly: { priceLabel: 'R$ 14,99', priceSuffix: '/mês', billedNote: 'Cobrado todo mês, cancele quando quiser', badge: null as string | null },
    annual: { priceLabel: 'R$ 10,99', priceSuffix: '/mês', billedNote: 'Cobrado R$ 131,88 uma vez por ano', badge: 'economize R$ 48' as string | null },
  },
  of: {
    monthly: { priceLabel: 'R$ 29,90', priceSuffix: '/mês', billedNote: 'Cobrado todo mês, cancele quando quiser', badge: null as string | null },
    annual: { priceLabel: 'R$ 24,90', priceSuffix: '/mês', billedNote: 'Cobrado R$ 298,80 uma vez por ano', badge: 'economize R$ 60' as string | null },
  },
} as const;

type Tier = keyof typeof PRICES;        // 'base' | 'of'
type Cycle = keyof typeof PRICES['base']; // 'monthly' | 'annual'

const SubscriptionGate: React.FC<SubscriptionGateProps> = ({ onClose, isNative = false, onSignOut }) => {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // OF como padrão (plano mais completo) + anual (melhor valor e maior LTV).
  const [tier, setTier] = useState<Tier>('of');
  const [cycle, setCycle] = useState<Cycle>('annual');

  async function handleSubscribe() {
    setLoading(true);
    setError('');
    try {
      const token = await getToken({ template: 'supabase' });
      const res = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ origin: window.location.origin, plan: cycle, tier }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Erro ao criar sessão de pagamento');
      }
      const { url } = await res.json();
      window.location.href = url;
    } catch (e: any) {
      setError(e.message || 'Erro inesperado');
      setLoading(false);
    }
  }

  // App nativo: tela neutra e bloqueante. Sem preço, sem botão de compra, sem
  // link externo — apenas informa que o período de avaliação terminou.
  // Quem avisa onde continuar é o e-mail (fora do app, canal permitido).
  if (isNative) {
    return (
      <div className="fixed inset-0 z-[300] bg-black/95 backdrop-blur-sm flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-[30px] p-8 shadow-2xl relative overflow-hidden text-center">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-green-500 to-green-300"></div>
          <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mb-6 border border-green-500/30 mx-auto">
            <i className="fas fa-hourglass-end text-2xl text-green-400"></i>
          </div>
          <h2 className="text-white text-2xl font-black uppercase italic tracking-tighter mb-3">
            Período de avaliação encerrado
          </h2>
          <p className="text-zinc-400 text-sm leading-relaxed mb-8">
            Seu período de avaliação gratuito do Kashim terminou. Obrigado por experimentar o app!
          </p>
          {onSignOut && (
            <button
              onClick={onSignOut}
              className="w-full text-zinc-500 hover:text-zinc-300 text-xs font-bold uppercase py-3 transition-colors border border-zinc-800 rounded-2xl"
            >
              Sair da conta
            </button>
          )}
        </div>
      </div>
    );
  }

  const price = PRICES[tier][cycle];
  const showOfFeatures = tier === 'of';

  return (
    <div className="fixed inset-0 z-[300] bg-black/90 backdrop-blur-sm flex items-center justify-center p-6 overflow-y-auto">
      <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-[30px] p-8 shadow-2xl relative overflow-hidden my-6">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-green-500 to-green-300"></div>

        <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mb-6 border border-green-500/30">
          <i className="fas fa-crown text-2xl text-green-400"></i>
        </div>

        <h2 className="text-white text-2xl font-black uppercase italic tracking-tighter mb-3">
          Continue enriquecendo
        </h2>

        <p className="text-zinc-400 text-sm leading-relaxed mb-5">
          Seu período gratuito encerrou. Escolha seu plano para continuar no controle das suas finanças.
        </p>

        {/* Seletor de plano: base vs Open Finance */}
        <div className="grid grid-cols-2 gap-2 mb-5">
          <button
            type="button"
            onClick={() => setTier('base')}
            className={`rounded-2xl border p-3 text-left transition-all ${tier === 'base' ? 'border-green-400 bg-green-500/10 ring-1 ring-green-400/40' : 'border-zinc-800 bg-zinc-950/40'}`}
          >
            <span className="text-white font-black text-xs uppercase tracking-wide">Kashim</span>
            <p className="text-zinc-500 text-[10px] mt-0.5 leading-snug">Você lança (voz, foto ou manual)</p>
          </button>
          <button
            type="button"
            onClick={() => setTier('of')}
            className={`rounded-2xl border p-3 text-left transition-all relative ${tier === 'of' ? 'border-green-400 bg-green-500/10 ring-1 ring-green-400/40' : 'border-zinc-800 bg-zinc-950/40'}`}
          >
            <span className="absolute -top-2 right-2 bg-green-400 text-black text-[8px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full">Completo</span>
            <span className="text-white font-black text-xs uppercase tracking-wide">+ Open Finance</span>
            <p className="text-zinc-500 text-[10px] mt-0.5 leading-snug">Tudo entra do seu banco, automático</p>
          </button>
        </div>

        {/* Features */}
        <ul className="space-y-2 mb-5">
          {BASE_FEATURES.map((item) => (
            <li key={item} className="flex items-center gap-3 text-zinc-300 text-sm">
              <i className="fas fa-check text-green-400 text-xs w-4"></i>
              {item}
            </li>
          ))}
          {showOfFeatures && OF_FEATURES.map((item) => (
            <li key={item} className="flex items-center gap-3 text-green-300 text-sm font-semibold">
              <i className="fas fa-bolt text-green-400 text-xs w-4"></i>
              {item}
            </li>
          ))}
        </ul>

        {/* Seletor de ciclo (mensal/anual) — preço do tier selecionado */}
        <div className="space-y-3 mb-6">
          {(['annual', 'monthly'] as Cycle[]).map((key) => {
            const p = PRICES[tier][key];
            const selected = cycle === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setCycle(key)}
                className={`w-full text-left rounded-2xl border p-4 transition-all relative ${
                  selected
                    ? 'border-green-400 bg-green-500/10 ring-1 ring-green-400/40'
                    : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-700'
                }`}
              >
                {p.badge && (
                  <span className="absolute -top-2 right-4 bg-green-400 text-black text-[9px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full">
                    {p.badge}
                  </span>
                )}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${selected ? 'border-green-400' : 'border-zinc-600'}`}>
                      {selected && <span className="w-2 h-2 rounded-full bg-green-400" />}
                    </span>
                    <span className="text-white font-black text-sm uppercase tracking-wide">{key === 'annual' ? 'Anual' : 'Mensal'}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-white font-black text-lg">{p.priceLabel}</span>
                    <span className="text-zinc-500 text-xs font-bold">{p.priceSuffix}</span>
                  </div>
                </div>
                <p className="text-zinc-500 text-[11px] mt-1.5 ml-7">{p.billedNote}</p>
              </button>
            );
          })}
        </div>

        {error && <p className="text-red-400 text-xs mb-4 text-center">{error}</p>}
        <button
          onClick={handleSubscribe}
          disabled={loading}
          className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-black py-4 rounded-2xl transition-all shadow-lg uppercase text-sm tracking-widest mb-3"
        >
          {loading ? <i className="fas fa-circle-notch animate-spin"></i> : `Assinar ${tier === 'of' ? 'com Open Finance' : ''} ${cycle === 'annual' ? 'anual' : 'mensal'}`.replace(/\s+/g, ' ').trim()}
        </button>

        <button
          onClick={onClose}
          className="w-full text-zinc-600 hover:text-zinc-400 text-xs font-bold uppercase py-2 transition-colors"
        >
          Lembrar depois
        </button>
      </div>
    </div>
  );
};

export default SubscriptionGate;
