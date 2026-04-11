import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' });

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'] as string;
  const rawBody = await getRawBody(req);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: err.message });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const householdId = session.metadata?.householdId;
    const subscriptionId = session.subscription as string;

    if (householdId && subscriptionId) {
      await supabase
        .from('households')
        .update({
          subscription_status: 'active',
          stripe_subscription_id: subscriptionId,
          subscription_started_at: new Date().toISOString(),
        })
        .eq('id', householdId);
    }
  }

  if (event.type === 'customer.subscription.deleted' || event.type === 'customer.subscription.paused') {
    const sub = event.data.object as Stripe.Subscription;
    await supabase
      .from('households')
      .update({ subscription_status: 'cancelled' })
      .eq('stripe_subscription_id', sub.id);
  }

  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object as Stripe.Invoice;
    const subId = (invoice as any).subscription as string;
    if (subId) {
      await supabase
        .from('households')
        .update({ subscription_status: 'active' })
        .eq('stripe_subscription_id', subId);
    }
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice;
    const subId = (invoice as any).subscription as string;
    if (subId) {
      await supabase
        .from('households')
        .update({ subscription_status: 'past_due' })
        .eq('stripe_subscription_id', subId);
    }
  }

  return res.status(200).json({ received: true });
}
