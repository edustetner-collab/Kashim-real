import React, { useMemo, useState } from 'react';
import { formatCurrency } from '../constants';
import { ContaDoFechamento, DecisaoFechamento, ResumoFechamento } from '../lib/fechamentoMes';

/**
 * Fechamento do mês — as telas.
 *
 * Uma pergunta por vez, sempre com saída. Quem pagou tudo certo sai no primeiro
 * toque; as telas seguintes só aparecem para quem tem pendência.
 *
 * Mockup validado: https://claude.ai/code/artifact/51e4f852-32b0-4dc4-8abf-5aae299036ee
 */

interface Props {
  mesNome: string;
  resumo: ResumoFechamento;
  /** Quantos meses seguidos cada conta vem sendo empurrada. */
  acumuloPorItem: Record<string, number>;
  onConcluir: (decisoes: DecisaoFechamento[]) => void;
  onAdiar: () => void;
  /** Abre o cadastro de conta variável já com o valor do acordo. */
  onCadastrarAcordo: (descricao: string, valor: number) => void;
}

type Passo = 'confirmar' | 'divergencia' | 'aberto' | 'acumulo' | 'acordoCriado';

const FechamentoMes: React.FC<Props> = ({ mesNome, resumo, acumuloPorItem, onConcluir, onAdiar, onCadastrarAcordo }) => {
  const todas = useMemo(
    () => [...resumo.semLancamento, ...resumo.divergentes],
    [resumo],
  );

  // Tudo começa como PAGO — a maioria paga e não marca. Tratar "não marcado"
  // como "não pago" criaria dívida que não existe.
  const [pagas, setPagas] = useState<Record<string, boolean>>(
    () => Object.fromEntries(todas.map(c => [c.itemId, true])),
  );
  const [valores, setValores] = useState<Record<string, number>>(
    () => Object.fromEntries(todas.map(c => [c.itemId, c.temLancamento ? c.lancado : c.previsto])),
  );
  const [parciais, setParciais] = useState<Record<string, boolean>>({});
  const [propagar, setPropagar] = useState<Record<string, boolean>>({});

  const [passo, setPasso] = useState<Passo>('confirmar');
  const [idx, setIdx] = useState(0);

  // Filas de cada passo, recalculadas a partir do que o cliente respondeu.
  const filaDivergencia = useMemo(
    () => todas.filter(c => pagas[c.itemId] && Math.abs((valores[c.itemId] ?? 0) - c.previsto) >= 0.01),
    [todas, pagas, valores],
  );
  const filaAberto = useMemo(() => todas.filter(c => !pagas[c.itemId]), [todas, pagas]);
  const filaAcumulo = useMemo(
    () => filaAberto.filter(c => (acumuloPorItem[c.itemId] ?? 0) >= 2),
    [filaAberto, acumuloPorItem],
  );

  const montarDecisoes = (): DecisaoFechamento[] =>
    todas.map(c => ({
      itemId: c.itemId,
      pago: !!pagas[c.itemId],
      valor: valores[c.itemId] ?? c.previsto,
      parcial: parciais[c.itemId],
      propagar: propagar[c.itemId],
    }));

  const avancarDe = (atual: Passo) => {
    if (atual === 'confirmar') {
      if (filaDivergencia.length) { setPasso('divergencia'); setIdx(0); return; }
      if (filaAberto.length) { setPasso('aberto'); setIdx(0); return; }
      onConcluir(montarDecisoes()); return;
    }
    if (atual === 'divergencia') {
      if (idx + 1 < filaDivergencia.length) { setIdx(idx + 1); return; }
      if (filaAberto.length) { setPasso('aberto'); setIdx(0); return; }
      onConcluir(montarDecisoes()); return;
    }
    if (atual === 'aberto') {
      if (idx + 1 < filaAberto.length) { setIdx(idx + 1); return; }
      if (filaAcumulo.length) { setPasso('acumulo'); setIdx(0); return; }
      onConcluir(montarDecisoes()); return;
    }
    // acumulo
    if (idx + 1 < filaAcumulo.length) { setIdx(idx + 1); return; }
    onConcluir(montarDecisoes());
  };

  const Sheet: React.FC<{ eyebrow: string; titulo: string; children: React.ReactNode }> = ({ eyebrow, titulo, children }) => (
    <div className="fixed inset-0 z-[320] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
      <div className="w-full sm:max-w-sm bg-white rounded-t-[26px] sm:rounded-[26px] p-5 pt-4 my-auto shadow-2xl">
        <div className="w-9 h-1 rounded-full bg-zinc-200 mx-auto mb-4" />
        <p className="text-center text-[10px] font-black uppercase tracking-[0.18em] text-green-700 mb-1">{eyebrow}</p>
        <h2 className="text-center font-black italic text-[21px] leading-tight tracking-tight text-zinc-900 mb-2">{titulo}</h2>
        {children}
      </div>
    </div>
  );

  const Botao: React.FC<{ onClick: () => void; children: React.ReactNode; tom?: 'verde' | 'ambar' | 'ghost' }> =
    ({ onClick, children, tom = 'verde' }) => (
      <button
        onClick={onClick}
        className={`block w-full rounded-2xl py-3.5 text-center font-black uppercase text-[13px] tracking-wide transition-all active:scale-[.98] ${
          tom === 'ghost'
            ? 'text-zinc-400 hover:text-zinc-600 font-bold normal-case tracking-normal text-[13px] py-2.5'
            : 'text-white'
        }`}
        style={tom === 'verde' ? { background: 'linear-gradient(180deg,#7ab800,#5c8a06)' }
          : tom === 'ambar' ? { background: 'linear-gradient(180deg,#f0a020,#c9801a)' } : undefined}
      >
        {children}
      </button>
    );

  const Foco: React.FC<{ nome: string; tag: string; alerta?: boolean }> = ({ nome, tag, alerta }) => (
    <div className={`rounded-2xl border px-4 py-3 mb-4 text-center ${alerta ? 'bg-red-50 border-red-200' : 'bg-zinc-50 border-zinc-200'}`}>
      <p className="font-black text-[15px] text-zinc-900 leading-tight">{nome}</p>
      <p className={`text-[11px] mt-0.5 tabular-nums ${alerta ? 'text-red-600' : 'text-zinc-500'}`}>{tag}</p>
    </div>
  );

  const Seta: React.FC<{ de: number; para: number; bom?: boolean }> = ({ de, para, bom }) => (
    <div className="flex items-center justify-center gap-2.5 my-2 tabular-nums">
      <span className="text-[14px] text-zinc-400 line-through">{formatCurrency(de)}</span>
      <span className="text-green-700 font-bold">→</span>
      <span className={`text-[20px] font-black ${bom ? 'text-green-700' : 'text-red-600'}`}>{formatCurrency(para)}</span>
    </div>
  );

  // ── Passo 1: confirmar pagas e valores ────────────────────────────────────
  if (passo === 'confirmar') {
    return (
      <Sheet eyebrow={`Fechando ${mesNome}`} titulo="Confirme o que você pagou">
        <p className="text-center text-[13px] text-zinc-500 leading-snug mb-4">
          Já deixamos todas como <b className="text-zinc-800 font-semibold">pagas</b>. Desmarque as que
          ficaram para trás e toque no valor se veio diferente.
        </p>

        <div className="flex flex-col gap-1.5 mb-3 max-h-[46vh] overflow-y-auto">
          {todas.map(c => {
            const paga = !!pagas[c.itemId];
            return (
              <div key={c.itemId}
                className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 ${paga ? 'bg-green-50/70 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <button
                  onClick={() => setPagas(p => ({ ...p, [c.itemId]: !paga }))}
                  aria-label={paga ? `${c.descricao}: marcada como paga` : `${c.descricao}: em aberto`}
                  className={`w-[22px] h-[22px] rounded-md shrink-0 flex items-center justify-center text-[11px] font-black ${
                    paga ? 'bg-green-700 text-white' : 'bg-white border-[1.5px] border-red-400 text-red-500'}`}>
                  {paga ? '✓' : '✕'}
                </button>
                <span className="flex-1 min-w-0">
                  <span className="block font-bold text-[13px] text-zinc-900 truncate">{c.descricao}</span>
                  {!paga && <span className="block text-[10px] text-red-600">vai para o mês seguinte</span>}
                </span>
                <input
                  type="text" inputMode="decimal"
                  value={(valores[c.itemId] ?? 0).toFixed(2).replace('.', ',')}
                  onChange={e => {
                    const n = parseFloat(e.target.value.replace(/\./g, '').replace(',', '.'));
                    setValores(v => ({ ...v, [c.itemId]: isNaN(n) ? 0 : n }));
                  }}
                  disabled={!paga}
                  className="w-[92px] text-right tabular-nums text-[12.5px] font-semibold rounded-lg border border-dashed border-zinc-300 px-2 py-1 bg-white disabled:opacity-40 outline-none focus:border-green-500"
                />
              </div>
            );
          })}
        </div>

        <p className="text-center text-[11px] text-zinc-400 mb-3">Pagou tudo pelo valor certo? É só avançar.</p>
        <Botao onClick={() => avancarDe('confirmar')}>Avançar</Botao>
        <Botao onClick={onAdiar} tom="ghost">Agora não</Botao>
      </Sheet>
    );
  }

  // ── Passo 2: valor diferente — parcial ou conta mudou? ────────────────────
  if (passo === 'divergencia') {
    const c = filaDivergencia[idx];
    if (!c) { avancarDe('divergencia'); return null; }
    const pago = valores[c.itemId] ?? 0;
    const dif = c.previsto - pago;
    const respondido = parciais[c.itemId] !== undefined || propagar[c.itemId] !== undefined;

    // 2a — escolheu "a conta agora é X": vale para os próximos meses?
    if (respondido && !parciais[c.itemId]) {
      return (
        <Sheet eyebrow="Novo valor" titulo="Vale para os próximos meses?">
          <p className="text-center text-[10px] font-black uppercase tracking-[0.14em] text-zinc-400 mb-0.5">
            {c.descricao}, daqui em diante
          </p>
          <Seta de={c.previsto} para={pago} bom={pago < c.previsto} />
          <p className="text-center text-[13px] text-zinc-500 leading-snug mt-3 mb-4">
            Atualizamos <b className="text-zinc-800 font-semibold">todos os meses seguintes</b> de uma vez,
            ou vale só para {mesNome.toLowerCase()}?
          </p>
          <Botao onClick={() => { setPropagar(p => ({ ...p, [c.itemId]: true })); avancarDe('divergencia'); }}>
            Sim, atualizar todos
          </Botao>
          <Botao onClick={() => { setPropagar(p => ({ ...p, [c.itemId]: false })); avancarDe('divergencia'); }} tom="ghost">
            Não, só {mesNome.toLowerCase()}
          </Botao>
        </Sheet>
      );
    }

    // 2b — escolheu "paguei só uma parte": a diferença vai para o mês seguinte
    if (respondido && parciais[c.itemId]) {
      return (
        <Sheet eyebrow="Pagamento parcial" titulo={`Faltaram ${formatCurrency(dif)}`}>
          <p className="text-center text-[13px] text-zinc-500 leading-snug mb-3">
            Essa diferença entra na conta do mês seguinte.
          </p>
          <p className="text-center text-[10px] font-black uppercase tracking-[0.14em] text-zinc-400 mb-0.5">
            {c.descricao}, mês seguinte
          </p>
          <Seta de={c.previsto} para={c.previsto + dif} />
          <div className="mt-4">
            <Botao onClick={() => avancarDe('divergencia')}>Confirmar</Botao>
            <Botao onClick={() => setParciais(p => { const n = { ...p }; delete n[c.itemId]; return n; })} tom="ghost">
              Voltar
            </Botao>
          </div>
        </Sheet>
      );
    }

    // A pergunta que separa os dois caminhos.
    return (
      <Sheet eyebrow={`Fechando ${mesNome}`} titulo={`${c.descricao} veio diferente`}>
        <Foco nome={c.descricao} tag={`previsto ${formatCurrency(c.previsto)} · pago ${formatCurrency(pago)}`} />
        <p className="text-center text-[13px] text-zinc-500 leading-snug mb-4">
          O que aconteceu com {dif > 0 ? 'os' : 'a diferença de'} <b className="text-zinc-800 font-semibold">{formatCurrency(Math.abs(dif))}</b>?
        </p>
        <div className="flex flex-col gap-2">
          <Botao onClick={() => { setParciais(p => ({ ...p, [c.itemId]: false })); }}>
            A conta agora é {formatCurrency(pago)}
          </Botao>
          {dif > 0 && (
            <Botao onClick={() => { setParciais(p => ({ ...p, [c.itemId]: true })); }} tom="ambar">
              Paguei só uma parte
            </Botao>
          )}
        </div>
      </Sheet>
    );
  }

  // ── Passo 3: conta que ficou em aberto ────────────────────────────────────
  if (passo === 'aberto') {
    const c = filaAberto[idx];
    if (!c) { avancarDe('aberto'); return null; }
    return (
      <Sheet eyebrow={`Fechando ${mesNome}`} titulo="Uma conta ficou em aberto">
        <Foco alerta nome={c.descricao} tag={`não paga em ${mesNome.toLowerCase()} · ${formatCurrency(c.previsto)}`} />
        <p className="text-center text-[13px] text-zinc-500 leading-snug mb-3">
          Como ela não foi paga, você vai pagar <b className="text-zinc-800 font-semibold">duas no mês seguinte</b>.
        </p>
        <p className="text-center text-[10px] font-black uppercase tracking-[0.14em] text-zinc-400 mb-0.5">
          {c.descricao}, mês seguinte
        </p>
        <Seta de={c.previsto} para={c.previsto * 2} />
        <p className="text-center text-[11px] text-zinc-400 mt-3 mb-3">É isso mesmo?</p>
        <Botao onClick={() => avancarDe('aberto')}>Confirmar</Botao>
        <Botao onClick={() => { setPagas(p => ({ ...p, [c.itemId]: true })); setPasso('confirmar'); setIdx(0); }} tom="ghost">
          Voltar
        </Botao>
      </Sheet>
    );
  }

  // ── Confirmação depois de criar o acordo ──────────────────────────────────
  if (passo === 'acordoCriado') {
    const c = filaAcumulo[idx];
    return (
      <Sheet eyebrow="Pronto" titulo="Acordo criado">
        <p className="text-center text-[13px] text-zinc-500 leading-snug mb-4">
          Criamos <b className="text-zinc-800 font-semibold">Acordo {c?.descricao}</b> em{' '}
          <b className="text-zinc-800 font-semibold">Custos Variáveis</b>. É só informar o
          valor da parcela que você negociou.
        </p>
        <div className="rounded-2xl bg-green-50 border border-green-200 px-4 py-3 mb-4">
          <p className="text-[11.5px] text-green-900 leading-snug text-center">
            Entra como variável de propósito: assim o acordo consome a sobra do mês sem
            pesar no seu percentual de conta fixa.
          </p>
        </div>
        <Botao onClick={() => { setPasso('acumulo'); avancarDe('acumulo'); }}>Entendi</Botao>
      </Sheet>
    );
  }

  // ── Passo 4: acumulou três meses ──────────────────────────────────────────
  const c = filaAcumulo[idx];
  if (!c) { onConcluir(montarDecisoes()); return null; }
  const meses = (acumuloPorItem[c.itemId] ?? 0) + 1;
  const total = c.previsto * meses;
  return (
    <Sheet eyebrow={`${meses}º mês em aberto`} titulo={`${c.descricao} está acumulando`}>
      <p className="text-center text-[13px] text-zinc-500 leading-snug mb-3">
        São <b className="text-zinc-800 font-semibold">{meses} meses sem pagar</b>, somando{' '}
        <b className="text-zinc-800 font-semibold">{formatCurrency(total)}</b>. Normalmente é aqui que se
        negocia com a empresa.
      </p>
      <div className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3 mb-4 text-center">
        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Em aberto</p>
        <p className="text-[22px] font-black text-red-600 tabular-nums leading-tight">{formatCurrency(total)}</p>
      </div>
      <p className="text-center text-[11px] text-zinc-400 mb-3">Você já negociou um parcelamento?</p>
      <Botao onClick={() => { onCadastrarAcordo(`Acordo ${c.descricao}`, total); setPasso('acordoCriado'); }}>
        Sim, vou cadastrar o acordo
      </Botao>
      <Botao onClick={() => avancarDe('acumulo')} tom="ghost">Ainda não · continuar acumulando</Botao>
    </Sheet>
  );
};

export default FechamentoMes;
