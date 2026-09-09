import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

// ─── Auth ─────────────────────────────────────────────────────────────────────

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';

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

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function isMember(sub: string, householdId: string): Promise<boolean> {
  if (ADMIN_IDS.includes(sub)) return true;
  const { data } = await db
    .from('household_members')
    .select('id')
    .eq('household_id', householdId)
    .eq('clerk_user_id', sub)
    .maybeSingle();
  return !!data;
}

// ─── Identificação de assinatura ──────────────────────────────────────────────

const SUBSCRIPTION_CODES = new Set(['SUBSCRIPTION', 'DIGITALSERVICES']);

// Mesma regex de categoryMap.ts — "Netflix" é conta fixa no método do Kashim.
const SUBSCRIPTION_RE = /\b(netflix|spotify|youtube|prime\s*video|disney\+?|hbo|max\s*stream|globoplay|paramount|deezer|apple\s*(music|tv\+?|one)|icloud|google\s*(one|drive|storage)|dropbox|onedrive|canva|adobe|chatgpt|openai|microsoft\s*365|office\s*365)/i;

function ehAssinatura(ofCode: string | null, merchant: string | null, description: string | null): boolean {
  if (ofCode && SUBSCRIPTION_CODES.has(ofCode.toUpperCase())) return true;
  const texto = merchant ?? description ?? '';
  return SUBSCRIPTION_RE.test(texto);
}

// ─── Normalização do nome ─────────────────────────────────────────────────────

// Serviços conhecidos → nome limpo para exibição.
const NOME_LIMPO: Array<[RegExp, string]> = [
  [/netflix/i,                              'Netflix'],
  [/spotify/i,                              'Spotify'],
  [/youtube/i,                              'YouTube Premium'],
  [/prime\s*video|amazon\s*prime/i,         'Amazon Prime'],
  [/disney/i,                               'Disney+'],
  [/hbo|max\s*stream/i,                     'Max (HBO)'],
  [/globoplay/i,                            'Globoplay'],
  [/paramount/i,                            'Paramount+'],
  [/deezer/i,                               'Deezer'],
  [/apple\s*music/i,                        'Apple Music'],
  [/apple\s*tv/i,                           'Apple TV+'],
  [/apple\s*one/i,                          'Apple One'],
  [/icloud/i,                               'iCloud+'],
  [/google\s*one/i,                         'Google One'],
  [/dropbox/i,                              'Dropbox'],
  [/onedrive/i,                             'OneDrive'],
  [/canva/i,                                'Canva Pro'],
  [/adobe/i,                                'Adobe Creative'],
  [/chatgpt|openai/i,                       'ChatGPT Plus'],
  [/microsoft\s*365|office\s*365/i,         'Microsoft 365'],
];

function nomeLimpo(merchant: string | null, description: string | null): string {
  const texto = merchant ?? description ?? '';
  for (const [re, nome] of NOME_LIMPO) {
    if (re.test(texto)) return nome;
  }
  // Fallback: usa o que veio, truncado
  return (merchant ?? description ?? 'Assinatura').slice(0, 40).trim();
}

// Chave de agrupamento: nome limpo normalizado (sem acento, minúsculo).
function chaveGrupo(merchant: string | null, description: string | null): string {
  return nomeLimpo(merchant, description)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim();
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization as string);
  if (!claims) return res.status(401).json({ error: 'unauthorized' });

  const householdId = req.query.householdId as string;
  if (!householdId) return res.status(400).json({ error: 'householdId required' });

  if (!(await isMember(claims.sub, householdId))) return res.status(403).json({ error: 'forbidden' });

  // Busca transações categorizadas como despesa, sem filtro extra no SQL —
  // a identificação de assinatura é feita em JS porque cruza código E nome.
  const { data, error } = await db
    .from('bank_transactions')
    .select('of_code, merchant, description, amount, transaction_date')
    .eq('household_id', householdId)
    .eq('status', 'categorized')
    .eq('transaction_type', 'expense')
    .order('transaction_date', { ascending: false })
    .limit(800);

  if (error) return res.status(500).json({ error: 'db error' });

  // Filtra assinaturas e agrupa por serviço.
  const grupos = new Map<string, { nome: string; valor: number; ultimaData: string; ocorrencias: number }>();

  for (const row of (data ?? [])) {
    if (!ehAssinatura(row.of_code, row.merchant, row.description)) continue;

    const chave = chaveGrupo(row.merchant, row.description);
    const nome = nomeLimpo(row.merchant, row.description);
    const valor = Number(row.amount);
    const data_ = row.transaction_date as string;

    const existente = grupos.get(chave);
    if (!existente) {
      grupos.set(chave, { nome, valor, ultimaData: data_, ocorrencias: 1 });
    } else {
      existente.ocorrencias += 1;
      // Mantém o valor da cobrança mais recente (já está ordenado DESC).
    }
  }

  const assinaturas = Array.from(grupos.values())
    .sort((a, b) => b.valor - a.valor);

  return res.status(200).json({ assinaturas });
}
