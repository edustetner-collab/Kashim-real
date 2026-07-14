import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { createHmac, timingSafeEqual } from 'node:crypto';

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
function verifyAdminToken(authHeader?: string): string | null {
  const claims = verifyAuthToken(authHeader);
  if (!claims) return null;
  const adminIds = (process.env.ADMIN_USER_IDS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return adminIds.includes(claims.sub) ? claims.sub : null;
}

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const RESEND_API_KEY = process.env.RESEND_API_KEY;

function getSuperAdminId(authHeader: string): string | null {
  return verifyAdminToken(authHeader);
}

function buildInviteEmail(name: string, email: string, inviteUrl: string): string {
  return `<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Convite Kashim</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <!-- Logo + Header -->
          <tr>
            <td style="padding-bottom:32px;text-align:center;">
              <div style="display:inline-block;background:#111;border:1px solid #2a2a2a;border-radius:16px;padding:16px 28px;">
                <span style="font-size:22px;font-weight:900;color:#EAB308;letter-spacing:4px;text-transform:uppercase;font-style:italic;">KASHIM</span>
              </div>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td style="background:#111111;border:1px solid #1f1f1f;border-radius:24px;padding:40px 36px;">

              <!-- Icon -->
              <div style="text-align:center;margin-bottom:28px;">
                <div style="display:inline-block;background:#EAB308;border-radius:50%;width:56px;height:56px;line-height:56px;text-align:center;">
                  <span style="font-size:24px;">★</span>
                </div>
              </div>

              <!-- Title -->
              <h1 style="margin:0 0 8px;text-align:center;color:#ffffff;font-size:24px;font-weight:900;text-transform:uppercase;letter-spacing:-0.5px;font-style:italic;">
                Você foi convidada
              </h1>
              <p style="margin:0 0 28px;text-align:center;color:#EAB308;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:3px;">
                para a equipe Kashim
              </p>

              <!-- Body text -->
              <p style="margin:0 0 12px;color:#a1a1aa;font-size:15px;line-height:1.6;">
                Olá, <strong style="color:#ffffff;">${name}</strong>!
              </p>
              <p style="margin:0 0 28px;color:#a1a1aa;font-size:15px;line-height:1.6;">
                Você foi adicionada como <strong style="color:#EAB308;">Assistente Consultora</strong> no Kashim. Crie sua conta para acessar o painel e começar a apoiar os clientes da equipe.
              </p>

              <!-- CTA Button -->
              <div style="text-align:center;margin-bottom:28px;">
                <a href="${inviteUrl}" style="display:inline-block;background:#EAB308;color:#000000;font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:2px;padding:16px 40px;border-radius:14px;text-decoration:none;">
                  Criar minha conta →
                </a>
              </div>

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #1f1f1f;margin:0 0 20px;" />

              <!-- Link fallback -->
              <p style="margin:0;color:#52525b;font-size:11px;text-align:center;line-height:1.6;">
                Se o botão não funcionar, copie e cole este link no navegador:<br />
                <a href="${inviteUrl}" style="color:#EAB308;word-break:break-all;">${inviteUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top:24px;text-align:center;">
              <p style="margin:0;color:#3f3f46;font-size:11px;line-height:1.6;">
                Kashim · Sistema de Gestão Financeira<br />
                Este convite é pessoal e intransferível.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const requesterId = getSuperAdminId(req.headers.authorization ?? '');
  if (!requesterId) return res.status(403).json({ error: 'Forbidden' });

  const { email, name } = req.body;
  if (!email || !name) return res.status(400).json({ error: 'email e name são obrigatórios' });

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Salva na tabela admin_users
    const { error: dbError } = await db.from('admin_users').upsert(
      { email: email.toLowerCase().trim(), name: name.trim(), added_by: requesterId },
      { onConflict: 'email' }
    );
    if (dbError) throw dbError;

    const cleanEmail = email.toLowerCase().trim();
    const clerkHeaders = {
      Authorization: `Bearer ${CLERK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    };
    const INVITES = 'https://api.clerk.com/v1/invitations';
    const inviteBody = JSON.stringify({
      email_address: cleanEmail,
      notify: false, // enviamos nosso próprio e-mail
      redirect_url: 'https://app.kashim.com.br',
      public_metadata: { role: 'assistant' },
    });

    // Cria o convite no Clerk e devolve a URL. Se já existir um convite
    // PENDENTE (o motivo dela não conseguir entrar), revoga e recria — assim
    // sempre há um link novo e válido para mandar no WhatsApp.
    let inviteUrl: string | null = null;
    let alreadyHasAccount = false;

    const first = await fetch(INVITES, { method: 'POST', headers: clerkHeaders, body: inviteBody });
    if (first.ok) {
      inviteUrl = (await first.json()).url ?? null;
    } else {
      const err = await first.json();
      const msg: string = (err.errors?.[0]?.long_message ?? err.errors?.[0]?.message ?? '').toLowerCase();
      const isDuplicate = msg.includes('already') || err.errors?.[0]?.code === 'duplicate_record';
      if (!isDuplicate) throw new Error(msg || 'Erro ao criar convite no Clerk');

      // Revoga convites pendentes deste e-mail e tenta recriar
      const listRes = await fetch(`${INVITES}?status=pending&limit=100`, { headers: clerkHeaders });
      let revokedAny = false;
      if (listRes.ok) {
        const list = await listRes.json();
        const arr: any[] = Array.isArray(list) ? list : (list.data ?? []);
        const pending = arr.filter(i => (i.email_address ?? '').toLowerCase() === cleanEmail);
        for (const inv of pending) {
          await fetch(`${INVITES}/${inv.id}/revoke`, { method: 'POST', headers: clerkHeaders }).catch(() => {});
          revokedAny = true;
        }
      }
      if (revokedAny) {
        const retry = await fetch(INVITES, { method: 'POST', headers: clerkHeaders, body: inviteBody });
        if (retry.ok) inviteUrl = (await retry.json()).url ?? null;
      }
      // Sem convite pendente para revogar = ela JÁ tem conta no Clerk: é só logar
      if (!inviteUrl) alreadyHasAccount = true;
    }

    // Envia o email bonito via Resend (best-effort; o link na tela é o principal)
    if (RESEND_API_KEY && inviteUrl) {
      const resend = new Resend(RESEND_API_KEY);
      await resend.emails.send({
        from: 'Kashim <noreply@app.kashim.com.br>',
        to: cleanEmail,
        subject: `${name}, você foi convidada para a equipe Kashim`,
        html: buildInviteEmail(name, email, inviteUrl),
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, inviteUrl, alreadyHasAccount });
  } catch (err: any) {
    console.error('invite-assistant error:', err);
    return res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
}
