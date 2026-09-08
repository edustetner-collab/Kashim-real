// Ponte entre o fim do wizard de contas e a conexão bancária.
//
// Decisão do Eduardo (2026-09-08): o cliente novo não "descobre" o Open
// Finance depois — ele é induzido a conectar logo ao terminar de preencher as
// contas, porque é ali que ele acabou de sentir o trabalho de digitar tudo à
// mão. O argumento se vende sozinho nesse instante e não se vende mais depois.
//
// Não é obrigatório: "agora não" tem que existir e não pode ter cara de erro.
// Quem recusa continua com o app inteiro pelo caminho manual — o Open Finance
// acrescenta, nunca substitui (ver memória
// open-finance-nao-pode-remover-do-plano-normal).
//
// Quem chega aqui já passou pelo portão: o App só monta este convite com
// hasOpenFinanceAccess(user).

import React from 'react';

interface Props {
  nome?: string;
  onConectar: () => void;
  onDepois: () => void;
}

const ConviteConectarBanco: React.FC<Props> = ({ nome, onConectar, onDepois }) => (
  <div className="fixed inset-0 z-[190] flex items-end justify-center bg-black/85 backdrop-blur-md sm:items-center">
    <div className="w-full max-w-md rounded-t-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl sm:rounded-3xl">

      <div className="mb-5 flex justify-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-green-400/25 bg-green-400/10">
          <i className="fas fa-building-columns text-2xl text-green-400" />
        </div>
      </div>

      <h2 className="mb-3 text-center text-2xl font-black uppercase italic leading-tight tracking-tighter text-white">
        {nome ? `Pronto, ${nome}!` : 'Plano montado!'}
        <br />
        Agora pare de digitar
      </h2>

      <p className="mb-5 text-center text-sm leading-relaxed text-zinc-400">
        Você acabou de montar seu plano à mão. Conectando seu banco, os gastos
        passam a chegar sozinhos — e seu trabalho vira só conferir se está no
        lugar certo.
      </p>

      <div className="mb-5 space-y-2.5 rounded-2xl border border-zinc-800 bg-zinc-800/40 p-4">
        {[
          ['fa-bolt', 'Suas compras entram sozinhas, sem você lançar uma por uma.'],
          ['fa-lock', 'É só leitura. O Kashim não movimenta dinheiro nem vê sua senha.'],
          ['fa-xmark', 'Dá para desconectar quando quiser, pelo app ou pelo banco.'],
        ].map(([icone, texto]) => (
          <div key={texto} className="flex items-start gap-3">
            <i className={`fas ${icone} mt-0.5 w-4 shrink-0 text-center text-xs text-green-400`} />
            <p className="text-xs leading-snug text-zinc-300">{texto}</p>
          </div>
        ))}
      </div>

      <button
        onClick={onConectar}
        className="mb-2 w-full rounded-2xl py-4 text-xs font-black uppercase tracking-widest text-black shadow-lg transition-all active:scale-95"
        style={{ background: 'linear-gradient(90deg, #c5f23a, #8cc400)' }}
      >
        <i className="fas fa-link mr-2 text-[10px]" />
        Conectar meu banco
      </button>

      {/* Recusa sem peso: quem lança à mão não fez nada errado. */}
      <button
        onClick={onDepois}
        className="w-full py-3 text-[11px] font-bold uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-300"
      >
        Agora não, prefiro lançar à mão
      </button>

      <p className="mt-3 text-center text-[10px] leading-snug text-zinc-600">
        Você pode conectar depois a qualquer momento, pela aba Extrato.
      </p>
    </div>
  </div>
);

export default ConviteConectarBanco;
