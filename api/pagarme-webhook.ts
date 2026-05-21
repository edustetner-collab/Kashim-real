import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export const config = { api: { bodyParser: false } };

async function getRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifySignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

interface PagarmeEvent {
  type?: string;
  data?: {
    id?: string;
    status?: string;
    metadata?: {
      householdId?: string;
      clerkUserId?: string;
    };
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = (req.headers['x-hub-signature'] ?? '') as string;
  const secret = process.env.PAGARME_WEBHOOK_SECRET ?? '';

  if (secret && sig && !verifySignature(rawBody, sig, secret)) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event: PagarmeEvent;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { type, data } = event;
  const householdId = data?.metadata?.householdId;

  if (!householdId) return res.status(200).json({ received: true });

  if (type === 'order.paid') {
    await supabase
      .from('households')
      .update({
        subscription_status: 'active',
        stripe_subscription_id: data?.id ?? null,
        subscription_started_at: new Date().toISOString(),
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
