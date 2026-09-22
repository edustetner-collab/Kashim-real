import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Cliente base (sem autenticação — para operações públicas)
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Cliente autenticado com token do Clerk (para operações com RLS).
// `accessToken` busca o token a cada requisição, então ele nunca vai expirado:
// o token do template supabase vive 60s, e um setInterval de renovação não
// sobrevive ao throttle de aba em segundo plano (era a origem dos "JWT expired").
// Com accessToken o SDK também desliga o GoTrue interno sozinho.
export function createAuthClient(getClerkToken: () => Promise<string | null>) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    accessToken: getClerkToken,
  });
}
