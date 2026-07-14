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

    let inviteUrl: string | null = null;
    const debug: Record<string, unknown> = {};

    // Mesmo caminho dos clientes (activate-client + gen-link): garante a conta
    // dela no Clerk e gera um LINK MÁGICO de acesso direto (loga sem senha).
    // Ignora o fluxo de "convite", que estava travado por um convite pendente
    // fantasma que a API não deixava nem listar nem revogar.

    // 1. Ela já tem conta?
    let userId: string | null = null;
    const usersRes = await fetch(
      `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(cleanEmail)}`,
      { headers: clerkHeaders }
    );
    debug.userLookupStatus = usersRes.status;
    if (usersRes.ok) {
      const users = await usersRes.json();
      const arr: any[] = Array.isArray(users) ? users : (users.data ?? []);
      debug.usersFound = arr.length;
      userId = arr[0]?.id ?? null;
    }

    // 2. Não tem: cria a conta direto (skip_password_requirement — ela entra
    //    pelo link mágico e define senha depois se quiser).
    if (!userId) {
      const parts = name.trim().split(' ');
      const firstName = parts[0] || 'Assistente';
      const lastName = parts.slice(1).join(' ') || '';
      const createRes = await fetch('https://api.clerk.com/v1/users', {
        method: 'POST',
        headers: clerkHeaders,
        body: JSON.stringify({
          email_address: [cleanEmail],
          first_name: firstName,
          last_name: lastName,
          skip_password_requirement: true,
          public_metadata: { role: 'assistant' },
        }),
      });
      debug.createUserStatus = createRes.status;
      if (createRes.ok) {
        userId = (await createRes.json()).id ?? null;
      } else {
        debug.createUserError = (await createRes.text()).slice(0, 400);
      }
    }

    // 3. Link mágico de acesso direto
    if (userId) {
      const tokenRes = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
        method: 'POST',
        headers: clerkHeaders,
        body: JSON.stringify({ user_id: userId, expires_in_seconds: 7 * 24 * 60 * 60 }),
      });
      debug.tokenStatus = tokenRes.status;
      if (tokenRes.ok) {
        const t = (await tokenRes.json()).token;
        if (t) inviteUrl = `https://app.kashim.com.br?sign_in_token=${t}`;
      } else {
        debug.tokenError = (await tokenRes.text()).slice(0, 300);
      }
    }

    return res.status(200).json({ ok: true, inviteUrl, alreadyHasAccount: false, debug });
  } catch (err: any) {
    console.error('invite-assistant error:', err);
    return res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
}
