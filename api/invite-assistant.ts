import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { verifyAdminToken } from '../lib/verifyToken';

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

    // Cria o convite no Clerk (sem notificação padrão deles)
    let inviteUrl = 'https://app.kashim.com.br';
    const inviteRes = await fetch('https://api.clerk.com/v1/invitations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLERK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email_address: email.toLowerCase().trim(),
        notify: false, // vamos mandar o nosso email
        redirect_url: 'https://app.kashim.com.br',
        public_metadata: { role: 'assistant' },
      }),
    });

    let alreadyExists = false;
    if (!inviteRes.ok) {
      const err = await inviteRes.json();
      const msg: string = err.errors?.[0]?.long_message ?? err.errors?.[0]?.message ?? '';
      if (msg.toLowerCase().includes('already') || err.errors?.[0]?.code === 'duplicate_record') {
        alreadyExists = true;
      } else {
        throw new Error(msg || 'Erro ao criar convite no Clerk');
      }
    } else {
      const clerkData = await inviteRes.json();
      if (clerkData.url) inviteUrl = clerkData.url;
    }

    // Envia o email bonito via Resend
    if (RESEND_API_KEY && !alreadyExists) {
      const resend = new Resend(RESEND_API_KEY);
      await resend.emails.send({
        from: 'Kashim <noreply@app.kashim.com.br>',
        to: email.toLowerCase().trim(),
        subject: `${name}, você foi convidada para a equipe Kashim`,
        html: buildInviteEmail(name, email, inviteUrl),
      });
    }

    return res.status(200).json({ ok: true, alreadyExists });
  } catch (err: any) {
    console.error('invite-assistant error:', err);
    return res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
}
