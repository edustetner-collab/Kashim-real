// Aceite obrigatório dos Termos/Privacidade. Bloqueia o app até o usuário
// consentir — necessário porque clientes vindos de link mágico nunca passam
// pela tela de cadastro (onde ficava o aviso de consentimento implícito).

import React, { useState } from 'react';

interface TermsGateProps {
  onAccept: () => Promise<void>;
  onSignOut: () => void;
}

const HIGHLIGHTS: { icon: string; text: string }[] = [
  {
    icon: 'fa-lock',
    text: 'Seus dados financeiros são privados e usados apenas para gerar seu plano e diagnóstico.',
  },
  {
    icon: 'fa-user-tie',
    text: 'Seu consultor financeiro tem acesso aos seus dados para te acompanhar.',
  },
  {
    icon: 'fa-robot',
    text: 'Ao usar o Stets, textos e fotos de comprovantes são processados por IA (Anthropic, EUA) só para responder você — nunca para treinar modelos.',
  },
  {
    icon: 'fa-shield-halved',
    text: 'Pela LGPD, você pode pedir acesso, correção ou exclusão dos seus dados quando quiser.',
  },
];

const TermsGate: React.FC<TermsGateProps> = ({ onAccept, onSignOut }) => {
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    if (!checked || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onAccept();
    } catch {
      setError('Não foi possível registrar seu aceite. Verifique sua conexão e tente de novo.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-300">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-2xl max-h-[92vh] overflow-y-auto safe-bottom">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 bg-green-400/10 border border-green-400/20">
          <i className="fas fa-file-shield text-2xl text-green-400" />
        </div>

        <h2 className="text-white text-xl font-black italic uppercase tracking-tighter leading-tight mb-2">
          Antes de começar
        </h2>
        <p className="text-zinc-400 text-sm leading-relaxed mb-5">
          Para usar o Kashim, precisamos do seu consentimento sobre como cuidamos dos seus dados.
        </p>

        <div className="flex flex-col gap-3 mb-5">
          {HIGHLIGHTS.map(item => (
            <div key={item.icon} className="flex items-start gap-3">
              <div className="w-7 h-7 shrink-0 rounded-lg bg-zinc-800 flex items-center justify-center mt-0.5">
                <i className={`fas ${item.icon} text-green-400 text-[11px]`} />
              </div>
              <p className="text-zinc-400 text-xs leading-relaxed">{item.text}</p>
            </div>
          ))}
        </div>

        <a
          href="/termos.html"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between bg-zinc-800/70 border border-zinc-700 hover:border-green-400/40 rounded-2xl px-4 py-3 mb-5 transition-colors"
        >
          <span className="text-white text-xs font-bold">Ler os Termos e a Política na íntegra</span>
          <i className="fas fa-arrow-up-right-from-square text-zinc-500 text-[11px]" />
        </a>

        <button
          type="button"
          onClick={() => setChecked(c => !c)}
          className="flex items-start gap-3 w-full text-left mb-5 group"
          aria-pressed={checked}
        >
          <div
            className={`w-6 h-6 shrink-0 rounded-lg border-2 flex items-center justify-center transition-all mt-0.5 ${
              checked ? 'bg-green-400 border-green-400' : 'border-zinc-600 group-hover:border-zinc-500'
            }`}
          >
            {checked && <i className="fas fa-check text-black text-[11px]" />}
          </div>
          <span className="text-zinc-300 text-xs leading-relaxed">
            Li e concordo com os <strong className="text-white">Termos de Uso</strong> e com a{' '}
            <strong className="text-white">Política de Privacidade</strong> do Kashim.
          </span>
        </button>

        {error && (
          <p className="text-red-400 text-xs font-bold mb-3 text-center">{error}</p>
        )}

        <button
          onClick={handleAccept}
          disabled={!checked || saving}
          className={`w-full font-black py-4 rounded-2xl text-xs uppercase tracking-widest transition-all ${
            checked && !saving
              ? 'text-black active:scale-95 shadow-lg'
              : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
          }`}
          style={checked && !saving ? { background: 'linear-gradient(90deg, #c5f23a, #8cc400)' } : undefined}
        >
          {saving ? <i className="fas fa-circle-notch animate-spin" /> : 'Concordar e continuar'}
        </button>

        <button
          onClick={onSignOut}
          className="w-full text-zinc-600 hover:text-zinc-400 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors py-3 mt-1"
        >
          Sair da conta
        </button>
      </div>
    </div>
  );
};

export default TermsGate;
