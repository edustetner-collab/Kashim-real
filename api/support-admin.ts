import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Gestão dos chamados de suporte — SÓ super-admin (ADMIN_USER_IDS).
//
//   GET                       lista os chamados (mais novos primeiro)
//   GET  ?count=1             só a contagem de abertos (para o sino)
//   PATCH { id, status }      muda o status
//   PATCH { id, resposta }    responde e avisa o cliente por e-mail
//
// A URL do print é assinada na hora e vale 1 hora: o bucket é privado porque
// print de tela financeira não pode ficar exposto em link permanente.
//
// verifyAuthToken duplicado de propósito: a Vercel não empacota import local
// em api/ (ver CLAUDE.md).

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

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
    return { sub: claims.sub };
  } catch {
    return null;
  }
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function buildRespostaEmail(nome: string, pergunta: string, resposta: string) {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:28px 20px">
    <div style="background:#fff;border:1px solid #e8e8ed;border-radius:16px;overflow:hidden">
      <div style="background:#1d1d1f;padding:18px 24px">
        <p style="margin:0;color:#a8e716;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase">Kashim · Suporte</p>
        <p style="margin:4px 0 0;color:#fff;font-size:19px;font-weight:800">Respondemos seu chamado</p>
      </div>
      <div style="padding:22px 24px">
        <p style="margin:0 0 16px;font-size:15px;color:#1d1d1f">Oi${nome ? ` ${escapeHtml(nome.split(' ')[0])}` : ''},</p>
        <div style="background:#f0fad0;border-left:3px solid #7ab800;border-radius:0 12px 12px 0;padding:16px;margin-bottom:20px">
          <p style="margin:0;font-size:14px;line-height:1.65;color:#1d1d1f;white-space:pre-wrap">${escapeHtml(resposta)}</p>
        </div>
        <p style="margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#aeaeb2">Seu chamado</p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#6e6e73;white-space:pre-wrap">${escapeHtml(pergunta)}</p>
        <p style="margin:22px 0 0;font-size:13px;color:#6e6e73">Precisa de mais alguma coisa? É só responder este e-mail.</p>
      </div>
    </div>
  </div></body></html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');

  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims || !ADMIN_IDS.includes(claims.sub)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    if (req.method === 'GET') {
      // Só a contagem — é o que o sino pede, e não traz dado sensível junto.
      if (req.query.count) {
        const { count } = await db
          .from('support_tickets')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'aberto');
        return res.status(200).json({ abertos: count ?? 0 });
      }

      const { data, error } = await db
        .from('support_tickets')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);

      // URL assinada por 1h. Link permanente de print financeiro não existe.
      const tickets = await Promise.all((data ?? []).map(async t => {
        let printUrl: string | null = null;
        if (t.screenshot_url) {
          const { data: signed } = await db.storage.from('support').createSignedUrl(t.screenshot_url, 3600);
          printUrl = signed?.signedUrl ?? null;
        }
        return { ...t, printUrl };
      }));

      return res.status(200).json({ tickets, abertos: tickets.filter(t => t.status === 'aberto').length });
    }

    if (req.method === 'PATCH') {
      const { id, status, resposta } = (req.body ?? {}) as { id?: string; status?: string; resposta?: string };
      if (!id) return res.status(400).json({ error: 'id obrigatório' });

      const patch: Record<string, unknown> = {};
      if (status && ['aberto', 'respondido', 'resolvido'].includes(status)) patch.status = status;

      if (typeof resposta === 'string' && resposta.trim()) {
        patch.resposta = resposta.trim();
        patch.respondido_em = new Date().toISOString();
        if (!patch.status) patch.status = 'respondido';
      }
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nada para atualizar' });

      const { data: ticket, error } = await db
        .from('support_tickets')
        .update(patch)
        .eq('id', id)
        .select('nome, email, mensagem, resposta')
        .single();
      if (error) throw new Error(error.message);

      // Resposta nova → avisa o cliente. Falha de e-mail não desfaz o que já
      // foi gravado; o Eduardo vê o status atualizado de qualquer forma.
      const resendKey = process.env.RESEND_API_KEY;
      if (patch.resposta && resendKey && ticket?.email) {
        try {
          await new Resend(resendKey).emails.send({
            from: 'Kashim <noreply@kashim.com.br>',
            to: ticket.email,
            subject: 'Respondemos seu chamado — Kashim',
            html: buildRespostaEmail(ticket.nome ?? '', ticket.mensagem ?? '', String(patch.resposta)),
          });
        } catch (mailErr) {
          console.error('support-admin: falha ao avisar o cliente', mailErr);
        }
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    console.error('support-admin error:', err);
    return res.status(500).json({ error: err.message ?? 'Erro' });
  }
}
