
import React, { useState } from 'react';
import { Goal } from '../types';
import { formatCurrency } from '../constants';
import { SupabaseClient } from '@supabase/supabase-js';
import { saveGoal, deleteGoal } from '../lib/db';

interface MetasProps {
  goals: Goal[];
  onGoalsChange: (goals: Goal[]) => void;
  db?: SupabaseClient | null;
  householdId?: string | null;
}

const EMOJI_OPTIONS = ['🎯','🏖️','🚗','🏠','📚','✈️','💍','🎓','🐶','💻','🎸','🏋️','🍽️','👶','🌍','💊','🎁','🏦','🛡️','🌱'];

interface GoalForm {
  title: string;
  emoji: string;
  targetAmount: string;
  deadline: string;
}

const EMPTY_FORM: GoalForm = { title: '', emoji: '🎯', targetAmount: '', deadline: '' };

function ProgressRing({ pct, size = 80 }: { pct: number; size?: number }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(pct, 100) / 100) * circ;
  const isComplete = pct >= 100;
  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e8e8ed" strokeWidth="6" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={isComplete ? '#7ab800' : '#a8e716'}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        className="transition-all duration-700"
      />
    </svg>
  );
}

const Metas: React.FC<MetasProps> = ({ goals, onGoalsChange, db, householdId }) => {
  const [showModal, setShowModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [form, setForm] = useState<GoalForm>(EMPTY_FORM);
  const [showContribModal, setShowContribModal] = useState<Goal | null>(null);
  const [contribValue, setContribValue] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('all');
  const [emojiOpen, setEmojiOpen] = useState(false);

  const activeGoals = goals.filter(g => g.currentAmount < g.targetAmount);
  const doneGoals = goals.filter(g => g.targetAmount > 0 && g.currentAmount >= g.targetAmount);
  const displayed = filter === 'active' ? activeGoals : filter === 'done' ? doneGoals : goals;

  function openCreate() {
    setEditingGoal(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  }

  function openEdit(g: Goal) {
    setEditingGoal(g);
    setForm({
      title: g.title,
      emoji: g.emoji,
      targetAmount: g.targetAmount > 0 ? String(g.targetAmount) : '',
      deadline: g.deadline ?? '',
    });
    setShowModal(true);
  }

  async function handleSave() {
    const target = parseFloat(form.targetAmount);
    if (!form.title.trim() || isNaN(target) || target <= 0) return;

    const goal: Goal = editingGoal
      ? { ...editingGoal, title: form.title, emoji: form.emoji, targetAmount: target, deadline: form.deadline || undefined }
      : {
          id: crypto.randomUUID(),
          title: form.title,
          emoji: form.emoji,
          targetAmount: target,
          currentAmount: 0,
          deadline: form.deadline || undefined,
          createdAt: new Date().toISOString(),
        };

    const next = editingGoal
      ? goals.map(g => g.id === goal.id ? goal : g)
      : [...goals, goal];

    onGoalsChange(next);
    if (db && householdId) saveGoal(db, householdId, goal).catch(() => {});
    setShowModal(false);
  }

  async function handleDelete(id: string) {
    const next = goals.filter(g => g.id !== id);
    onGoalsChange(next);
    if (db) deleteGoal(db, id).catch(() => {});
  }

  async function handleContrib() {
    if (!showContribModal) return;
    const val = parseFloat(contribValue);
    if (isNaN(val) || val <= 0) return;
    const updated: Goal = { ...showContribModal, currentAmount: showContribModal.currentAmount + val };
    const next = goals.map(g => g.id === updated.id ? updated : g);
    onGoalsChange(next);
    if (db && householdId) saveGoal(db, householdId, updated).catch(() => {});
    setContribValue('');
    setShowContribModal(null);
  }

  function daysLeft(deadline?: string): number | null {
    if (!deadline) return null;
    const diff = new Date(deadline).getTime() - Date.now();
    return Math.ceil(diff / 86400000);
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4 pb-28">

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-[#1d1d1f] text-xl font-black italic uppercase tracking-tighter">
            <i className="fas fa-bullseye text-[#7ab800] mr-2"></i>Metas
          </h2>
          <p className="text-[#aeaeb2] text-xs mt-0.5">{doneGoals.length} de {goals.length} conquistadas</p>
        </div>
        <button
          onClick={openCreate}
          className="k-btn-lime px-5 py-2.5 flex items-center gap-2"
        >
          <i className="fas fa-plus"></i> Nova Meta
        </button>
      </div>

      {/* Filter tabs */}
      {goals.length > 0 && (
        <div className="flex gap-1 mb-5 bg-[#f5f5f7] p-1 rounded-xl border border-[#e8e8ed]">
          {([['all','Todas'],['active','Ativas'],['done','Conquistadas']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${filter === key ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#aeaeb2]'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Goals list */}
      {goals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-6xl mb-4">🎯</div>
          <p className="text-[#1d1d1f] font-black uppercase italic text-lg tracking-tighter">Nenhuma meta ainda</p>
          <p className="text-[#6e6e73] text-sm mt-1 mb-6">Defina objetivos e acompanhe o progresso rumo à riqueza.</p>
          <button
            onClick={openCreate}
            className="k-btn-lime px-8 py-3"
          >
            Criar primeira meta
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {displayed.map(goal => {
            const pct = goal.targetAmount > 0 ? (goal.currentAmount / goal.targetAmount) * 100 : 0;
            const isComplete = pct >= 100;
            const days = daysLeft(goal.deadline);
            const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);

            return (
              <div
                key={goal.id}
                className={`relative rounded-2xl border overflow-hidden transition-all ${
                  isComplete
                    ? 'bg-[#f0fad0] border-[rgba(122,184,0,0.25)] shadow-sm'
                    : 'bg-white border-[#e8e8ed]'
                }`}
              >
                {isComplete && (
                  <div className="absolute top-0 left-0 right-0 h-0.5" style={{background:'linear-gradient(90deg,#a8e716,#7ab800,#a8e716)'}}></div>
                )}

                <div className="p-4 flex gap-4 items-start">
                  {/* Progress ring + emoji */}
                  <div className="relative shrink-0">
                    <ProgressRing pct={pct} size={72} />
                    <div className="absolute inset-0 flex items-center justify-center text-2xl">
                      {goal.emoji}
                    </div>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className={`font-black text-sm uppercase tracking-tight leading-tight ${isComplete ? 'text-[#7ab800]' : 'text-[#1d1d1f]'}`}>
                          {goal.title}
                        </h3>
                        {isComplete && (
                          <span className="inline-flex items-center gap-1 mt-0.5 bg-[#f0fad0] border border-[rgba(122,184,0,0.3)] text-[#7ab800] text-[9px] font-black uppercase px-2 py-0.5 rounded-full">
                            <i className="fas fa-trophy text-[8px]"></i> Conquistada!
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => openEdit(goal)} className="w-7 h-7 rounded-lg bg-[#f5f5f7] border border-[#e8e8ed] text-[#aeaeb2] active:text-[#7ab800] flex items-center justify-center text-xs transition-colors">
                          <i className="fas fa-pen"></i>
                        </button>
                        <button onClick={() => handleDelete(goal.id)} className="w-7 h-7 rounded-lg bg-[#f5f5f7] border border-[#e8e8ed] text-[#aeaeb2] active:text-[#ff3b30] flex items-center justify-center text-xs transition-colors">
                          <i className="fas fa-trash-alt"></i>
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 flex items-end justify-between">
                      <div>
                        <div className="font-black k-num text-base leading-none text-[#7ab800]">
                          {formatCurrency(goal.currentAmount)}
                        </div>
                        <div className="text-[#aeaeb2] text-[10px] k-num mt-0.5">
                          de {formatCurrency(goal.targetAmount)} • {pct.toFixed(0)}%
                        </div>
                      </div>
                      {!isComplete && (
                        <button
                          onClick={() => { setShowContribModal(goal); setContribValue(''); }}
                          className="k-btn-lime px-3 py-1.5"
                        >
                          + Contribuir
                        </button>
                      )}
                    </div>

                    {/* Progress bar */}
                    <div className="mt-3 h-1.5 bg-[#e8e8ed] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${Math.min(pct, 100)}%`, background: isComplete ? '#7ab800' : 'linear-gradient(90deg,#a8e716,#7ab800)' }}
                      />
                    </div>

                    {/* Deadline + remaining */}
                    <div className="mt-1.5 flex items-center gap-3 text-[9px]">
                      {!isComplete && remaining > 0 && (
                        <span className="text-[#aeaeb2] k-num">faltam {formatCurrency(remaining)}</span>
                      )}
                      {days !== null && !isComplete && (
                        <span className={`font-black ${days < 0 ? 'text-[#ff3b30]' : days < 30 ? 'text-orange-500' : 'text-[#aeaeb2]'}`}>
                          {days < 0 ? `${Math.abs(days)}d atrasada` : days === 0 ? 'Vence hoje!' : `${days}d restantes`}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-[300] flex items-end justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)}>
          <div className="w-full max-w-md bg-white border border-[#e8e8ed] rounded-t-3xl p-6 pb-10 animate-in slide-in-from-bottom-4" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-[#e8e8ed] rounded-full mx-auto mb-5"></div>
            <h3 className="text-[#1d1d1f] font-black uppercase italic tracking-tighter text-lg mb-5">
              {editingGoal ? 'Editar Meta' : 'Nova Meta'}
            </h3>

            {/* Emoji picker */}
            <div className="mb-4">
              <label className="text-[#aeaeb2] text-[10px] font-black uppercase tracking-widest block mb-2">Ícone</label>
              <button
                onClick={() => setEmojiOpen(v => !v)}
                className="w-14 h-14 bg-[#f5f5f7] border border-[#e8e8ed] rounded-2xl text-3xl flex items-center justify-center hover:border-[#a8e716] transition-colors"
              >
                {form.emoji}
              </button>
              {emojiOpen && (
                <div className="mt-2 grid grid-cols-10 gap-1 bg-[#f5f5f7] border border-[#e8e8ed] rounded-2xl p-3">
                  {EMOJI_OPTIONS.map(e => (
                    <button key={e} onClick={() => { setForm(f => ({...f, emoji: e})); setEmojiOpen(false); }} className="text-2xl p-1 rounded-lg hover:bg-[#e8e8ed] transition-colors">{e}</button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 mb-5">
              <div>
                <label className="text-[#aeaeb2] text-[10px] font-black uppercase tracking-widest block mb-1">Nome da meta</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm(f => ({...f, title: e.target.value}))}
                  placeholder="Ex: Viagem para o Japão"
                  className="w-full bg-[#f5f5f7] border border-[#e8e8ed] text-[#1d1d1f] placeholder:text-[#aeaeb2] rounded-xl px-4 py-3 text-sm outline-none focus:border-[#a8e716]"
                />
              </div>
              <div>
                <label className="text-[#aeaeb2] text-[10px] font-black uppercase tracking-widest block mb-1">Valor alvo (R$)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={form.targetAmount}
                  onChange={e => setForm(f => ({...f, targetAmount: e.target.value}))}
                  placeholder="0,00"
                  className="w-full bg-[#f5f5f7] border border-[#e8e8ed] text-[#1d1d1f] placeholder:text-[#aeaeb2] rounded-xl px-4 py-3 text-sm outline-none focus:border-[#a8e716] k-num"
                />
              </div>
              <div>
                <label className="text-[#aeaeb2] text-[10px] font-black uppercase tracking-widest block mb-1">Prazo (opcional)</label>
                <input
                  type="date"
                  value={form.deadline}
                  onChange={e => setForm(f => ({...f, deadline: e.target.value}))}
                  className="w-full bg-[#f5f5f7] border border-[#e8e8ed] text-[#1d1d1f] rounded-xl px-4 py-3 text-sm outline-none focus:border-[#a8e716]"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={!form.title.trim() || !form.targetAmount}
                className="flex-1 k-btn-lime py-3.5 disabled:opacity-40"
              >
                {editingGoal ? 'Salvar' : 'Criar Meta'}
              </button>
              <button onClick={() => setShowModal(false)} className="flex-1 bg-[#f5f5f7] border border-[#e8e8ed] text-[#6e6e73] font-black py-3.5 rounded-2xl text-sm uppercase">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contribution modal */}
      {showContribModal && (
        <div className="fixed inset-0 z-[300] flex items-end justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowContribModal(null)}>
          <div className="w-full max-w-md bg-white border border-[#e8e8ed] rounded-t-3xl p-6 pb-10 animate-in slide-in-from-bottom-4" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-[#e8e8ed] rounded-full mx-auto mb-5"></div>
            <div className="flex items-center gap-3 mb-5">
              <span className="text-3xl">{showContribModal.emoji}</span>
              <div>
                <h3 className="text-[#1d1d1f] font-black uppercase italic tracking-tighter text-base leading-none">{showContribModal.title}</h3>
                <p className="text-[#aeaeb2] text-xs mt-0.5 k-num">Saldo atual: {formatCurrency(showContribModal.currentAmount)} / {formatCurrency(showContribModal.targetAmount)}</p>
              </div>
            </div>
            <label className="text-[#aeaeb2] text-[10px] font-black uppercase tracking-widest block mb-2">Quanto você vai adicionar?</label>
            <input
              type="number"
              inputMode="decimal"
              value={contribValue}
              onChange={e => setContribValue(e.target.value)}
              placeholder="R$ 0,00"
              autoFocus
              className="w-full bg-[#f5f5f7] border border-[#e8e8ed] text-[#1d1d1f] placeholder:text-[#aeaeb2] rounded-xl px-4 py-3.5 text-xl outline-none focus:border-[#a8e716] k-num font-black mb-5"
              onKeyDown={e => e.key === 'Enter' && handleContrib()}
            />
            <div className="flex gap-3">
              <button onClick={handleContrib} disabled={!contribValue} className="flex-1 k-btn-lime py-3.5 disabled:opacity-40">
                Registrar
              </button>
              <button onClick={() => setShowContribModal(null)} className="flex-1 bg-[#f5f5f7] border border-[#e8e8ed] text-[#6e6e73] font-black py-3.5 rounded-2xl text-sm uppercase">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Metas;
