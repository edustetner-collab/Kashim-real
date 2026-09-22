import React, { useState, useEffect } from 'react';
import { UserProfile, useUser, useClerk } from '@clerk/clerk-react';

// O domínio do Clerk vem codificado na publishable key (pk_live_<base64 do host>).
function clerkFrontendApi(): string | null {
  const pk = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
  if (!pk) return null;
  try {
    const encoded = pk.replace(/^pk_(live|test)_/, '');
    const host = atob(encoded).replace(/\$$/, '');
    return host ? `https://${host}` : null;
  } catch {
    return null;
  }
}

// Só faz sentido exigir segundo fator se a instância oferecer algum. Enquanto
// não oferecer, exigir trancaria o staff fora do painel sem saída — o mesmo
// princípio de falhar aberto que o rate limit usa.
function useSegundoFatorDisponivel(): boolean | null {
  const [disponivel, setDisponivel] = useState<boolean | null>(null);

  useEffect(() => {
    const base = clerkFrontendApi();
    if (!base) { setDisponivel(false); return; }
    let cancelado = false;

    (async () => {
      try {
        const r = await fetch(`${base}/v1/environment?__clerk_api_version=2021-02-05`, {
          credentials: 'include',
        });
        if (!r.ok || cancelado) { setDisponivel(false); return; }
        const j = await r.json() as {
          user_settings?: { attributes?: Record<string, { enabled?: boolean; used_for_second_factor?: boolean }> };
        };
        // O Clerk nomeia o app autenticador de `authenticator_app`, não `totp`.
        // Em vez de listar nomes, vale qualquer atributo marcado como segundo
        // fator — assim um método novo não passa despercebido.
        const attrs = j.user_settings?.attributes ?? {};
        const temAlgum = Object.values(attrs).some(
          v => v?.enabled && v?.used_for_second_factor,
        );
        if (!cancelado) setDisponivel(temAlgum);
      } catch {
        if (!cancelado) setDisponivel(false);
      }
    })();

    return () => { cancelado = true; };
  }, []);

  return disponivel;
}

// Exige segundo fator para quem entra no painel de staff.
//
// Por que só o staff: um coach ou assistente enxerga os dados financeiros de
// dezenas de clientes, então a conta dele vale muito mais para um atacante que a
// de um cliente. Para o cliente final, 2FA obrigatório seria atrito sem ganho
// proporcional — o app não movimenta dinheiro.
//
// A tela embute o próprio fluxo do Clerk: quem cai aqui ativa na hora e entra.
// Sem isso, um staff sem 2FA ficaria trancado fora do painel.
const StaffTwoFactorGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const [abrirConfig, setAbrirConfig] = useState(false);
  const podeExigir = useSegundoFatorDisponivel();

  if (!isLoaded) return null;

  // Enquanto a checagem não volta (null) ou a instância não oferece 2FA, passa
  // direto: exigir o que ninguém consegue ativar trancaria o painel.
  if (podeExigir !== true) return <>{children}</>;

  // `twoFactorEnabled` ausente (undefined) libera de propósito: um campo que o
  // Clerk não devolveu não pode virar bloqueio do painel.
  const semSegundoFator = user?.twoFactorEnabled === false;
  if (!semSegundoFator) return <>{children}</>;

  if (abrirConfig) {
    return (
      <div className="min-h-screen bg-zinc-950 py-8 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
            <div>
              <h1 className="text-xl font-black uppercase italic tracking-tighter text-white">
                Ativar verificação em duas etapas
              </h1>
              <p className="text-zinc-500 text-xs mt-0.5">
                Abra <strong className="text-zinc-400">Segurança</strong> e adicione um segundo fator.
              </p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="bg-green-500 active:bg-green-400 text-black font-black px-4 py-2.5 rounded-xl transition-all shadow-lg flex items-center gap-2 uppercase text-xs"
            >
              <i className="fas fa-check" /> Já ativei, continuar
            </button>
          </div>
          <UserProfile routing="hash" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-3xl p-7 text-center">
        <div className="w-14 h-14 rounded-2xl bg-green-500/15 border border-green-500/30 flex items-center justify-center mx-auto mb-4">
          <i className="fas fa-shield-halved text-green-400 text-xl" />
        </div>

        <h1 className="text-lg font-black uppercase italic tracking-tighter text-white mb-2">
          Proteja seu acesso
        </h1>

        <p className="text-zinc-400 text-sm leading-relaxed mb-5">
          Sua conta abre os dados financeiros de todos os clientes. Para entrar no painel,
          ative a verificação em duas etapas — leva menos de um minuto e usa o app
          autenticador do seu celular.
        </p>

        <button
          onClick={() => setAbrirConfig(true)}
          className="w-full bg-green-500 active:bg-green-400 text-black font-black px-4 py-3.5 rounded-xl transition-all shadow-lg uppercase text-xs mb-2.5"
        >
          <i className="fas fa-mobile-screen mr-2" /> Ativar agora
        </button>

        <button
          onClick={() => signOut()}
          className="w-full text-zinc-600 hover:text-zinc-400 text-xs py-2 transition-colors"
        >
          Sair da conta
        </button>
      </div>
    </div>
  );
};

export default StaffTwoFactorGate;
