import React, { useEffect, useState } from 'react';

interface Assinatura {
  nome: string;
  valor: number;
  ultimaData: string;
  ocorrencias: number;
}

interface Props {
  householdId: string;
  authToken: string;
  topOffset: number;
  onClose: () => void;
}

function formatCurrencyBR(val: number) {
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateBR(iso: string) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

// Links de cancelamento de cada serviço — abrem o site oficial do serviço, não
// cancelam sozinhos. Versão honesta do "botão de cancelar".
const CANCEL_URLS: Record<string, string> = {
  'Netflix':           'https://www.netflix.com/cancelplan',
  'Spotify':           'https://www.spotify.com/br/account/subscription/cancel/',
  'YouTube Premium':   'https://www.youtube.com/paid_memberships',
  'Amazon Prime':      'https://www.amazon.com.br/hz/mycd/myx#/home/membership/manage',
  'Disney+':           'https://www.disneyplus.com/pt-br/settings/subscription',
  'Max (HBO)':         'https://play.max.com/settings/subscription',
  'Globoplay':         'https://assinaturas.globo.com/',
  'Paramount+':        'https://www.paramountplus.com/br/account/subscription/',
  'Deezer':            'https://www.deezer.com/br/account/subscription/',
  'Apple Music':       'https://support.apple.com/pt-br/HT202039',
  'Apple TV+':         'https://support.apple.com/pt-br/HT202039',
  'Apple One':         'https://support.apple.com/pt-br/HT202039',
  'iCloud+':           'https://support.apple.com/pt-br/HT207594',
  'Google One':        'https://one.google.com/u/0/storage',
  'Dropbox':           'https://www.dropbox.com/plans',
  'OneDrive':          'https://account.microsoft.com/services/',
  'Canva Pro':         'https://www.canva.com/brand/account/subscription/',
  'Adobe Creative':    'https://account.adobe.com/plans',
  'ChatGPT Plus':      'https://chat.openai.com/',
  'Microsoft 365':     'https://account.microsoft.com/services/',
};

// Serviços com ícone de marca no FontAwesome — os demais mostram a inicial.
const FA_BRAND: Record<string, string> = {
  'Spotify':        'fab fa-spotify',
  'YouTube Premium':'fab fa-youtube',
  'Amazon Prime':   'fab fa-amazon',
  'Apple Music':    'fab fa-apple',
  'Apple TV+':      'fab fa-apple',
  'Apple One':      'fab fa-apple',
  'iCloud+':        'fab fa-apple',
  'Google One':     'fab fa-google',
  'Dropbox':        'fab fa-dropbox',
  'OneDrive':       'fab fa-microsoft',
  'Microsoft 365':  'fab fa-microsoft',
};

function cancelUrl(nome: string) {
  return CANCEL_URLS[nome] ?? null;
}

export default function Assinaturas({ householdId, authToken, topOffset, onClose }: Props) {
  const [assinaturas, setAssinaturas] = useState<Assinatura[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams({ householdId });
    fetch(`/api/of-subscriptions?${params}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setAssinaturas(d.assinaturas ?? []))
      .catch(() => setErro(true))
      .finally(() => setLoading(false));
  }, [householdId, authToken]);

  const totalMensal = assinaturas.reduce((s, a) => s + a.valor, 0);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#f2f2f7]" style={{ paddingTop: topOffset }}>
      {/* Header */}
      <div className="bg-white border-b border-[#e5e5ea] px-4 safe-top pt-2 pb-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onClose}
            aria-label="Voltar"
            className="w-8 h-8 rounded-full bg-[#e5e5ea] flex items-center justify-center flex-shrink-0"
          >
            <i className="fas fa-chevron-left text-[#1d1d1f] text-xs" />
          </button>
          <div className="min-w-0">
            <h2 className="text-lg font-black text-[#1d1d1f]">Assinaturas</h2>
            <p className="text-xs text-[#6e6e73]">Detectadas pelo Open Finance</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-full bg-[#e5e5ea] flex items-center justify-center"
        >
          <i className="fas fa-xmark text-[#1d1d1f] text-sm" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="text-center py-16 text-[#8e8e93]">
            <i className="fas fa-circle-notch animate-spin text-xl mb-2 block" />
            <span className="text-sm">Carregando…</span>
          </div>
        ) : erro ? (
          <div className="bg-white rounded-2xl p-6 text-center">
            <p className="font-bold text-[#ff3b30] mb-1">Não consegui carregar as assinaturas</p>
            <p className="text-sm text-[#6e6e73]">Feche e tente de novo em instantes.</p>
          </div>
        ) : assinaturas.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center">
            <div className="text-5xl mb-3">📭</div>
            <p className="font-bold text-[#1d1d1f] mb-1">Nenhuma assinatura encontrada</p>
            <p className="text-sm text-[#6e6e73] leading-relaxed">
              Suas assinaturas aparecem aqui assim que forem importadas e categorizadas pelo Open Finance.
            </p>
          </div>
        ) : (
          <>
            {/* Card de total */}
            <div className="bg-[#007aff] rounded-2xl px-5 py-4">
              <p className="text-[12px] font-bold text-white/70 uppercase tracking-wide mb-0.5">
                Total em assinaturas
              </p>
              <p className="text-[28px] font-black text-white leading-none">
                {formatCurrencyBR(totalMensal)}
                <span className="text-[14px] font-semibold text-white/60 ml-1">/mês</span>
              </p>
              <p className="text-[12px] text-white/60 mt-1">
                {assinaturas.length} serviç{assinaturas.length === 1 ? 'o' : 'os'} identificado{assinaturas.length === 1 ? '' : 's'}
              </p>
            </div>

            {/* Lista */}
            <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
              {assinaturas.map((a, idx) => {
                const url = cancelUrl(a.nome);
                return (
                  <div
                    key={a.nome}
                    className={`flex items-center gap-3 px-4 py-3.5 ${idx > 0 ? 'border-t border-[#f0f0f0]' : ''}`}
                  >
                    {/* Ícone: marca FA quando existe, letra inicial para o resto */}
                    <div className="w-10 h-10 rounded-xl bg-[#f2f2f7] flex items-center justify-center flex-shrink-0">
                      {FA_BRAND[a.nome] ? (
                        <i className={`${FA_BRAND[a.nome]} text-[#1d1d1f] text-[17px]`} />
                      ) : (
                        <span className="text-[17px] font-black text-[#1d1d1f]">
                          {a.nome.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>

                    {/* Nome + data */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-bold text-[#1d1d1f] leading-snug truncate">
                        {a.nome}
                      </p>
                      <p className="text-[12px] text-[#8e8e93]">
                        Último: {formatDateBR(a.ultimaData)}
                        {a.ocorrencias > 1 && (
                          <span className="ml-1.5 text-[11px] bg-[#f2f2f7] text-[#6e6e73] rounded-full px-1.5 py-0.5 font-semibold">
                            {a.ocorrencias}× detectada
                          </span>
                        )}
                      </p>
                    </div>

                    {/* Valor + link */}
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-[15px] font-black text-[#1d1d1f]">
                        {formatCurrencyBR(a.valor)}
                      </span>
                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] font-bold text-[#ff3b30]"
                        >
                          Cancelar →
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="text-[11px] text-[#8e8e93] text-center px-4 pb-2 leading-relaxed">
              Valores baseados na última cobrança identificada. O link de cancelamento leva ao site oficial do serviço.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
