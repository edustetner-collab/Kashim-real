
import React, { useState } from 'react';
import { useAuth } from '@clerk/clerk-react';

interface SubscriptionGateProps {
  onClose: () => void;
}

const SubscriptionGate: React.FC<SubscriptionGateProps> = ({ onClose }) => {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
        body: JSON.stringify({ origin: window.location.origin }),
      });

      if (!res.ok) throw new Error('Erro ao criar sessão de pagamento');
      const { url } = await res.json();
      window.location.href = url;
    } catch (e: any) {
      setError(e.message || 'Erro inesperado');
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[300] bg-black/90 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-[30px] p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-yellow-600 to-yellow-400"></div>

        <div className="w-16 h-16 bg-yellow-600/10 rounded-full flex items-center justify-center mb-6 border border-yellow-600/30">
          <i className="fas fa-crown text-2xl text-yellow-500"></i>
        </div>

        <h2 className="text-white text-2xl font-black uppercase italic tracking-tighter mb-3">
          Continue enriquecendo
        </h2>

        <p className="text-zinc-400 text-sm leading-relaxed mb-6">
          Seu período gratuito de acompanhamento encerrou. Para continuar usando o RICO nessa vida e manter sua organização financeira, assine por apenas:
        </p>

        <div className="bg-yellow-600/10 border border-yellow-600/30 rounded-2xl p-5 mb-6 text-center">
          <p className="text-yellow-500 text-4xl font-black">R$9,99</p>
          <p className="text-zinc-500 text-xs uppercase tracking-widest mt-1">por mês · cancele quando quiser</p>
        </div>

        <ul className="space-y-2 mb-8">
          {[
            'Planejamento completo dos 12 meses',
            'Diagnóstico financeiro em tempo real',
            'Gastos frequentes e cartões',
            'Conta compartilhada (casal)',
            'Suporte prioritário',
          ].map((item) => (
            <li key={item} className="flex items-center gap-3 text-zinc-300 text-sm">
              <i className="fas fa-check text-yellow-500 text-xs w-4"></i>
              {item}
            </li>
          ))}
        </ul>

        {error && <p className="text-red-400 text-xs mb-4 text-center">{error}</p>}

        <button
          onClick={handleSubscribe}
          disabled={loading}
          className="w-full bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-black font-black py-4 rounded-2xl transition-all shadow-lg uppercase text-sm tracking-widest mb-3"
        >
          {loading ? <i className="fas fa-circle-notch animate-spin"></i> : 'Assinar agora — R$9,99/mês'}
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
