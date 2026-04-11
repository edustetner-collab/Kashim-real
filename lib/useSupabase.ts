import { useAuth } from '@clerk/clerk-react';
import { useEffect, useState } from 'react';
import { createAuthClient } from './supabase';
import { SupabaseClient } from '@supabase/supabase-js';

// Retorna um cliente Supabase autenticado com o token do Clerk (template "supabase")
// O token é assinado com HS256 usando o JWT secret do Supabase
// O claim "sub" contém o Clerk user ID, usado pelas RLS policies
export function useSupabase() {
  const { getToken } = useAuth();
  const [client, setClient] = useState<SupabaseClient | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const token = await getToken({ template: 'supabase' });
        if (!token || cancelled) return;
        setClient(createAuthClient(token));
      } catch (e) {
        console.error('Erro ao obter token Supabase:', e);
      }
    }

    init();

    // Renova o token a cada 50 segundos (lifetime é 60s)
    const interval = setInterval(init, 50_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [getToken]);

  return client;
}
