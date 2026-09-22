import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/clerk-react';

// Diagnóstico e manutenção das conexões bancárias, dentro do painel.
//
// Existe porque investigar divergência de fatura exigia abrir o console do
// navegador e, pior, pedir ao próprio cliente que fizesse isso. Aqui o coach vê
// o que está gravado e conserta sozinho.

interface Conexao {
  banco: string;
  conectado_ha_horas: number | null;
  SAUDE: {
    consent_status: string | null;
    precisa_resincronizar: boolean | null;
    ultima_sincronizacao_ha_horas: number | null;
    protocolo_conta_ha_horas: number | null;
    protocolo_cartao_ha_horas: number | null;
  };
  cartoes: Array<{ last4: string; enabled: boolean }> | null;
  bill_totals_gravado: Record<string, Record<string, number>> | null;
  categorize_from: string | null;
}

interface Diagnostico {
  household_id: string;
  mes_analisado: string;
  FATURAS_GRAVADAS_NO_MES: Array<{ banco: string; cartao: string; valor: number }> | string;
  soma_das_faturas_do_mes: number;
  transacoes: {
    total: number;
    sem_bill_due_date: number;
    por_cartao: Record<string, number>;
    com_bill_total_carimbado: number;
  };
  conexoes: Conexao[];
}

interface Casa {
  household_id: string;
  casa: string;
  banco: string;
  cartoes: Array<{ last4: string }> | null;
  sincronizado: string | null;
}

interface LinhaVarredura {
  household_id: string;
  casa: string;
  conexoes: number;
  bancos: string;
  eh_cliente_consultoria: boolean;
  fatura_do_mes: number;
  transacoes: number;
  pendentes: number;
  com_vencimento: number;
  horas_sem_sync: number | null;
  alertas: string[];
}

const fmt = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
const horas = (h: number | null) => h == null ? '—' : h < 1 ? `${Math.round(h * 60)}min` : `${h}h`;

const ExtratoDiagnostico: React.FC = () => {
  const { getToken } = useAuth();
  const [casas, setCasas] = useState<Casa[]>([]);
  const [selecionado, setSelecionado] = useState<string>('');
  const [diag, setDiag] = useState<Diagnostico | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [agindo, setAgindo] = useState(false);
  const [aviso, setAviso] = useState('');
  const [varredura, setVarredura] = useState<{ casas: LinhaVarredura[]; com_alerta: number } | null>(null);
  const [varrendo, setVarrendo] = useState(false);

  const chamar = useCallback(async (url: string, body?: object) => {
    const token = await getToken({ template: 'supabase' });
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Falhou');
    return json;
  }, [getToken]);

  useEffect(() => {
    (async () => {
      try {
        const d = await chamar('/api/of-diagnostico');
        // Uma casa aparece uma vez por conexão; agrupar deixa a lista legível.
        const vistos = new Set<string>();
        setCasas((d.conexoes ?? []).filter((c: Casa) => {
          if (vistos.has(c.household_id)) return false;
          vistos.add(c.household_id);
          return true;
        }));
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Erro');
      } finally {
        setCarregando(false);
      }
    })();
  }, [chamar]);

  const abrir = async (id: string) => {
    setSelecionado(id); setDiag(null); setErro(''); setAviso('');
    try {
      setDiag(await chamar(`/api/of-diagnostico?q=${id}`));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro');
    }
  };

  const agir = async (acao: string, confirmacao: string) => {
    if (!window.confirm(confirmacao)) return;
    setAgindo(true); setAviso(''); setErro('');
    try {
      const r = await chamar('/api/of-diagnostico', { householdId: selecionado, acao });
      setAviso(r.proximo_passo ?? 'Feito.');
      await abrir(selecionado);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro');
    } finally {
      setAgindo(false);
    }
  };

  if (carregando) {
    return <div className="py-16 text-center text-zinc-600"><i className="fas fa-circle-notch fa-spin mr-2" />Carregando conexões...</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black uppercase italic tracking-tighter text-white">Extrato — Diagnóstico</h1>
        <p className="text-zinc-500 text-xs mt-0.5">Conferir e consertar faturas divergentes sem pedir nada ao cliente.</p>
      </div>

      {erro && <div className="bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3 text-red-400 text-sm">{erro}</div>}
      {aviso && <div className="bg-green-500/10 border border-green-500/25 rounded-xl px-4 py-3 text-green-400 text-sm">{aviso}</div>}

      {/* Varredura: o estado de todo mundo numa tela. Antes de lançar, é o que
          responde "está tudo certo?" sem depender de abrir cliente por cliente. */}
      <button
        onClick={async () => {
          setVarrendo(true); setErro('');
          try { setVarredura(await chamar('/api/of-diagnostico?varredura=1')); }
          catch (e) { setErro(e instanceof Error ? e.message : 'Erro'); }
          finally { setVarrendo(false); }
        }}
        disabled={varrendo}
        className="w-full py-3 rounded-xl bg-zinc-800 active:bg-zinc-700 disabled:opacity-50 text-zinc-200 font-black text-xs uppercase tracking-wide border border-zinc-700"
      >
        {varrendo
          ? <><i className="fas fa-circle-notch fa-spin mr-2" />Verificando todos...</>
          : <><i className="fas fa-clipboard-check mr-2" />Verificar todos de uma vez</>}
      </button>

      {varredura && (
        <div className="space-y-2">
          <div className={`rounded-2xl px-4 py-3 border ${
            varredura.com_alerta === 0
              ? 'bg-green-500/10 border-green-500/25 text-green-400'
              : 'bg-amber-500/10 border-amber-500/25 text-amber-400'
          }`}>
            <p className="text-sm font-black">
              {varredura.com_alerta === 0
                ? `Tudo certo em ${varredura.casas.length} ${varredura.casas.length === 1 ? 'casa' : 'casas'}`
                : `${varredura.com_alerta} de ${varredura.casas.length} ${varredura.com_alerta === 1 ? 'casa precisa' : 'casas precisam'} de atenção`}
            </p>
          </div>

          {varredura.casas.map(c => (
            <button
              key={c.household_id}
              onClick={() => abrir(c.household_id)}
              className={`w-full text-left rounded-2xl p-4 border transition-all ${
                c.alertas.length > 0
                  ? 'bg-amber-500/5 border-amber-500/25'
                  : 'bg-zinc-900 border-zinc-800'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-white font-black text-sm truncate">{c.casa}</span>
                {c.alertas.length === 0
                  ? <i className="fas fa-circle-check text-green-400 text-sm shrink-0" />
                  : <span className="text-amber-400 text-[10px] font-black uppercase shrink-0">{c.alertas.length} alerta{c.alertas.length > 1 ? 's' : ''}</span>}
              </div>
              <div className="flex gap-3 text-[11px] text-zinc-500 flex-wrap">
                <span>{c.bancos}</span>
                <span>fatura {fmt(c.fatura_do_mes)}</span>
                <span>{c.transacoes} transações</span>
                <span>{c.pendentes} pendentes</span>
                {c.eh_cliente_consultoria && <span className="text-blue-400">consultoria</span>}
                {c.horas_sem_sync !== null && <span>sync {c.horas_sem_sync}h</span>}
              </div>
              {c.alertas.map((a, i) => (
                <p key={i} className="text-amber-400/90 text-[11px] mt-1.5">
                  <i className="fas fa-triangle-exclamation mr-1.5" />{a}
                </p>
              ))}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {casas.map(c => (
          <button
            key={c.household_id}
            onClick={() => abrir(c.household_id)}
            className={`px-3 py-2 rounded-xl text-xs font-black border transition-all ${
              selecionado === c.household_id ? 'bg-green-500 text-black border-green-500' : 'bg-zinc-900 text-zinc-400 border-zinc-800'
            }`}
          >
            {c.casa !== '(sem nome)' ? c.casa : c.household_id.slice(0, 8)}
          </button>
        ))}
      </div>

      {diag && (
        <>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <h2 className="text-xs font-black uppercase tracking-wide text-zinc-500 mb-3">
              Fatura gravada — {diag.mes_analisado}
            </h2>
            {Array.isArray(diag.FATURAS_GRAVADAS_NO_MES) ? (
              <div className="space-y-2">
                {diag.FATURAS_GRAVADAS_NO_MES.map((f, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-zinc-300 text-sm">{f.banco} ••{f.cartao}</span>
                    <span className="text-white font-black tabular-nums">{fmt(f.valor)}</span>
                  </div>
                ))}
                <div className="pt-2 border-t border-zinc-800 flex items-center justify-between">
                  <span className="text-zinc-500 text-xs uppercase font-black">Total</span>
                  <span className="text-green-400 font-black tabular-nums">{fmt(diag.soma_das_faturas_do_mes)}</span>
                </div>
                <p className="text-zinc-600 text-[11px] pt-1">
                  É este o valor que o cliente vê. Se não bate com o app do banco, use "Reimportar".
                </p>
              </div>
            ) : (
              <p className="text-zinc-500 text-sm">{diag.FATURAS_GRAVADAS_NO_MES}</p>
            )}
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <h2 className="text-xs font-black uppercase tracking-wide text-zinc-500 mb-3">Transações</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-zinc-500">Total: </span><span className="text-white font-bold">{diag.transacoes.total}</span></div>
              <div><span className="text-zinc-500">Com fatura carimbada: </span><span className="text-white font-bold">{diag.transacoes.com_bill_total_carimbado}</span></div>
              <div className="col-span-2">
                <span className="text-zinc-500">Sem vencimento: </span>
                <span className={diag.transacoes.sem_bill_due_date === diag.transacoes.total && diag.transacoes.total > 0 ? 'text-amber-400 font-bold' : 'text-white font-bold'}>
                  {diag.transacoes.sem_bill_due_date}
                </span>
                {diag.transacoes.sem_bill_due_date === diag.transacoes.total && diag.transacoes.total > 0 && (
                  <p className="text-amber-400/70 text-[11px] mt-1">
                    Nenhuma transação da fila tem vencimento. Isso não invalida a fatura acima: ela é calculada do extrato completo do cartão, que não fica gravado aqui.
                  </p>
                )}
              </div>
            </div>
          </div>

          {diag.conexoes.map((c, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white font-black text-sm">{c.banco}</span>
                <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                  c.SAUDE.consent_status === 'active' ? 'bg-green-500/15 text-green-400' : 'bg-zinc-800 text-zinc-500'
                }`}>
                  {c.SAUDE.consent_status ?? 'sem consentimento'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px] text-zinc-500">
                <div>Conectado há<br /><span className="text-zinc-300 font-bold">{horas(c.conectado_ha_horas)}</span></div>
                <div>Última sync<br /><span className="text-zinc-300 font-bold">{horas(c.SAUDE.ultima_sincronizacao_ha_horas)}</span></div>
                <div>Protocolo cartão<br /><span className="text-zinc-300 font-bold">{horas(c.SAUDE.protocolo_cartao_ha_horas)}</span></div>
              </div>
              {c.categorize_from && (
                <p className="text-[11px] text-amber-400/80 mt-2">
                  Marco de consultoria em {new Date(c.categorize_from).toLocaleDateString('pt-BR')} — só categoriza dali para frente.
                </p>
              )}
            </div>
          ))}

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-2">
            <h2 className="text-xs font-black uppercase tracking-wide text-zinc-500 mb-1">Consertar</h2>
            <button
              onClick={() => agir('limpar_duplicatas', 'Procurar e apagar transações repetidas?\n\nMantém uma de cada gasto, dando prioridade às já categorizadas.')}
              disabled={agindo}
              className="w-full py-3 rounded-xl bg-amber-500 active:bg-amber-400 disabled:opacity-50 text-black font-black text-xs uppercase tracking-wide"
            >
              <i className="fas fa-clone mr-2" />Limpar duplicatas
            </button>
            <p className="text-zinc-600 text-[11px] pb-1">
              Para fatura que SOBE a cada reimportação. Quando o banco não manda id da transação, o extrato entrava repetido e o valor inflava.
            </p>
            <button
              onClick={() => agir('reimportar', 'Apagar as faturas gravadas e os lançamentos ainda não categorizados, para reimportar do zero?\n\nO que o cliente já categorizou é preservado.')}
              disabled={agindo}
              className="w-full py-3 rounded-xl bg-green-500 active:bg-green-400 disabled:opacity-50 text-black font-black text-xs uppercase tracking-wide"
            >
              <i className="fas fa-rotate mr-2" />Reimportar do zero
            </button>
            <p className="text-zinc-600 text-[11px] pb-1">
              Para fatura que não bate com o banco ou ciclo reprojetado que não limpou. Zera as faturas gravadas e força o cron a recalcular.
            </p>
            <button
              onClick={() => agir(
                'zerar_tudo',
                'APAGAR TUDO desta casa — inclusive o que o cliente já categorizou — e importar do zero?\n\nSó use com autorização dele. Não tem volta.',
              )}
              disabled={agindo}
              className="w-full py-3 rounded-xl bg-red-600 active:bg-red-500 disabled:opacity-50 text-white font-black text-xs uppercase tracking-wide"
            >
              <i className="fas fa-triangle-exclamation mr-2" />Zerar tudo e reimportar
            </button>
            <p className="text-zinc-600 text-[11px] pb-1">
              Destrutivo: leva junto o que o cliente já categorizou. Para quando várias correções deixaram resíduo e não dá para enxergar o dado real. Peça autorização antes.
            </p>
            <button
              onClick={() => agir('virar_usuario_normal', 'Tirar o marco de consultoria? A pessoa passa a categorizar a fatura inteira, como usuário comum.')}
              disabled={agindo}
              className="w-full py-3 rounded-xl bg-zinc-800 active:bg-zinc-700 disabled:opacity-50 text-zinc-300 font-black text-xs uppercase tracking-wide border border-zinc-700"
            >
              <i className="fas fa-user-pen mr-2" />Tratar como usuário comum
            </button>
            <p className="text-zinc-600 text-[11px]">
              Para perfil criado pelo painel que não é cliente de consultoria. Rode "Reimportar" depois.
            </p>
          </div>
        </>
      )}
    </div>
  );
};

export default ExtratoDiagnostico;
