import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

/**
 * Guarda o que existia ANTES de o plano recomeçar no mês atual.
 *
 * Quando um cliente antigo conecta o banco, o plano é reprojetado para o mês
 * corrente — sem isso, as faturas reais aparecem em meses que ele nunca
 * planejou e o número fica impossível de interpretar (o caso do Michael,
 * 2026-09-20). Reprojetar apaga os meses anteriores do painel, então o
 * histórico precisa ir para um lugar de onde ele possa voltar: o e-mail dele.
 *
 * O resumo chega pronto da tela, que é quem já sabe somar cada mês. Duplicar
 * essa matemática aqui criaria duas verdades.
 */

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? '';
const resend = new Resend(process.env.RESEND_API_KEY);

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

const dinheiro = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface MesDoHistorico {
  mes: string;
  entradas: number;
  custos: number;
  sobra: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  const { householdId, meses } = req.body as { householdId?: string; meses?: MesDoHistorico[] };
  if (!householdId || !Array.isArray(meses) || meses.length === 0) {
    return res.status(400).json({ error: 'householdId e meses são obrigatórios' });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Só quem é da casa pede o próprio histórico.
  const { data: membro } = await db
    .from('household_members')
    .select('id')
    .eq('household_id', householdId)
    .eq('clerk_user_id', claims.sub)
    .maybeSingle();
  if (!membro) return res.status(403).json({ error: 'Forbidden' });

  // E-mail do próprio usuário que está pedindo, pelo Clerk.
  let email = '';
  let primeiroNome = '';
  try {
    const r = await fetch(`https://api.clerk.com/v1/users/${claims.sub}`, {
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    });
    if (r.ok) {
      const u = await r.json() as { email_addresses?: Array<{ email_address?: string }>; first_name?: string };
      email = u.email_addresses?.[0]?.email_address ?? '';
      primeiroNome = u.first_name ?? '';
    }
  } catch { /* segue sem nome */ }
  if (!email) return res.status(200).json({ ok: false, motivo: 'Usuário sem e-mail no cadastro' });

  const linhas = meses.map(m => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${m.mes}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">${dinheiro(m.entradas)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">${dinheiro(m.custos)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;color:${m.sobra >= 0 ? '#5a8c00' : '#c62828'}">${dinheiro(m.sobra)}</td>
    </tr>`).join('');

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#1d1d1f">
      <h2 style="font-size:20px;margin:0 0 6px">${primeiroNome ? `${primeiroNome}, seu` : 'Seu'} histórico antes do banco conectado</h2>
      <p style="color:#6e6e73;font-size:14px;line-height:1.5;margin:0 0 16px">
        Seu plano recomeçou no mês atual para funcionar junto com o seu banco. Os meses anteriores saíram do
        painel, e estão guardados aqui.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#f5f5f7">
            <th style="padding:8px 12px;text-align:left">Mês</th>
            <th style="padding:8px 12px;text-align:right">Entradas</th>
            <th style="padding:8px 12px;text-align:right">Custos</th>
            <th style="padding:8px 12px;text-align:right">Sobra</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
      <p style="color:#6e6e73;font-size:13px;line-height:1.5;margin:16px 0 0">
        Guarde este e-mail: ele é o registro do período anterior. Do mês atual em diante, seus gastos chegam
        sozinhos do banco e é só categorizar.
      </p>
    </div>`;

  try {
    await resend.emails.send({
      from: 'Kashim <noreply@kashim.com.br>',
      to: email,
      subject: '📁 Seu histórico no Kashim antes do banco conectado',
      html,
    });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Falha ao enviar' });
  }

  return res.status(200).json({ ok: true, enviadoPara: email, meses: meses.length });
}
