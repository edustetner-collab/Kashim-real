import { SupabaseClient } from '@supabase/supabase-js';
import { FinanceItem, CategoryType, LinkType, PartialExpense } from '../types';

// ─── HOUSEHOLD ────────────────────────────────────────────────────────────────

export async function getOrCreateHousehold(
  db: SupabaseClient,
  clerkUserId: string
): Promise<string> {
  // Verifica se já é membro de algum household
  const { data: membership } = await db
    .from('household_members')
    .select('household_id')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle();

  if (membership) return membership.household_id;

  // Cria um novo household
  const { data: household, error: hhError } = await db
    .from('households')
    .insert({
      start_month: new Date().getMonth(),
      start_year: new Date().getFullYear(),
    })
    .select('id')
    .single();

  if (hhError || !household) throw new Error('Erro ao criar household');

  // Associa o usuário como owner
  const { error: memberError } = await db.from('household_members').insert({
    household_id: household.id,
    clerk_user_id: clerkUserId,
    role: 'owner',
  });

  if (memberError) throw new Error('Erro ao criar membership');

  return household.id;
}

export async function getHousehold(db: SupabaseClient, householdId: string) {
  const { data } = await db
    .from('households')
    .select('*')
    .eq('id', householdId)
    .single();
  return data;
}

export async function updateHouseholdPlan(
  db: SupabaseClient,
  householdId: string,
  startMonth: number,
  startYear: number
) {
  await db
    .from('households')
    .update({ start_month: startMonth, start_year: startYear })
    .eq('id', householdId);
}

// ─── FINANCE ITEMS ────────────────────────────────────────────────────────────

export async function loadFinanceItems(
  db: SupabaseClient,
  householdId: string
): Promise<FinanceItem[]> {
  const { data, error } = await db
    .from('finance_items')
    .select('*, partial_expenses(*)')
    .eq('household_id', householdId)
    .order('sort_order', { ascending: true });

  if (error || !data) return [];

  return data.map(rowToFinanceItem);
}

export async function saveFinanceItem(
  db: SupabaseClient,
  householdId: string,
  item: FinanceItem,
  sortOrder: number
): Promise<string> {
  const payload = financeItemToRow(householdId, item, sortOrder);

  // Verifica se já existe no banco (por id local ou uuid)
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id);

  if (isUuid) {
    const { data } = await db
      .from('finance_items')
      .upsert({ id: item.id, ...payload })
      .select('id')
      .single();
    return data?.id ?? item.id;
  } else {
    // ID local (não é UUID) — insere como novo
    const { data } = await db
      .from('finance_items')
      .insert(payload)
      .select('id')
      .single();
    return data?.id ?? item.id;
  }
}

export async function deleteFinanceItem(db: SupabaseClient, itemId: string) {
  await db.from('finance_items').delete().eq('id', itemId);
}

// ─── PARTIAL EXPENSES ─────────────────────────────────────────────────────────

export async function addPartialExpense(
  db: SupabaseClient,
  financeItemId: string,
  year: number,
  month: number,
  expense: PartialExpense
) {
  await db.from('partial_expenses').insert({
    id: expense.id,
    finance_item_id: financeItemId,
    year,
    month,
    date: expense.date,
    description: expense.description,
    value: expense.value,
  });
}

export async function deletePartialExpense(db: SupabaseClient, expenseId: string) {
  await db.from('partial_expenses').delete().eq('id', expenseId);
}

// ─── TETO COLUMNS ─────────────────────────────────────────────────────────────

export async function loadTetoColumns(db: SupabaseClient, householdId: string) {
  const { data } = await db
    .from('teto_columns')
    .select('*')
    .eq('household_id', householdId)
    .order('sort_order', { ascending: true });
  return data ?? [];
}

export async function saveTetoColumns(
  db: SupabaseClient,
  householdId: string,
  columns: { id: string; title: string; linkedItemId: string }[]
) {
  // Deleta tudo e reinsere (simples para poucos registros)
  await db.from('teto_columns').delete().eq('household_id', householdId);
  if (columns.length === 0) return;
  await db.from('teto_columns').insert(
    columns.map((c, i) => ({
      household_id: householdId,
      title: c.title,
      linked_item_id: c.linkedItemId || null,
      sort_order: i,
    }))
  );
}

// ─── USER PREFERENCES ────────────────────────────────────────────────────────

export async function loadUserPreferences(db: SupabaseClient, clerkUserId: string) {
  const { data } = await db
    .from('user_preferences')
    .select('*')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle();
  return data;
}

export async function saveUserPreferences(
  db: SupabaseClient,
  clerkUserId: string,
  prefs: Record<string, boolean>
) {
  await db.from('user_preferences').upsert({
    clerk_user_id: clerkUserId,
    ...prefs,
    updated_at: new Date().toISOString(),
  });
}

// ─── SNAPSHOTS ───────────────────────────────────────────────────────────────

export async function saveSnapshot(
  db: SupabaseClient,
  householdId: string,
  month: number,
  year: number,
  summary: {
    totalIncome: number;
    totalFixed: number;
    totalVariable: number;
    totalLeisure: number;
    totalCreditCard: number;
    balance: number;
    accumulated: number;
  },
  snapshotData: FinanceItem[]
) {
  await db.from('financial_snapshots').upsert({
    household_id: householdId,
    month,
    year,
    total_income: summary.totalIncome,
    total_fixed: summary.totalFixed,
    total_variable: summary.totalVariable,
    total_leisure: summary.totalLeisure,
    total_credit_card: summary.totalCreditCard,
    balance: summary.balance,
    accumulated: summary.accumulated,
    snapshot_data: snapshotData,
  });
}

// ─── CONVERSORES ─────────────────────────────────────────────────────────────

function rowToFinanceItem(row: any): FinanceItem {
  const partialExpenses: Record<string, PartialExpense[]> = {};

  if (row.partial_expenses) {
    for (const pe of row.partial_expenses) {
      const key = `${pe.year}-${pe.month}`;
      if (!partialExpenses[key]) partialExpenses[key] = [];
      partialExpenses[key].push({
        id: pe.id,
        date: pe.date,
        description: pe.description,
        value: pe.value,
      });
    }
  }

  return {
    id: row.id,
    description: row.description,
    category: row.category as CategoryType,
    values: row.values ?? new Array(12).fill(0),
    paidStatus: row.paid_status ?? new Array(12).fill(false),
    linkedCardId: row.linked_card_id ?? undefined,
    linkType: row.link_type as LinkType ?? undefined,
    closingDay: row.closing_day ?? undefined,
    dueDay: row.due_day ?? undefined,
    partialExpenses: Object.keys(partialExpenses).length > 0 ? partialExpenses : undefined,
  };
}

function financeItemToRow(householdId: string, item: FinanceItem, sortOrder: number) {
  return {
    household_id: householdId,
    description: item.description,
    category: item.category,
    values: item.values,
    paid_status: item.paidStatus,
    linked_card_id: item.linkedCardId ?? null,
    link_type: item.linkType ?? null,
    closing_day: item.closingDay ?? null,
    due_day: item.dueDay ?? null,
    sort_order: sortOrder,
    updated_at: new Date().toISOString(),
  };
}
