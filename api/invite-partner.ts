import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { verifyAuthToken } from './_verifyToken';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

function getUserId(authHeader?: string): string | null {
  return verifyAuthToken(authHeader)?.sub ?? null;
}

function buildPartnerEmail(inviterName: string, inviteUrl: string): string {
  return `<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Convite Kashim</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <!-- Logo -->
          <tr>
            <td style="padding-bottom:28px;text-align:center;">
              <div style="display:inline-flex;align-items:center;gap:10px;">
                <div style="background:#a8e716;border-radius:12px;width:40px;height:40px;display:inline-block;line-height:40px;text-align:center;">
                  <span style="font-size:20px;font-weight:900;color:#182200;">$</span>
                </div>
                <span style="font-size:20px;font-weight:900;color:#1d1d1f;letter-spacing:2px;text-transform:uppercase;font-style:italic;">KASHIM</span>
              </div>
            </td>
          </tr>

          <!-- Card principal -->
          <tr>
            <td style="background:#ffffff;border:1px solid #e8e8ed;border-radius:24px;padding:40px 36px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">

              <!-- Ícone de coração -->
              <div style="text-align:center;margin-bottom:24px;">
                <div style="display:inline-block;background:#f0fad0;border-radius:50%;width:60px;height:60px;line-height:60px;text-align:center;border:1px solid rgba(122,184,0,0.2);">
                  <span style="font-size:26px;">💚</span>
                </div>
              </div>

              <!-- Título -->
              <h1 style="margin:0 0 8px;text-align:center;color:#1d1d1f;font-size:22px;font-weight:900;text-transform:uppercase;letter-spacing:-0.5px;">
                Você foi convidado(a)!
              </h1>
              <p style="margin:0 0 28px;text-align:center;color:#7ab800;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:3px;">
                Modo Casal — Kashim
              </p>

              <!-- Corpo -->
              <p style="margin:0 0 12px;color:#6e6e73;font-size:15px;line-height:1.7;">
                <strong style="color:#1d1d1f;">${inviterName}</strong> está te convidando para organizar as finanças juntos no Kashim.
              </p>
              <p style="margin:0 0 28px;color:#6e6e73;font-size:15px;line-height:1.7;">
                No <strong style="color:#1d1d1f;">Modo Casal</strong>, vocês compartilham o mesmo plano financeiro em tempo real — lançamentos, teto de gastos, metas e muito mais. Tudo junto, do mesmo jeito.
              </p>

              <!-- Benefícios -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid #f5f5f7;">
                    <span style="color:#7ab800;font-size:13px;margin-right:10px;">✓</span>
                    <span style="color:#6e6e73;font-size:13px;">Plano financeiro compartilhado</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid #f5f5f7;">
                    <span style="color:#7ab800;font-size:13px;margin-right:10px;">✓</span>
                    <span style="color:#6e6e73;font-size:13px;">Lançamentos em tempo real</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid #f5f5f7;">
                    <span style="color:#7ab800;font-size:13px;margin-right:10px;">✓</span>
                    <span style="color:#6e6e73;font-size:13px;">Metas e teto de gastos do casal</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;">
                    <span style="color:#7ab800;font-size:13px;margin-right:10px;">✓</span>
                    <span style="color:#6e6e73;font-size:13px;">AICoach financeiro por voz e texto</span>
                  </td>
                </tr>
              </table>

              <!-- Botão CTA -->
              <div style="text-align:center;margin-bottom:28px;">
                <a href="${inviteUrl}"
                   style="display:inline-block;background:linear-gradient(180deg,#c5f23a 0%,#a2d800 50%,#8cc400 100%);color:#182200;font-size:14px;font-weight:900;text-transform:uppercase;letter-spacing:2px;padding:18px 48px;border-radius:14px;text-decoration:none;box-shadow:0 4px 14px rgba(130,192,0,0.35);">
                  Aceitar convite →
                </a>
              </div>

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #f0f0f5;margin:0 0 20px;" />

              <!-- Link de texto -->
              <p style="margin:0;color:#aeaeb2;font-size:11px;text-align:center;line-height:1.8;">
                Se o botão não funcionar, copie e cole este link:<br />
                <a href="${inviteUrl}" style="color:#7ab800;word-break:break-all;font-size:11px;">${inviteUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top:24px;text-align:center;">
              <p style="margin:0;color:#aeaeb2;font-size:11px;line-height:1.7;">
                Kashim — Finanças Pessoais com Coach<br />
                <a href="https://app.kashim.com.br/termos.html" style="color:#aeaeb2;">Política de Privacidade</a>
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

  const userId = getUserId(req.headers.authorization as string);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { email, token, householdId, inviterName } = req.body as {
    email?: string;
    token?: string;
    householdId?: string;
    inviterName?: string;
  };

  if (!email || !token || !householdId) {
    return res.status(400).json({ error: 'email, token e householdId são obrigatórios' });
  }

  // Verifica que o usuário pertence ao household
  const { data: member } = await supabase
    .from('household_members')
    .select('id')
    .eq('household_id', householdId)
    .eq('clerk_user_id', userId)
    .maybeSingle();

  if (!member) return res.status(403).json({ error: 'Sem permissão' });

  const inviteUrl = `https://app.kashim.com.br?invite=${token}`;
  const senderName = inviterName || 'Seu parceiro(a)';

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return res.status(500).json({ error: 'Serviço de email não configurado' });

  try {
    const resend = new Resend(resendKey);
    await resend.emails.send({
      from: 'Kashim <noreply@kashim.com.br>',
      to: email.toLowerCase().trim(),
      subject: `${senderName} te convidou para o Kashim — Finanças do Casal`,
      html: buildPartnerEmail(senderName, inviteUrl),
    });

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('invite-partner error:', err);
    return res.status(500).json({ error: err.message ?? 'Erro ao enviar email' });
  }
}
