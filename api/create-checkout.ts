import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

function verifyToken(authHeader?: string): { sub: string } | null {
  const token = (authHeader ?? '').replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { sub?: string; exp?: number };
    if (!payload.sub) return null;
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return { sub: payload.sub };
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
  const { origin, plan } = req.body as { origin?: string; plan?: 'monthly' | 'annual' };
  const baseUrl = (origin ?? 'https://kashim.com.br').replace(/\/$/, '');
  const isAnnual = plan === 'annual';

  // Accept both PAGARME_SECRET_KEY and VITE_PAGARME_SECRET_KEY (latter if user set it with VITE_ prefix by mistake)
  const pagarmeKey = (process.env.PAGARME_SECRET_KEY ?? process.env.VITE_PAGARME_SECRET_KEY ?? '').trim();
  const allKeys = Object.keys(process.env);
  const pagarmeKeys = allKeys.filter(k => k.toUpperCase().includes('PAGARME'));
  const supabaseKeys = allKeys.filter(k => k.toUpperCase().includes('SUPABASE'));
  const directVal = process.env['PAGARME_SECRET_KEY'];
  if (!pagarmeKey) {
    console.error('[create-checkout] diagnóstico:', { totalKeys: allKeys.length, pagarmeKeys, supabaseKeys, directVal: directVal ? `${directVal.slice(0,6)}...` : 'undefined' });
    return res.status(500).json({
      error: 'Configuração de pagamento ausente',
      debug: { totalEnvKeys: allKeys.length, pagarmeKeys, supabaseKeys, directValFound: !!directVal }
    });
  }
  if (!pagarmeKey.startsWith('sk_')) {
    console.error('[create-checkout] chave com formato inválido, primeiros chars:', JSON.stringify(pagarmeKey.slice(0, 12)));
    return res.status(500).json({ error: `Chave Pagar.me inválida — deve começar com sk_. Recebido: "${pagarmeKey.slice(0, 8)}..."` });
  }
  const usedVar = process.env.PAGARME_SECRET_KEY ? 'PAGARME_SECRET_KEY' : 'VITE_PAGARME_SECRET_KEY';
  console.log(`[create-checkout] chave OK via ${usedVar}, prefixo: ${pagarmeKey.slice(0, 8)}...`);
  const authHeader = `Basic ${Buffer.from(`${pagarmeKey}:`).toString('base64')}`;

  const amount = isAnnual ? 13188 : 1499;
  const description = isAnnual ? 'Kashim Premium — Anual (12 meses)' : 'Kashim Premium — Mensal';
  const itemCode = isAnnual ? 'kashim_annual' : 'kashim_monthly';

  const orderBody = {
    items: [{ amount, description, quantity: 1, code: itemCode }],
    customer: { type: 'individual' },
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
            installments: [{ number: 1, total: amount }],
          },
        },
      },
    ],
    metadata: { householdId, clerkUserId, plan: isAnnual ? 'annual' : 'monthly' },
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
      return res.status(502).json({ error: `Pagar.me ${pmRes.status}: ${errText}` });
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
