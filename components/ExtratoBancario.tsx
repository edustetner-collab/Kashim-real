import React, { useState, useEffect, useCallback } from 'react';
import { CategoryType, FinanceItem, PartialExpense } from '../types';
import type { BankTransaction } from '../lib/openfinance/types';
import { merchantKey } from '../lib/openfinance/categoryMap';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  householdId: string;
  authToken: string;
  items: FinanceItem[];
  currentYear: number;
  currentMonth: number; // 0-indexed
  onAddPartial: (itemId: string, expense: PartialExpense, year?: number, month?: number) => void;
  onClose: () => void;
}

// ─── Category display config ──────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  [CategoryType.INCOME]:           { label: 'Renda',    color: '#34c759', icon: 'fa-arrow-down'      },
  [CategoryType.FIXED_EXPENSE]:    { label: 'Fixa',     color: '#007aff', icon: 'fa-house'           },
  [CategoryType.VARIABLE_EXPENSE]: { label: 'Variável', color: '#ff9500', icon: 'fa-cart-shopping'   },
  [CategoryType.PERSONAL_LEISURE]: { label: 'Lazer',    color: '#af52de', icon: 'fa-star'            },
  [CategoryType.CREDIT_CARD]:      { label: 'Cartão',   color: '#ff3b30', icon: 'fa-credit-card'     },
};

function formatCurrencyBR(val: number) {
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateBR(iso: string) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

// ─── Inline category+item picker ──────────────────────────────────────────────

interface PickerProps {
  tx: BankTransaction;
  items: FinanceItem[];
  onConfirm: (itemId: string, category: CategoryType) => void;
  onIgnore: () => void;
  onClose: () => void;
}

function CategoryPicker({ tx, items, onConfirm, onIgnore, onClose }: PickerProps) {
  const [selectedCategory, setSelectedCategory] = useState<CategoryType | null>(
    tx.suggestedCategory as CategoryType | null
  );
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const availableCategories = Object.values(CategoryType).filter(
    (c) => c !== CategoryType.INCOME || tx.transactionType === 'income'
  );

  const itemsForCategory = selectedCategory
    ? items.filter((i) => i.category === selectedCategory)
    : [];

  // Auto-select first item when category changes
  useEffect(() => {
    if (itemsForCategory.length > 0) {
      setSelectedItemId(itemsForCategory[0].id);
    } else {
      setSelectedItemId(null);
    }
  }, [selectedCategory]);

  const canConfirm = selectedCategory !== null && (
    selectedCategory === CategoryType.INCOME ? true : selectedItemId !== null
  );

  function handleConfirm() {
    if (!selectedCategory) return;
    const itemId = selectedItemId ?? itemsForCategory[0]?.id ?? '';
    onConfirm(itemId, selectedCategory);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-white rounded-t-2xl p-5 pb-8 shadow-2xl animate-slide-up">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs text-[#6e6e73] uppercase tracking-wide font-semibold">
              {tx.accountType === 'credit_card' ? 'Cartão' : 'Conta'} · {formatDateBR(tx.transactionDate)}
            </p>
            <p className="font-semibold text-[#1d1d1f] text-sm mt-0.5 leading-snug max-w-[260px]">
              {tx.description}
            </p>
          </div>
          <span className={`font-black text-base ${tx.transactionType === 'income' ? 'text-[#34c759]' : 'text-[#1d1d1f]'}`}>
            {tx.transactionType === 'income' ? '+' : ''}{formatCurrencyBR(Number(tx.amount))}
          </span>
        </div>

        {/* Category chips */}
        <p className="text-xs font-semibold text-[#6e6e73] mb-2">CATEGORIA</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {availableCategories.map((cat) => {
            const cfg = CATEGORY_CONFIG[cat];
            const active = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all"
                style={{
                  borderColor: active ? cfg.color : '#e5e5ea',
                  background: active ? cfg.color + '18' : 'white',
                  color: active ? cfg.color : '#6e6e73',
                }}
              >
                <i className={`fas ${cfg.icon}`} />
                {cfg.label}
              </button>
            );
          })}
        </div>

        {/* Item selector */}
        {selectedCategory && selectedCategory !== CategoryType.INCOME && (
          <>
            <p className="text-xs font-semibold text-[#6e6e73] mb-2">ITEM DO PLANO</p>
            {itemsForCategory.length === 0 ? (
              <p className="text-xs text-[#aeaeb2] italic mb-4">
                Nenhum item nessa categoria. Crie primeiro no plano.
              </p>
            ) : (
              <div className="flex flex-col gap-1 max-h-32 overflow-y-auto mb-4">
                {itemsForCategory.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedItemId(item.id)}
                    className={`text-left px-3 py-2 rounded-xl text-sm transition-all border-2 ${
                      selectedItemId === item.id
                        ? 'border-[#7ab800] bg-[#f0fad0] text-[#1d1d1f] font-semibold'
                        : 'border-[#e5e5ea] text-[#3a3a3c]'
                    }`}
                  >
                    {item.description}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-1">
          <button
            onClick={onIgnore}
            className="flex-1 py-3 rounded-xl text-sm font-semibold text-[#aeaeb2] border-2 border-[#e5e5ea] transition-all"
          >
            Ignorar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="flex-2 flex-grow py-3 rounded-xl text-sm font-bold transition-all"
            style={{
              background: canConfirm ? '#7ab800' : '#e5e5ea',
              color: canConfirm ? 'white' : '#aeaeb2',
            }}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Transaction row ──────────────────────────────────────────────────────────

interface TxRowProps {
  tx: BankTransaction;
  onSelect: (tx: BankTransaction) => void;
}

const TxRow: React.FC<TxRowProps> = ({ tx, onSelect }) => {
  const isIncome = tx.transactionType === 'income';
  const suggested = tx.suggestedCategory ? CATEGORY_CONFIG[tx.suggestedCategory] : null;

  return (
    <button
      onClick={() => onSelect(tx)}
      className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-[#f5f5f7] active:bg-[#ebebed] transition-colors border-b border-[#f0f0f0] last:border-0"
    >
      {/* Direction icon */}
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: isIncome ? '#34c75918' : '#ff950018' }}
      >
        <i
          className={`fas ${isIncome ? 'fa-arrow-down text-[#34c759]' : 'fa-arrow-up text-[#ff9500]'} text-sm`}
        />
      </div>

      {/* Description + meta */}
      <div className="flex-1 min-w-0">
        <p className="text-[#1d1d1f] text-sm font-semibold truncate leading-snug">
          {tx.description}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className="text-xs text-[#aeaeb2]">{formatDateBR(tx.transactionDate)}</span>
          {tx.installmentCurrent && tx.installmentTotal && (
            <span className="text-xs text-[#aeaeb2]">
              · {tx.installmentCurrent}/{tx.installmentTotal}x
            </span>
          )}
          {suggested && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: suggested.color + '18', color: suggested.color }}
            >
              {suggested.label}
            </span>
          )}
          {tx.accountType === 'credit_card' && tx.cardLast4 && (
            <span className="text-[10px] text-[#aeaeb2]">···{tx.cardLast4}</span>
          )}
        </div>
      </div>

      {/* Amount */}
      <span className={`font-black text-sm flex-shrink-0 ${isIncome ? 'text-[#34c759]' : 'text-[#1d1d1f]'}`}>
        {isIncome ? '+' : ''}{formatCurrencyBR(Number(tx.amount))}
      </span>
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ExtratoBancario({
  householdId,
  authToken,
  items,
  currentYear,
  currentMonth,
  onAddPartial,
  onClose,
}: Props) {
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTx, setActiveTx] = useState<BankTransaction | null>(null);
  const [filter, setFilter] = useState<'all' | 'expense' | 'income'>('all');

  // ── Load pending transactions ──────────────────────────────────────────────

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ householdId, status: 'pending', limit: '200' });
      const r = await fetch(`/api/of-transactions?${params}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const json = await r.json();
      setTransactions(json.transactions ?? []);
    } catch {
      // Silently degrade — user sees empty list
    } finally {
      setLoading(false);
    }
  }, [householdId, authToken]);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  // ── Categorize ─────────────────────────────────────────────────────────────

  async function handleConfirm(tx: BankTransaction, itemId: string, category: CategoryType) {
    // CC: land in the bill due month; account: use transaction date
    const dateStr = tx.billDueDate ?? tx.transactionDate;
    const [year, rawMonth] = dateStr.split('-').map(Number);
    const month = rawMonth - 1; // 0-indexed

    const partial: PartialExpense = {
      id: crypto.randomUUID(),
      date: tx.transactionDate,
      description: tx.description ?? '',
      value: Number(tx.amount),
    };

    // 1. Update local state instantly
    onAddPartial(itemId, partial, year, month);
    setActiveTx(null);
    setTransactions((prev) => prev.filter((t) => t.transactionId !== tx.transactionId));

    // 2. Mark as categorized in DB (fire-and-forget)
    fetch('/api/of-transactions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        householdId,
        transactionId: tx.transactionId,
        action: 'categorize',
        itemId,
        category,
        partialId: partial.id,
      }),
    }).catch(() => {/* non-critical */});

    // 3. Update merchant memory (fire-and-forget)
    const key = merchantKey(tx.description ?? '');
    if (key) {
      fetch('/api/of-merchant-memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ householdId, merchantKey: key, category, itemId }),
      }).catch(() => {/* non-critical */});
    }
  }

  async function handleIgnore(tx: BankTransaction) {
    setActiveTx(null);
    setTransactions((prev) => prev.filter((t) => t.transactionId !== tx.transactionId));
    fetch('/api/of-transactions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ householdId, transactionId: tx.transactionId, action: 'ignore' }),
    }).catch(() => {/* non-critical */});
  }

  // ── Filter + sort ──────────────────────────────────────────────────────────

  const displayed = transactions
    .filter((t) => filter === 'all' || t.transactionType === filter)
    .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));

  const expenseCount = transactions.filter((t) => t.transactionType === 'expense').length;
  const incomeCount = transactions.filter((t) => t.transactionType === 'income').length;
  const totalExpense = transactions
    .filter((t) => t.transactionType === 'expense')
    .reduce((s, t) => s + Number(t.amount), 0);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#f2f2f7]">
      {/* Header */}
      <div className="bg-white border-b border-[#e5e5ea] px-4 pt-4 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-black text-[#1d1d1f]">Extrato bancário</h2>
            <p className="text-xs text-[#6e6e73]">
              {transactions.length === 0
                ? 'Tudo em dia!'
                : `${transactions.length} transaç${transactions.length === 1 ? 'ão' : 'ões'} a categorizar`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#e5e5ea] flex items-center justify-center"
          >
            <i className="fas fa-xmark text-[#1d1d1f] text-sm" />
          </button>
        </div>

        {/* Summary pills */}
        {transactions.length > 0 && (
          <div className="flex gap-2 mb-3">
            <div className="flex-1 bg-[#ff950012] rounded-xl px-3 py-2 text-center">
              <p className="text-[10px] font-bold text-[#ff9500] uppercase">Despesas</p>
              <p className="text-sm font-black text-[#1d1d1f]">{formatCurrencyBR(totalExpense)}</p>
              <p className="text-[10px] text-[#aeaeb2]">{expenseCount} itens</p>
            </div>
            {incomeCount > 0 && (
              <div className="flex-1 bg-[#34c75912] rounded-xl px-3 py-2 text-center">
                <p className="text-[10px] font-bold text-[#34c759] uppercase">Receitas</p>
                <p className="text-sm font-black text-[#1d1d1f]">{incomeCount}</p>
                <p className="text-[10px] text-[#aeaeb2]">itens</p>
              </div>
            )}
          </div>
        )}

        {/* Filter tabs */}
        {transactions.length > 0 && (
          <div className="flex gap-1 bg-[#f2f2f7] rounded-xl p-1">
            {(['all', 'expense', 'income'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  filter === f ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#6e6e73]'
                }`}
              >
                {f === 'all' ? 'Todos' : f === 'expense' ? 'Despesas' : 'Receitas'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Transaction list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <i className="fas fa-circle-notch fa-spin text-[#7ab800] text-2xl" />
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-60 gap-3 px-8 text-center">
            <i className="fas fa-check-circle text-[#7ab800] text-4xl" />
            <p className="font-bold text-[#1d1d1f]">
              {transactions.length === 0
                ? 'Nenhuma transação pendente'
                : 'Nenhuma transação nesse filtro'}
            </p>
            <p className="text-sm text-[#6e6e73]">
              {transactions.length === 0
                ? 'Quando a Technospeed sincronizar, as transações aparecerão aqui.'
                : 'Tente mudar o filtro acima.'}
            </p>
          </div>
        ) : (
          <div className="bg-white mt-2 mx-2 rounded-2xl overflow-hidden shadow-sm">
            {displayed.map((tx) => (
              <TxRow key={tx.transactionId} tx={tx} onSelect={setActiveTx} />
            ))}
          </div>
        )}

        {/* Bottom padding for safe area */}
        <div className="h-8" />
      </div>

      {/* Category picker modal */}
      {activeTx && (
        <CategoryPicker
          tx={activeTx}
          items={items}
          onConfirm={(itemId, category) => handleConfirm(activeTx, itemId, category)}
          onIgnore={() => handleIgnore(activeTx)}
          onClose={() => setActiveTx(null)}
        />
      )}
    </div>
  );
}
