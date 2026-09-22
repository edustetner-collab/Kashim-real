import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';

function verifyAuthToken(authHeader?: string): { sub: string } | null {
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

type Message = { role: 'user' | 'assistant'; content: string };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', 'https://kashim.com.br');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const claims = verifyAuthToken(req.headers.authorization ?? '');
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase não configurado' });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const householdId = req.method === 'GET'
    ? (req.query.householdId as string)
    : req.body?.householdId as string;

  if (!householdId) return res.status(400).json({ error: 'householdId obrigatório' });

  // Verificar que o usuário pertence ao household
  const { data: member } = await db
    .from('household_members')
    .select('id')
    .eq('household_id', householdId)
    .eq('clerk_user_id', claims.sub)
    .maybeSingle();

  if (!member) return res.status(403).json({ error: 'Acesso negado' });

  const MAX_CONVERSAS = 20;   // por pessoa; as mais antigas somem sozinhas
  const MAX_MENSAGENS = 100;  // por conversa

  /** Título que a pessoa reconhece na lista: a primeira pergunta dela. */
  function tituloDe(messages: Message[]): string {
    const primeira = messages.find(m => m.role === 'user')?.content ?? '';
    const limpo = primeira.replace(/\s+/g, ' ').trim();
    return (limpo.length > 60 ? `${limpo.slice(0, 57)}…` : limpo) || 'Conversa';
  }

  /**
   * Traz a conversa única antiga (`coach_conversations`) para o formato novo.
   *
   * Roda uma vez por pessoa, na primeira leitura depois desta mudança. Sem
   * isto, quem já conversava com o Stets abriria o app com a lista vazia e
   * acharia que perdeu tudo.
   */
  async function importarConversaAntiga() {
    const { data: antiga } = await db
      .from('coach_conversations')
      .select('messages, updated_at')
      .eq('household_id', householdId)
      .eq('clerk_user_id', claims!.sub)
      .maybeSingle();
    const msgs = (antiga?.messages ?? []) as Message[];
    if (!Array.isArray(msgs) || msgs.length === 0) return null;
    const { data: criada } = await db
      .from('coach_chats')
      .insert({
        household_id: householdId,
        clerk_user_id: claims!.sub,
        titulo: tituloDe(msgs),
        messages: msgs.slice(-MAX_MENSAGENS),
        updated_at: antiga?.updated_at ?? new Date().toISOString(),
      })
      .select('id, titulo, messages, updated_at')
      .single();
    return criada ?? null;
  }

  if (req.method === 'GET') {
    // Uma conversa específica, quando a pessoa escolhe na lista.
    const pedida = req.query.conversaId as string | undefined;
    if (pedida) {
      const { data } = await db
        .from('coach_chats')
        .select('id, titulo, messages, updated_at')
        .eq('id', pedida)
        .eq('household_id', householdId)
        .eq('clerk_user_id', claims.sub)
        .maybeSingle();
      if (!data) return res.status(404).json({ error: 'Conversa não encontrada' });
      return res.json({
        conversaId: data.id,
        titulo: data.titulo,
        messages: (data.messages ?? []) as Message[],
        updatedAt: data.updated_at,
      });
    }

    let { data: lista } = await db
      .from('coach_chats')
      .select('id, titulo, messages, updated_at')
      .eq('household_id', householdId)
      .eq('clerk_user_id', claims.sub)
      .order('updated_at', { ascending: false })
      .limit(MAX_CONVERSAS);

    if (!lista || lista.length === 0) {
      const importada = await importarConversaAntiga();
      lista = importada ? [importada] : [];
    }

    const atual = lista[0] ?? null;
    return res.json({
      // A mais recente abre na tela, como sempre foi.
      conversaId: atual?.id ?? null,
      messages: (atual?.messages ?? []) as Message[],
      updatedAt: atual?.updated_at ?? null,
      conversas: lista.map(c => ({
        id: c.id,
        titulo: c.titulo ?? tituloDe((c.messages ?? []) as Message[]),
        atualizadaEm: c.updated_at,
        trocas: ((c.messages ?? []) as Message[]).filter(m => m.role === 'user').length,
      })),
    });
  }

  // POST — salvar mensagens
  const messages = req.body?.messages as Message[] | undefined;
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages obrigatório' });
  const trimmed = messages.slice(-MAX_MENSAGENS);
  const conversaId = req.body?.conversaId as string | undefined;

  if (conversaId) {
    const { data, error } = await db
      .from('coach_chats')
      .update({ messages: trimmed, titulo: tituloDe(trimmed), updated_at: new Date().toISOString() })
      .eq('id', conversaId)
      .eq('household_id', householdId)
      .eq('clerk_user_id', claims.sub)
      .select('id')
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (data) return res.json({ ok: true, conversaId: data.id });
    // Conversa apagada por limpeza automática: cai para criar uma nova.
  }

  const { data: nova, error: erroNova } = await db
    .from('coach_chats')
    .insert({
      household_id: householdId,
      clerk_user_id: claims.sub,
      titulo: tituloDe(trimmed),
      messages: trimmed,
    })
    .select('id')
    .single();
  if (erroNova) return res.status(500).json({ error: erroNova.message });

  /**
   * Guarda as 20 últimas. Conversa velha some sozinha, sem a pessoa precisar
   * arrumar nada — e o banco não vira depósito.
   */
  const { data: todas } = await db
    .from('coach_chats')
    .select('id')
    .eq('household_id', householdId)
    .eq('clerk_user_id', claims.sub)
    .order('updated_at', { ascending: false });
  const excedentes = (todas ?? []).slice(MAX_CONVERSAS).map(c => c.id);
  if (excedentes.length > 0) {
    await db.from('coach_chats').delete().in('id', excedentes);
  }

  return res.json({ ok: true, conversaId: nova.id });
}
