import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

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

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

function verifyToken(authHeader?: string): { sub: string } | null {
  const claims = verifyAuthToken(authHeader);
  return claims ? { sub: claims.sub } : null;
}

// Rate limit via Postgres (embutido: Vercel não empacota import local em api/).
// FALHA ABERTO de propósito: qualquer problema no limiter nunca vira bloqueio de
// cliente legítimo — vale o "na dúvida, libera" do resto do sistema. Só protege
// depois que docs/sql/rate-limiting.sql roda no Supabase.
async function rateLimitOk(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_key: key, p_limit: limit, p_window_seconds: windowSeconds,
    });
    if (error) return true;
    return data === true;
  } catch {
    return true;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const payload = verifyToken(req.headers.authorization as string);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });

  const clerkUserId = payload.sub;

  // Anti-abuso: no máximo 8 pedidos de checkout por usuário a cada 5 min.
  // Gerar link de pagamento chama a Pagar.me e cria pedido — não pode virar
  // fábrica de spam. O usuário legítimo clica 1–2 vezes; 8 é folgado.
  if (!(await rateLimitOk(`checkout:${clerkUserId}`, 8, 300))) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
  }

  const { data: membership } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('clerk_user_id', clerkUserId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) return res.status(404).json({ error: 'Household not found' });

  const householdId = membership.household_id;
  const { origin, plan, tier } = req.body as { origin?: string; plan?: 'monthly' | 'annual'; tier?: 'base' | 'of' };
  const baseUrl = (origin ?? 'https://kashim.com.br').replace(/\/$/, '');
  const cycle: 'monthly' | 'annual' = plan === 'annual' ? 'annual' : 'monthly';
  const isAnnual = cycle === 'annual';
  // 'of' = plano com Open Finance (conexão bancária). 'base' = plano padrão.
  const t: 'base' | 'of' = tier === 'of' ? 'of' : 'base';

  const pagarmeKey = (process.env.PAGARME_SECRET_KEY ?? '').trim();
  if (!pagarmeKey) {
    return res.status(500).json({ error: 'Configuração de pagamento ausente.' });
  }
  const authHeader = `Basic ${Buffer.from(`${pagarmeKey}:`).toString('base64')}`;

  // Valores em centavos. base mensal R$14,99 / anual R$131,88 (10,99/mês).
  // OF mensal R$29,90 / anual R$298,80 (24,90/mês).
  const AMOUNTS = {
    base: { monthly: 1499, annual: 13188 },
    of: { monthly: 2990, annual: 29880 },
  } as const;
  const amount = AMOUNTS[t][cycle];
  const description = t === 'of'
    ? (isAnnual ? 'Kashim + Open Finance — Anual (12 meses)' : 'Kashim + Open Finance — Mensal')
    : (isAnnual ? 'Kashim Premium — Anual (12 meses)' : 'Kashim Premium — Mensal');
  const itemCode = `kashim_${t}_${cycle}`;

  const orderBody = {
    items: [{ amount, description, quantity: 1, code: itemCode }],
    customer: {
      type: 'individual',
      name: 'Cliente Kashim', // customer_editable: true allows user to fill real name at checkout
    },
    payments: [
      {
        payment_method: 'checkout',
        checkout: {
          expires_in: 120,
          billing_address_editable: false,
          customer_editable: true,
          accepted_payment_methods: ['credit_card', 'pix'],
          success_url: `${baseUrl}/?payment=success`,
          default_payment_method: 'pix',
          credit_card: {
            statement_descriptor: 'KASHIM',
            installments: [{ number: 1, total: amount }],
          },
          pix: {
            expires_in: 1800,
          },
        },
      },
    ],
    metadata: { householdId, clerkUserId, plan: cycle, tier: t },
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
