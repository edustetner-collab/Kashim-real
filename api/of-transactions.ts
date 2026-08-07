import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

// ─── Auth (same pattern as api/debts.ts) ─────────────────────────────────────

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';

function verifyAuthToken(authHeader?: string): { sub: string; [k: string]: unknown } | null {
  if (!SUPABASE_JWT_SECRET) return null;
  const token = (authHeader ?? '').replace('Bearer ', '').trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const [h, p, s] = parts;
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    if (header.alg !== 'HS256') return null;
    const expected = createHmac('sha256', SUPABASE_JWT_SECRET).update(`${h}.${p}`).digest();
    const provided = Buffer.from(s, 'base64url');
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (!claims.sub) return null;
    if (typeof claims.exp === 'number' && claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function isMember(sub: string, householdId: string): Promise<boolean> {
  if (ADMIN_IDS.includes(sub)) return true;
  const { data } = await db
    .from('household_members')
    .select('id')
    .eq('household_id', householdId)
    .eq('clerk_user_id', sub)
    .maybeSingle();
  return !!data;
}

// ─── Row ↔ camelCase helpers ──────────────────────────────────────────────────

function rowToTx(r: Record<string, unknown>) {
  return {
    id: r.id,
    householdId: r.household_id,
    connectionId: r.connection_id,
    transactionId: r.transaction_id,
    fitid: r.fitid,
    accountType: r.account_type,
    transactionType: r.transaction_type,
    ofCode: r.of_code,
    ofCategory: r.of_category,
    amount: r.amount,
    transactionDate: r.transaction_date,
    description: r.description,
    paymentMethod: r.payment_method,
    cardLast4: r.card_last4,
    billDueDate: r.bill_due_date,
    billTotal: r.bill_total,
    suggestedCategory: r.suggested_category,
    suggestionConfidence: r.suggestion_confidence,
    installmentCurrent: r.installment_current,
    installmentTotal: r.installment_total,
    status: r.status,
    kashimItemId: r.kashim_item_id,
    kashimCategory: r.kashim_category,
    kashimPartialId: r.kashim_partial_id,
    categorizedAt: r.categorized_at,
    createdAt: r.created_at,
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });
  const sub = claims.sub;

  try {
    // ── GET — listar transações ───────────────────────────────────────────────
    if (req.method === 'GET') {
      const householdId = String(req.query.householdId ?? '');
      if (!householdId) return res.status(400).json({ error: 'householdId obrigatório' });
      if (!(await isMember(sub, householdId))) return res.status(403).json({ error: 'Forbidden' });

      const status = req.query.status as string | undefined;
      const limit = Math.min(parseInt(String(req.query.limit ?? '100')), 500);
      const direction = req.query.direction as string | undefined; // 'expense' | 'income' | 'savings'

      let query = db
        .from('bank_transactions')
        .select('*')
        .eq('household_id', householdId)
        .order('transaction_date', { ascending: false })
        .limit(limit);

      if (status) query = query.eq('status', status);
      if (direction) query = query.eq('transaction_type', direction);

      const { data, error } = await query;
      if (error) throw error;

      // Também devolve a contagem total de pendentes para o badge na UI
      const { count } = await db
        .from('bank_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('household_id', householdId)
        .eq('status', 'pending');

      return res.status(200).json({
        transactions: (data ?? []).map(rowToTx),
        pendingCount: count ?? 0,
      });
    }

    // ── POST — upsert em lote (sync do banco) ─────────────────────────────────
    // Body: { householdId, connectionId?, transactions: OFTransaction[] }
    if (req.method === 'POST') {
      const { householdId, connectionId, transactions } = req.body as {
        householdId?: string;
        connectionId?: string;
        transactions?: Array<Record<string, unknown>>;
      };

      if (!householdId || !Array.isArray(transactions)) {
        return res.status(400).json({ error: 'householdId e transactions[] obrigatórios' });
      }
      if (!(await isMember(sub, householdId))) return res.status(403).json({ error: 'Forbidden' });
      if (transactions.length === 0) return res.status(200).json({ upserted: 0 });

      const rows = transactions.map((tx) => ({
        household_id: householdId,
        connection_id: connectionId ?? null,
        transaction_id: String(tx.transactionId ?? ''),
        fitid: tx.fitid ?? null,
        account_type: String(tx.accountType ?? 'checking'),
        transaction_type: String(tx.direction ?? 'expense'),
        of_code: tx.ofCode ?? null,
        of_category: tx.ofCategory ?? null,
        amount: Number(tx.amount) || 0,
        transaction_date: String(tx.date ?? ''),
        description: tx.description ?? null,
        payment_method: tx.paymentMethod ?? null,
        card_last4: tx.cardLast4 ?? null,
        bill_due_date: tx.billDueDate ?? null,
        bill_total: tx.billTotal ?? null,
        suggested_category: tx.suggestedCategory ?? null,
        suggestion_confidence: tx.suggestionConfidence ?? null,
        installment_current: tx.installmentInfo ? (tx.installmentInfo as any).current : null,
        installment_total: tx.installmentInfo ? (tx.installmentInfo as any).total : null,
        status: 'pending',
      }));

      // Upsert: on conflict (household_id, transaction_id) do nothing
      // → already-categorized transactions are never reset
      const { data, error } = await db
        .from('bank_transactions')
        .upsert(rows, {
          onConflict: 'household_id,transaction_id',
          ignoreDuplicates: true,
        })
        .select('id');

      if (error) throw error;

      return res.status(200).json({ upserted: data?.length ?? 0 });
    }

    // ── PATCH — categorizar ou ignorar uma transação ──────────────────────────
    // Body: { householdId, transactionId, action: 'categorize'|'ignore', itemId?, category?, partialId? }
    if (req.method === 'PATCH') {
      const { householdId, transactionId, action, itemId, category, partialId } = req.body as {
        householdId?: string;
        transactionId?: string;
        action?: 'categorize' | 'ignore';
        itemId?: string;
        category?: string;
        partialId?: string;
      };

      if (!householdId || !transactionId || !action) {
        return res.status(400).json({ error: 'householdId, transactionId e action obrigatórios' });
      }
      if (!(await isMember(sub, householdId))) return res.status(403).json({ error: 'Forbidden' });

      if (action === 'ignore') {
        const { error } = await db
          .from('bank_transactions')
          .update({ status: 'ignored', categorized_at: new Date().toISOString() })
          .eq('household_id', householdId)
          .eq('transaction_id', transactionId);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      if (action === 'categorize') {
        if (!itemId || !category) {
          return res.status(400).json({ error: 'itemId e category obrigatórios para categorize' });
        }
        const { error } = await db
          .from('bank_transactions')
          .update({
            status: 'categorized',
            kashim_item_id: itemId,
            kashim_category: category,
            kashim_partial_id: partialId ?? null,
            categorized_at: new Date().toISOString(),
          })
          .eq('household_id', householdId)
          .eq('transaction_id', transactionId);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'action inválida' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return res.status(500).json({ error: msg });
  }
}
