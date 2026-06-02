import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export const config = { api: { bodyParser: true } };

function verifyBasicAuth(authHeader: string | undefined): boolean {
  if (!authHeader?.startsWith('Basic ')) return false;
  const encoded = authHeader.slice(6);
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const [user, pass] = decoded.split(':');
  const expectedUser = process.env.PAGARME_WEBHOOK_USER ?? '';
  const expectedPass = process.env.PAGARME_WEBHOOK_PASS ?? '';
  if (!expectedUser || !expectedPass) return true; // not configured yet — allow
  return user === expectedUser && pass === expectedPass;
}

interface PagarmeEvent {
  type?: string;
  data?: {
    id?: string;
    status?: string;
    metadata?: {
      householdId?: string;
      clerkUserId?: string;
      plan?: string;
    };
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  if (!verifyBasicAuth(req.headers.authorization as string | undefined)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const event = req.body as PagarmeEvent;
  const { type, data } = event;
  const householdId = data?.metadata?.householdId;
  const plan = data?.metadata?.plan ?? 'monthly';

  if (!householdId) return res.status(200).json({ received: true });

  if (type === 'order.paid') {
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setMonth(expiresAt.getMonth() + (plan === 'annual' ? 12 : 1));
    await supabase
      .from('households')
      .update({
        subscription_status: 'active',
        subscription_started_at: now.toISOString(),
        subscription_expires_at: expiresAt.toISOString(),
      })
      .eq('id', householdId);
  }

  if (type === 'order.payment_failed' || type === 'charge.payment_failed') {
    await supabase
      .from('households')
      .update({ subscription_status: 'past_due' })
      .eq('id', householdId);
  }

  if (type === 'order.canceled') {
    await supabase
      .from('households')
      .update({ subscription_status: 'cancelled' })
      .eq('id', householdId);
  }

  return res.status(200).json({ received: true });
}
