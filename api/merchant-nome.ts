import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

/**
 * O cliente batiza o estabelecimento — e o nome vale para todo mundo.
 *
 * Quando ele renomeia um gasto ("AC ANTONIO FARIA" → "Malharia"), esse nome
 * morria dentro do lançamento dele. Guardado aqui, a próxima pessoa que gastar
 * no mesmo lugar já vê o nome certo, sem consulta a API nenhuma
 * (Eduardo, 2026-09-20).
 *
 * `confirmacoes` conta quantas pessoas escreveram o mesmo nome: é por ela que
 * dá para separar o apelido consolidado do chute de um cliente só. Nome novo
 * não sobrescreve o que já existe com mais confirmações.
 */

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';

function verifyAuthToken(authHeader?: string): { sub: string } | null {
  if (!SUPABASE_JWT_SECRET) return null;
  const token = (authHeader ?? '').replace('Bearer ', '').trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const [h, p, sig] = parts;
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    if (header.alg !== 'HS256') return null;
    const expected = createHmac('sha256', SUPABASE_JWT_SECRET).update(`${h}.${p}`).digest();
    const provided = Buffer.from(sig, 'base64url');
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (!claims.sub) return null;
    if (typeof claims.exp === 'number' && claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

/** Mesma normalização do cron e da memória de categoria: grafias diferentes nunca se encontram. */
function chaveDaDescricao(texto: string): string {
  return texto
    .replace(/\s+\d{2}\/\d{2}$/, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  const { textoDoBanco, nome } = req.body as { textoDoBanco?: string; nome?: string };
  const cru = (textoDoBanco ?? '').trim();
  const bonito = (nome ?? '').trim().slice(0, 60);
  if (!cru || bonito.length < 2) return res.status(400).json({ error: 'textoDoBanco e nome são obrigatórios' });

  const chave = `desc:${chaveDaDescricao(cru)}`;
  if (chave.length < 8) return res.status(200).json({ ok: true, ignorado: 'texto curto demais para virar chave' });

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: existente } = await db
    .from('merchant_directory')
    .select('id, nome, fonte, confirmacoes')
    .eq('chave', chave)
    .maybeSingle();

  if (!existente) {
    const { error } = await db.from('merchant_directory').insert({
      chave, nome: bonito, fonte: 'cliente', confirmacoes: 1, origem_texto: cru.slice(0, 120),
    });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, acao: 'criado', nome: bonito });
  }

  const mesmoNome = (existente.nome as string).toLowerCase() === bonito.toLowerCase();
  if (mesmoNome) {
    await db.from('merchant_directory')
      .update({ confirmacoes: (existente.confirmacoes as number) + 1, updated_at: new Date().toISOString() })
      .eq('id', existente.id);
    return res.status(200).json({ ok: true, acao: 'confirmado', nome: existente.nome });
  }

  // Nome diferente: só substitui o que veio de consulta automática, e apenas
  // enquanto ninguém mais tiver confirmado o nome atual.
  const podeTrocar = existente.fonte !== 'manual' && (existente.confirmacoes as number) <= 1;
  if (podeTrocar) {
    await db.from('merchant_directory')
      .update({ nome: bonito, fonte: 'cliente', updated_at: new Date().toISOString() })
      .eq('id', existente.id);
    return res.status(200).json({ ok: true, acao: 'substituido', nome: bonito });
  }

  return res.status(200).json({ ok: true, acao: 'mantido', nome: existente.nome });
}
