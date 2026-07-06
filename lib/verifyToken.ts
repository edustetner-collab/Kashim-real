// Verificação de assinatura do token compartilhada pelas rotas da API.
//
// Fica em lib/ (fora de api/) porque arquivos com prefixo "_" dentro de api/
// não são empacotados de forma confiável para import na Vercel.
//
// O frontend envia o token do template "supabase" do Clerk, assinado com HS256
// usando o JWT secret do Supabase. Aqui verificamos a ASSINATURA (não só
// decodificamos), impedindo tokens forjados de se passarem por qualquer usuário.
//
// Fail-closed: se SUPABASE_JWT_SECRET não estiver configurado, nada é aceito.
import { createHmac, timingSafeEqual } from 'crypto';

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';

export interface VerifiedClaims {
  sub: string;
  exp?: number;
  nbf?: number;
  [key: string]: unknown;
}

function decodeSegment(segment: string): Buffer {
  return Buffer.from(segment, 'base64url');
}

/**
 * Verifica um JWT HS256 assinado com o JWT secret do Supabase e retorna os
 * claims, ou null se a assinatura/expiração forem inválidas.
 */
export function verifyAuthToken(authHeader?: string): VerifiedClaims | null {
  if (!SUPABASE_JWT_SECRET) return null; // fail-closed: segredo obrigatório

  const token = (authHeader ?? '').replace('Bearer ', '').trim();
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  try {
    // 1) Cabeçalho precisa declarar HS256
    const header = JSON.parse(decodeSegment(headerB64).toString('utf8')) as { alg?: string };
    if (header.alg !== 'HS256') return null;

    // 2) Recalcula o HMAC e compara em tempo constante
    const expected = createHmac('sha256', SUPABASE_JWT_SECRET)
      .update(`${headerB64}.${payloadB64}`)
      .digest();
    const provided = decodeSegment(signatureB64);
    if (expected.length !== provided.length) return null;
    if (!timingSafeEqual(expected, provided)) return null;

    // 3) Claims + validade
    const claims = JSON.parse(decodeSegment(payloadB64).toString('utf8')) as VerifiedClaims;
    if (!claims.sub) return null;
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp === 'number' && claims.exp < now) return null;
    if (typeof claims.nbf === 'number' && claims.nbf > now + 5) return null;
    return claims;
  } catch {
    return null;
  }
}

/**
 * Verifica o token E confirma que o autor é um super-admin configurado.
 * Retorna o clerk user id, ou null.
 */
export function verifyAdminToken(authHeader?: string): string | null {
  const claims = verifyAuthToken(authHeader);
  if (!claims) return null;
  const adminIds = (process.env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!adminIds.includes(claims.sub)) return null;
  return claims.sub;
}
