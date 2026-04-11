import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

function verifyToken(authHeader?: string): { sub: string } | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    return jwt.verify(token, process.env.SUPABASE_JWT_SECRET!) as { sub: string };
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const payload = verifyToken(req.headers.authorization as string);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });

  const clerkUserId = payload.sub;

  // Busca o household do usuário
  const { data: membership } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle();

  if (!membership) return res.status(404).json({ error: 'Household not found' });

  const householdId = membership.household_id;
  const { origin } = req.body as { origin?: string };
  const baseUrl = origin || 'https://kashim-gilt.vercel.app';

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
    success_url: `${baseUrl}/?payment=success`,
    cancel_url: `${baseUrl}/?payment=cancelled`,
    metadata: { householdId, clerkUserId },
    locale: 'pt-BR',
  });

  return res.status(200).json({ url: session.url });
}
