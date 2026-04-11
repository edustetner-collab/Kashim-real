import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Cliente base (sem autenticação — para operações públicas)
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Cliente autenticado com token do Clerk (para operações com RLS)
export function createAuthClient(clerkToken: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${clerkToken}`,
      },
    },
  });
}
