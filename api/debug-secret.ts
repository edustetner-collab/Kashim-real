import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'node:crypto';

// DIAGNÓSTICO TEMPORÁRIO — não expõe segredo nem token, só booleans/metadados.
// A anon key do Supabase é um JWT assinado com o JWT secret. Se o
// SUPABASE_JWT_SECRET validar a assinatura dela, então o segredo está correto.
export default function handler(_req: VercelRequest, res: VercelResponse) {
  const secret = process.env.SUPABASE_JWT_SECRET ?? '';
  const anon = process.env.VITE_SUPABASE_ANON_KEY ?? '';
  const parts = anon.split('.');
  let anonAlg = 'n/a';
  let anonSigValidWithSecret = false;
  try {
    if (parts.length === 3) {
      anonAlg = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')).alg ?? '?';
      if (secret) {
        const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
        const provided = Buffer.from(parts[2], 'base64url');
        anonSigValidWithSecret = expected.length === provided.length && timingSafeEqual(expected, provided);
      }
    }
  } catch (e) {
    return res.status(200).json({ error: String(e) });
  }
  return res.status(200).json({
    hasSecret: !!secret,
    secretLen: secret.length,
    anonKeyPresent: !!anon,
    anonAlg,
    anonSigValidWithSecret,
  });
}
