import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Define a senha do PRÓPRIO usuário autenticado pelo backend do Clerk.
// Motivo: quando o cliente entra via link/código de e-mail (passwordless), o
// Clerk exige "reverificação" recente antes de deixar o front definir a
// primeira senha. Esse passo, no app nativo/WebView, quebra e o cliente fica
// travado (ver ClientSettings). O update via Backend API (admin) NÃO exige
// reverificação: o token supabase (sub = clerk user id) prova a identidade e
// só permitimos alterar a senha da própria conta.

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? '';

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
  process.env.VITE_SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_KEY ?? ''
);

// Rate limit via Postgres (embutido: Vercel não empacota import local em api/).
// FALHA ABERTO: problema no limiter nunca bloqueia quem tem direito. Só protege
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

function clientIp(req: VercelRequest): string {
  const xff = (req.headers['x-forwarded-for'] as string | undefined) ?? '';
  const first = xff.split(',')[0].trim();
  return first || (req.headers['x-real-ip'] as string | undefined) || 'sem-ip';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization ?? '');
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });
  if (!CLERK_SECRET_KEY) return res.status(500).json({ error: 'Serviço indisponível.' });

  // Anti-abuso: no máximo 5 trocas de senha a cada 5 min, por conta E por IP.
  // Trocar senha é operação sensível; 5 é folgado para uso legítimo.
  const rlKey = `set-password:${claims.sub}:${clientIp(req)}`;
  if (!(await rateLimitOk(rlKey, 5, 300))) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
  }

  const { password } = (req.body ?? {}) as { password?: string };
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres.' });
  }

  try {
    const r = await fetch(`https://api.clerk.com/v1/users/${claims.sub}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${CLERK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    });

    if (r.ok) return res.status(200).json({ success: true });

    // Mapeia os erros do Clerk para mensagens amigáveis em pt-BR
    const body = (await r.json().catch(() => ({}))) as {
      errors?: Array<{ code?: string; message?: string; long_message?: string }>;
    };
    const first = body.errors?.[0];
    const code = first?.code ?? '';
    const raw = (first?.long_message ?? first?.message ?? '').toLowerCase();

    if (code.includes('pwned') || raw.includes('pwned') || raw.includes('data breach')) {
      return res.status(400).json({ error: 'Essa senha apareceu em vazamentos de dados. Escolha outra.' });
    }
    if (code.includes('too_short') || code.includes('length') || raw.includes('short')) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres.' });
    }
    if (code.includes('common') || raw.includes('too common')) {
      return res.status(400).json({ error: 'Essa senha é muito comum. Escolha uma mais forte.' });
    }
    return res.status(400).json({ error: 'Não foi possível salvar a senha. Tente uma senha diferente.' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno';
    return res.status(500).json({ error: message });
  }
}
