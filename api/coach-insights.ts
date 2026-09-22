import Anthropic from '@anthropic-ai/sdk';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? '';

// Só o super-admin lê as perguntas dos clientes — mesma lista do portão do coach.
const SUPER_ADMIN_EMAILS = ['eduardo_cda@hotmail.com'];

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

async function isSuperAdmin(sub: string): Promise<boolean> {
  if (!CLERK_SECRET_KEY) return false;
  try {
    const r = await fetch(`https://api.clerk.com/v1/users/${sub}`, {
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    });
    if (!r.ok) return false;
    const u = await r.json() as { email_addresses?: Array<{ email_address?: string }> };
    return (u.email_addresses ?? []).some(
      (e) => SUPER_ADMIN_EMAILS.includes((e.email_address ?? '').toLowerCase()),
    );
  } catch {
    return false;
  }
}

type Message = { role: 'user' | 'assistant'; content: string };

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const RANKING_PROMPT = `Você recebe uma lista de perguntas reais feitas por usuários a um consultor financeiro virtual.

Agrupe as perguntas por TEMA e devolva um ranking dos temas mais frequentes.

Responda APENAS com JSON válido, sem texto antes ou depois, neste formato:
{"temas":[{"tema":"Nome curto do tema","quantidade":12,"exemplos":["pergunta exemplo 1","pergunta exemplo 2"],"resumo":"O que os usuários querem saber sobre isso, em uma frase"}]}

Regras:
- Máximo 12 temas, ordenados da maior para a menor quantidade
- Nome do tema: 2 a 4 palavras, específico (ex: "Dívida no cartão", "Como começar a investir")
- Até 3 exemplos por tema, copiados literalmente da lista
- Ignore saudações e mensagens sem conteúdo ("oi", "teste", "obrigado")`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', 'https://kashim.com.br');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const claims = verifyAuthToken(req.headers.authorization ?? '');
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });
  if (!(await isSuperAdmin(claims.sub))) return res.status(403).json({ error: 'Acesso restrito' });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase não configurado' });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: rows } = await db
    .from('coach_conversations')
    .select('messages, updated_at, household_id')
    .order('updated_at', { ascending: false })
    .limit(500);

  // Extrai só o que o usuário escreveu; a resposta da IA não interessa aqui.
  const perguntas: { texto: string; quando: string; household: string }[] = [];
  for (const row of (rows ?? []) as { messages: Message[]; updated_at: string; household_id: string }[]) {
    if (!Array.isArray(row.messages)) continue;
    for (const m of row.messages) {
      if (m.role !== 'user') continue;
      const texto = (m.content ?? '').trim();
      if (texto.length < 8) continue;
      perguntas.push({ texto, quando: row.updated_at, household: row.household_id });
    }
  }

  if (req.method === 'GET') {
    return res.json({
      total: perguntas.length,
      conversas: (rows ?? []).length,
      perguntas: perguntas.slice(0, 300),
    });
  }

  // POST — agrupa por tema com IA
  if (perguntas.length === 0) return res.json({ temas: [], total: 0 });

  const lista = perguntas.slice(0, 300).map((p, i) => `${i + 1}. ${p.texto.slice(0, 300)}`).join('\n');

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: RANKING_PROMPT,
      messages: [{ role: 'user', content: lista }],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as Anthropic.TextBlock).text)
      .join('')
      .trim();

    // O modelo às vezes embrulha o JSON em cerca de markdown.
    const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(json) as { temas: unknown[] };
    return res.json({ temas: parsed.temas ?? [], total: perguntas.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao gerar ranking';
    return res.status(500).json({ error: message });
  }
}
