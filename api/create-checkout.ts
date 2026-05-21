import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

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

  const { data: membership } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle();

  if (!membership) return res.status(404).json({ error: 'Household not found' });

  const householdId = membership.household_id;
  const { origin } = req.body as { origin?: string };
  const baseUrl = (origin ?? 'https://kashim.com.br').replace(/\/$/, '');

  const pagarmeKey = process.env.PAGARME_SECRET_KEY!;
  const authHeader = `Basic ${Buffer.from(`${pagarmeKey}:`).toString('base64')}`;

  const orderBody = {
    items: [
      {
        amount: 999,
        description: 'Kashim Premium — Mensal',
        quantity: 1,
        code: 'kashim_monthly',
      },
    ],
    customer: {
      type: 'individual',
    },
    payments: [
      {
        payment_method: 'checkout',
        checkout: {
          expires_in: 120,
          billing_address_editable: false,
          customer_editable: true,
          accepted_payment_methods: ['credit_card', 'pix', 'boleto'],
          success_url: `${baseUrl}/?payment=success`,
          default_payment_method: 'pix',
          credit_card: {
            statement_descriptor: 'KASHIM',
            installments: [{ number: 1, total: 999 }],
          },
        },
      },
    ],
    metadata: { householdId, clerkUserId },
  };

  try {
    const pmRes = await fetch('https://api.pagar.me/core/v5/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(orderBody),
    });

    if (!pmRes.ok) {
      const errText = await pmRes.text();
      console.error('Pagar.me error:', errText);
      return res.status(502).json({ error: 'Erro ao criar sessão de pagamento' });
    }

    const order = (await pmRes.json()) as {
      id: string;
      checkouts?: { payment_url?: string }[];
    };

    const checkoutUrl = order.checkouts?.[0]?.payment_url;
    if (!checkoutUrl) {
      return res.status(502).json({ error: 'URL de pagamento não disponível' });
    }

    return res.status(200).json({ url: checkoutUrl });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno';
    return res.status(500).json({ error: message });
  }
}
