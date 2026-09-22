import { useAuth } from '@clerk/clerk-react';
import { useMemo } from 'react';
import { createAuthClient } from './supabase';
import { SupabaseClient } from '@supabase/supabase-js';

// Cliente Supabase autenticado com o token do Clerk (template "supabase").
// O token é assinado com HS256 usando o JWT secret do Supabase e o claim "sub"
// carrega o Clerk user ID, que as policies de RLS usam.
//
// O client é criado uma vez e busca o token fresco a cada requisição, em vez de
// ser recriado num intervalo: o token vive 60s e o timer parava em aba inativa,
// o que derrubava requisições com "JWT expired".
export function useSupabase(): SupabaseClient | null {
  const { getToken, isLoaded, isSignedIn } = useAuth();

  return useMemo(() => {
    if (!isLoaded || !isSignedIn) return null;
    return createAuthClient(() => getToken({ template: 'supabase' }));
  }, [isLoaded, isSignedIn, getToken]);
}
