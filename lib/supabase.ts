import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Cliente base (sem autenticação — para operações públicas)
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Cliente autenticado com token do Clerk (para operações com RLS)
// auth desativado: o app usa Clerk para auth, não GoTrue.
// Sem isso, cada novo client (renovado a cada 50s) cria uma GoTrueClient
// disputando o mesmo localStorage key → "Multiple GoTrueClient instances" warning.
export function createAuthClient(clerkToken: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${clerkToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
