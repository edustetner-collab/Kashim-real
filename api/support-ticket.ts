import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Suporte: o cliente abre um chamado de dentro do app.
//
// Grava no banco (histórico e status) e avisa o Eduardo por e-mail. Só e-mail
// perderia chamado na caixa de entrada e não guardaria o contexto técnico que
// o app anexa sozinho — tela, versão do build, navegador.
//
// O print sobe pela ROTA, com a service key, e não pelo cliente: assim o
// bucket fica privado e não é preciso abrir policy de storage para o anon.
//
// verifyAuthToken está duplicado aqui de propósito: a Vercel não empacota
// import local em api/ (ver CLAUDE.md).

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'kashimappbr@gmail.com';

/** Print grande é recusado antes de chegar no storage. O app já comprime. */
const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024;
const MAX_MENSAGEM = 4000;

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

function buildEmail(nome: string, email: string, mensagem: string, contexto: Record<string, unknown>, temPrint: boolean) {
  const linhas = Object.entries(contexto)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6e6e73;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:4px 0;color:#1d1d1f"><code>${escapeHtml(String(v))}</code></td></tr>`)
    .join('');

  return `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:28px 20px">
    <div style="background:#fff;border:1px solid #e8e8ed;border-radius:16px;overflow:hidden">
      <div style="background:#1d1d1f;padding:18px 24px">
        <p style="margin:0;color:#a8e716;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase">Kashim · Suporte</p>
        <p style="margin:4px 0 0;color:#fff;font-size:19px;font-weight:800">Novo chamado</p>
      </div>
      <div style="padding:22px 24px">
        <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#1d1d1f">${escapeHtml(nome || 'Cliente')}</p>
        <p style="margin:0 0 18px;font-size:13px;color:#6e6e73">${escapeHtml(email || 'sem e-mail')}</p>
        <div style="background:#f5f5f7;border-radius:12px;padding:16px;margin-bottom:18px">
          <p style="margin:0;font-size:14px;line-height:1.6;color:#1d1d1f;white-space:pre-wrap">${escapeHtml(mensagem)}</p>
        </div>
        ${temPrint ? '<p style="margin:0 0 18px;font-size:13px;color:#5c8a06;font-weight:600">📎 O cliente anexou um print — está no chamado, no painel.</p>' : ''}
        <p style="margin:0 0 8px;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#aeaeb2">Onde aconteceu</p>
        <table style="width:100%;border-collapse:collapse;font-size:12px">${linhas}</table>
      </div>
    </div>
  </div></body></html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  const { mensagem, nome, email, screenshot, contexto } = (req.body ?? {}) as {
    mensagem?: string; nome?: string; email?: string;
    screenshot?: string; contexto?: Record<string, unknown>;
  };

  const texto = (mensagem ?? '').trim();
  if (!texto) return res.status(400).json({ error: 'Escreva o que aconteceu para podermos ajudar.' });
  if (texto.length > MAX_MENSAGEM) return res.status(400).json({ error: 'Mensagem muito longa.' });

  try {
    const { data: membership } = await db
      .from('household_members')
      .select('household_id')
      .eq('clerk_user_id', claims.sub)
      .maybeSingle();

    // Print: chega em base64 e sobe pela rota, para o bucket seguir privado.
    let screenshotUrl: string | null = null;
    if (typeof screenshot === 'string' && screenshot.startsWith('data:image/')) {
      const base64 = screenshot.slice(screenshot.indexOf(',') + 1);
      const bytes = Buffer.from(base64, 'base64');
      if (bytes.length > MAX_SCREENSHOT_BYTES) {
        return res.status(400).json({ error: 'A imagem é grande demais. Tente um print menor.' });
      }
      const ext = screenshot.slice(11, screenshot.indexOf(';')) || 'jpeg';
      const path = `${claims.sub}/${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext}`;
      const { error: upErr } = await db.storage
        .from('support')
        .upload(path, bytes, { contentType: `image/${ext}`, upsert: false });
      // Anexo é acessório: se falhar, o chamado ainda tem que chegar.
      if (!upErr) screenshotUrl = path;
    }

    const ctx = { ...(contexto ?? {}), userId: claims.sub };

    const { data: ticket, error } = await db
      .from('support_tickets')
      .insert({
        household_id: membership?.household_id ?? null,
        clerk_user_id: claims.sub,
        nome: nome ?? null,
        email: email ?? null,
        mensagem: texto,
        screenshot_url: screenshotUrl,
        contexto: ctx,
      })
      .select('id')
      .single();

    if (error) throw new Error(error.message);

    // E-mail é aviso, não armazenamento: o chamado já está salvo. Falha aqui
    // não pode devolver erro para o cliente, que faria ele mandar de novo.
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        await new Resend(resendKey).emails.send({
          from: 'Kashim <noreply@kashim.com.br>',
          to: SUPPORT_EMAIL,
          replyTo: email || undefined,
          subject: `[Suporte] ${nome || 'Cliente'} — ${texto.slice(0, 60)}${texto.length > 60 ? '…' : ''}`,
          html: buildEmail(nome ?? '', email ?? '', texto, ctx, !!screenshotUrl),
        });
      } catch (mailErr) {
        console.error('support-ticket: falha ao enviar e-mail', mailErr);
      }
    }

    return res.status(200).json({ ok: true, id: ticket.id });
  } catch (err: any) {
    console.error('support-ticket error:', err);
    return res.status(500).json({ error: 'Não conseguimos registrar seu chamado. Tente de novo em instantes.' });
  }
}
