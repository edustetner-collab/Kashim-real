import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email, name, balance, totalIncome, totalCost, accumulated, monthName } = req.body;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  const isPositive = balance >= 0;
  const balanceFormatted = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Math.abs(balance));
  const incomeFormatted = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalIncome);
  const costFormatted = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalCost);
  const accFormatted = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(accumulated);

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#050505;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#fff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#050505;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;">
        <!-- Logo -->
        <tr><td style="padding-bottom:32px;text-align:center;">
          <div style="display:inline-block;background:#111;border:1px solid #333;border-radius:20px;padding:12px 24px;">
            <span style="font-size:18px;font-weight:900;font-style:italic;letter-spacing:-0.5px;color:#fff;text-transform:uppercase;">Kashim</span>
          </div>
        </td></tr>

        <!-- Greeting -->
        <tr><td style="padding-bottom:24px;">
          <p style="margin:0;font-size:13px;color:#888;text-transform:uppercase;letter-spacing:2px;font-weight:700;">Resumo — ${monthName ?? 'Mês atual'}</p>
          <h1 style="margin:8px 0 0;font-size:24px;font-weight:900;font-style:italic;text-transform:uppercase;letter-spacing:-1px;">Olá, ${name ?? 'Guerreiro'}!</h1>
        </td></tr>

        <!-- Balance card -->
        <tr><td style="padding-bottom:16px;">
          <table width="100%" style="background:${isPositive ? '#052e16' : '#1a0000'};border:1px solid ${isPositive ? '#14532d' : '#450a0a'};border-radius:20px;padding:24px;">
            <tr><td>
              <p style="margin:0 0 4px;font-size:10px;color:${isPositive ? '#4ade80' : '#f87171'};text-transform:uppercase;font-weight:700;letter-spacing:2px;">${isPositive ? 'SOBRA DO MÊS' : 'FALTA DO MÊS'}</p>
              <p style="margin:0;font-size:36px;font-weight:900;font-style:italic;color:${isPositive ? '#4ade80' : '#f87171'};font-family:monospace;">${isPositive ? '+' : '-'}${balanceFormatted}</p>
            </td></tr>
          </table>
        </td></tr>

        <!-- Stats row -->
        <tr><td style="padding-bottom:24px;">
          <table width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td style="width:50%;padding-right:8px;">
                <table width="100%" style="background:#111;border:1px solid #222;border-radius:16px;padding:16px;">
                  <tr><td>
                    <p style="margin:0 0 4px;font-size:9px;color:#888;text-transform:uppercase;letter-spacing:2px;font-weight:700;">Entradas</p>
                    <p style="margin:0;font-size:18px;font-weight:900;color:#4ade80;font-family:monospace;">${incomeFormatted}</p>
                  </td></tr>
                </table>
              </td>
              <td style="width:50%;padding-left:8px;">
                <table width="100%" style="background:#111;border:1px solid #222;border-radius:16px;padding:16px;">
                  <tr><td>
                    <p style="margin:0 0 4px;font-size:9px;color:#888;text-transform:uppercase;letter-spacing:2px;font-weight:700;">Gastos</p>
                    <p style="margin:0;font-size:18px;font-weight:900;color:#f87171;font-family:monospace;">${costFormatted}</p>
                  </td></tr>
                </table>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Accumulated -->
        <tr><td style="padding-bottom:32px;">
          <table width="100%" style="background:#1c1500;border:1px solid #713f12;border-radius:16px;padding:16px;">
            <tr><td>
              <p style="margin:0 0 4px;font-size:9px;color:#ca8a04;text-transform:uppercase;letter-spacing:2px;font-weight:700;">Acumulado Rico</p>
              <p style="margin:0;font-size:22px;font-weight:900;color:#eab308;font-family:monospace;">${accFormatted}</p>
            </td></tr>
          </table>
        </td></tr>

        <!-- CTA -->
        <tr><td style="text-align:center;padding-bottom:32px;">
          <a href="https://app.kashim.com.br" style="display:inline-block;background:#ca8a04;color:#000;font-size:11px;font-weight:900;text-decoration:none;text-transform:uppercase;letter-spacing:2px;padding:14px 32px;border-radius:16px;">Ver meu plano completo</a>
        </td></tr>

        <!-- Footer -->
        <tr><td style="text-align:center;border-top:1px solid #222;padding-top:24px;">
          <p style="margin:0;font-size:10px;color:#444;">Você está recebendo este e-mail porque ativou o resumo semanal no Kashim.</p>
          <p style="margin:4px 0 0;font-size:10px;color:#333;">kashim.com.br</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await resend.emails.send({
      from: 'Kashim <noreply@kashim.com.br>',
      to: email,
      subject: `${isPositive ? '✅' : '⚠️'} Seu resumo Kashim — ${monthName ?? 'este mês'}`,
      html,
    });
    res.status(200).json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
