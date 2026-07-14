// Cliente da aba Dívidas. Tudo passa pelo endpoint /api/debts (service key),
// que autoriza membro/coach/admin — assim cliente, você e a assistente gravam
// sem depender de RLS.

export interface Debt {
  id: string;
  household_id: string;
  name: string;
  installment_value: number;
  installment_count: number;
  payoff_value: number;
  interest_rate: number | null;
  sort_order: number;
}

export async function loadDebts(token: string, householdId: string): Promise<Debt[]> {
  const res = await fetch(`/api/debts?householdId=${encodeURIComponent(householdId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { debts?: Debt[] };
  return data.debts ?? [];
}

export async function saveDebt(token: string, householdId: string, debt: Partial<Debt>): Promise<Debt | null> {
  const res = await fetch('/api/debts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ householdId, debt }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'Erro ao salvar dívida');
  }
  return ((await res.json()) as { debt?: Debt }).debt ?? null;
}

export async function deleteDebt(token: string, householdId: string, id: string): Promise<void> {
  await fetch('/api/debts', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ householdId, id }),
  });
}
