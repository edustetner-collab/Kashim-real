import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { formatCurrency } from '../constants';
import { Debt, loadDebts, saveDebt, deleteDebt } from '../lib/debts';

interface DividasProps {
  householdId: string | null;
}

const emptyDebt = (householdId: string, sortOrder: number): Debt => ({
  id: `new-${crypto.randomUUID()}`,
  household_id: householdId,
  name: '',
  installment_value: 0,
  installment_count: 0,
  payoff_value: 0,
  interest_rate: null,
  sort_order: sortOrder,
});

const isTemp = (id: string) => id.startsWith('new-');

const Dividas: React.FC<DividasProps> = ({ householdId }) => {
  const { getToken } = useAuth();
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!householdId) { setLoading(false); return; }
    if (loadedFor.current === householdId) return;
    loadedFor.current = householdId;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken({ template: 'supabase' });
        if (token) setDebts(await loadDebts(token, householdId));
      } catch { /* silencioso */ }
      setLoading(false);
    })();
  }, [householdId, getToken]);

  const updateLocal = (id: string, patch: Partial<Debt>) =>
    setDebts(prev => prev.map(d => (d.id === id ? { ...d, ...patch } : d)));

  // Salva no blur — evita corrida de gravação. Troca o id temporário pelo real.
  const persist = async (debt: Debt) => {
    if (!householdId) return;
    if (!debt.name.trim() && !debt.installment_value && !debt.payoff_value) return; // linha vazia, não grava
    setSavingId(debt.id);
    try {
      const token = await getToken({ template: 'supabase' });
      if (!token) return;
      const saved = await saveDebt(token, householdId, isTemp(debt.id) ? { ...debt, id: undefined } : debt);
      if (saved) setDebts(prev => prev.map(d => (d.id === debt.id ? saved : d)));
    } catch {
      // mantém local; usuário pode tentar de novo
    } finally {
      setSavingId(null);
    }
  };

  const removeDebt = async (id: string) => {
    setConfirmDelete(null);
    const target = debts.find(d => d.id === id);
    setDebts(prev => prev.filter(d => d.id !== id));
    if (target && !isTemp(id) && householdId) {
      try {
        const token = await getToken({ template: 'supabase' });
        if (token) await deleteDebt(token, householdId, id);
      } catch { /* silencioso */ }
    }
  };

  const addDebt = () =>
    setDebts(prev => [...prev, emptyDebt(householdId ?? '', prev.length)]);

  const totals = debts.reduce(
    (acc, d) => {
      const semDesconto = d.installment_value * d.installment_count;
      acc.payoff += d.payoff_value;
      acc.semDesconto += semDesconto;
      acc.economia += semDesconto - d.payoff_value;
      return acc;
    },
    { payoff: 0, semDesconto: 0, economia: 0 }
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <i className="fas fa-circle-notch animate-spin text-[#7ab800] text-3xl"></i>
      </div>
    );
  }

  return (
    <div className="px-3 lg:px-0 pb-24 max-w-[1100px] mx-auto animate-in fade-in duration-500">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between mb-4 pt-2">
        <div>
          <h2 className="text-[#1d1d1f] font-black text-xl uppercase italic tracking-tighter">Dívidas</h2>
          <p className="text-[#6e6e73] text-xs mt-0.5">Empréstimos e dívidas em aberto do cliente</p>
        </div>
        <button onClick={addDebt} className="k-btn-lime px-4 py-2.5 flex items-center gap-2 shrink-0">
          <i className="fas fa-plus-circle"></i> Adicionar
        </button>
      </div>

      {debts.length === 0 ? (
        <div className="bg-white border border-[#e8e8ed] rounded-3xl p-10 text-center shadow-sm">
          <i className="fas fa-file-invoice-dollar text-4xl text-[#d2d2d7] mb-3 block"></i>
          <p className="text-[#1d1d1f] font-black uppercase text-sm tracking-wide">Nenhuma dívida cadastrada</p>
          <p className="text-[#aeaeb2] text-xs mt-2">Toque em "Adicionar" para registrar um empréstimo</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {debts.map(debt => {
            const semDesconto = debt.installment_value * debt.installment_count;
            const economia = semDesconto - debt.payoff_value;
            return (
              <div key={debt.id} className="bg-white border border-[#e8e8ed] rounded-[22px] shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-[#f0f0f2]">
                  <i className="fas fa-landmark text-[#aeaeb2] text-sm"></i>
                  <input
                    value={debt.name}
                    onChange={e => updateLocal(debt.id, { name: e.target.value })}
                    onBlur={() => persist(debt)}
                    placeholder="Nome do empréstimo (ex: Empréstimo 1 - BB)"
                    className="flex-1 bg-transparent outline-none text-[#1d1d1f] font-black text-sm placeholder:text-[#c7c7cc] placeholder:font-medium"
                  />
                  {savingId === debt.id && <i className="fas fa-circle-notch animate-spin text-[#7ab800] text-xs"></i>}
                  <button
                    onClick={() => setConfirmDelete(confirmDelete === debt.id ? null : debt.id)}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${confirmDelete === debt.id ? 'bg-[#ff3b30] text-white' : 'bg-[#fff0f0] text-[#ff3b30]'}`}
                  >
                    <i className="fas fa-trash text-[11px]"></i>
                  </button>
                </div>

                {confirmDelete === debt.id && (
                  <div className="bg-[#fff0f0] px-4 py-2 flex items-center justify-between">
                    <span className="text-[#ff3b30] text-xs font-bold">Excluir esta dívida?</span>
                    <div className="flex gap-2">
                      <button onClick={() => setConfirmDelete(null)} className="text-[#6e6e73] text-xs font-black uppercase px-2">Cancelar</button>
                      <button onClick={() => removeDebt(debt.id)} className="bg-[#ff3b30] text-white text-xs font-black uppercase px-3 py-1 rounded-lg">Excluir</button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[#f0f0f2]">
                  <Field label="Valor da parcela" prefix="R$">
                    <NumInput value={debt.installment_value} onChange={v => updateLocal(debt.id, { installment_value: v })} onBlur={() => persist(debt)} />
                  </Field>
                  <Field label="Qtd. parcelas">
                    <NumInput value={debt.installment_count} onChange={v => updateLocal(debt.id, { installment_count: v })} onBlur={() => persist(debt)} integer />
                  </Field>
                  <Field label="Valor de quitação" prefix="R$">
                    <NumInput value={debt.payoff_value} onChange={v => updateLocal(debt.id, { payoff_value: v })} onBlur={() => persist(debt)} />
                  </Field>
                  <Field label="Taxa de juros (a.m.)" suffix="%">
                    <NumInput value={debt.interest_rate ?? 0} onChange={v => updateLocal(debt.id, { interest_rate: v })} onBlur={() => persist(debt)} />
                  </Field>
                </div>

                {/* Calculados */}
                <div className="grid grid-cols-2 gap-px bg-[#f0f0f2]">
                  <div className="bg-[#f5f5f7] px-4 py-2.5">
                    <p className="text-[9px] font-black uppercase tracking-wider text-[#aeaeb2]">Total sem desconto</p>
                    <p className="text-[#1d1d1f] font-black k-num text-sm">{formatCurrency(semDesconto)}</p>
                  </div>
                  <div className={`px-4 py-2.5 ${economia > 0 ? 'bg-[#f0fad0]' : 'bg-[#f5f5f7]'}`}>
                    <p className="text-[9px] font-black uppercase tracking-wider text-[#aeaeb2]">Economia na quitação</p>
                    <p className={`font-black k-num text-sm ${economia > 0 ? 'text-[#7ab800]' : 'text-[#1d1d1f]'}`}>{formatCurrency(economia)}</p>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Totais gerais */}
          <div className="bg-[#1d1d1f] rounded-[22px] p-5 mt-2 grid grid-cols-3 gap-3">
            <TotalCard label="Total quitação" value={totals.payoff} color="text-white" />
            <TotalCard label="Sem desconto" value={totals.semDesconto} color="text-[#ff6b6b]" />
            <TotalCard label="Economia total" value={totals.economia} color="text-[#a8e716]" />
          </div>
        </div>
      )}
    </div>
  );
};

const Field: React.FC<{ label: string; prefix?: string; suffix?: string; children: React.ReactNode }> = ({ label, prefix, suffix, children }) => (
  <div className="bg-white px-4 py-2.5">
    <p className="text-[9px] font-black uppercase tracking-wider text-[#aeaeb2] mb-1">{label}</p>
    <div className="flex items-center gap-1">
      {prefix && <span className="text-[#c7c7cc] text-xs font-mono">{prefix}</span>}
      {children}
      {suffix && <span className="text-[#c7c7cc] text-xs font-mono">{suffix}</span>}
    </div>
  </div>
);

const NumInput: React.FC<{ value: number; onChange: (v: number) => void; onBlur: () => void; integer?: boolean }> = ({ value, onChange, onBlur, integer }) => {
  const [text, setText] = useState(value ? String(value) : '');
  useEffect(() => { setText(value ? String(value) : ''); }, [value]);
  return (
    <input
      type="number"
      inputMode={integer ? 'numeric' : 'decimal'}
      value={text}
      onChange={e => {
        setText(e.target.value);
        const n = integer ? parseInt(e.target.value) : parseFloat(e.target.value.replace(',', '.'));
        onChange(isNaN(n) ? 0 : n);
      }}
      onBlur={onBlur}
      placeholder="0"
      className="flex-1 min-w-0 bg-transparent outline-none text-[#1d1d1f] font-black k-num text-sm placeholder:text-[#c7c7cc]"
    />
  );
};

const TotalCard: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <div className="text-center">
    <p className="text-white/40 text-[9px] font-black uppercase tracking-wider mb-1">{label}</p>
    <p className={`${color} font-black k-num text-sm lg:text-base leading-tight`}>{formatCurrency(value)}</p>
  </div>
);

export default Dividas;
