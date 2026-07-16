import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

// ─── Régua de e-mails do trial ───────────────────────────────────────────────
// Roda 1x/dia via Vercel Cron (vercel.json). Para cada household sem coach
// ativo e sem assinatura paga, calcula quantos dias faltam para o trial acabar
// e dispara e-mail nos marcos 30 / 15 / 7 / 1 / 0 dias. Dedup na tabela
// trial_emails (docs/sql/trial-emails.sql) — cada marco é enviado UMA vez.
// O app nativo não pode mencionar pagamento (Apple 3.1.1) — este e-mail é o
// canal oficial que direciona o usuário para assinar na web.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const CRON_SECRET = process.env.CRON_SECRET ?? '';
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// Espelho da regra de lib/access.ts (embutido: Vercel não empacota import
// local em api/ — ver memória do projeto). Manter em sincronia!
const TRIAL_MONTHS_COACH_CLIENT = 5;
const TRIAL_DAYS_SELF_SIGNUP = 30;
const SELF_SIGNUP_CUTOFF = new Date('2026-07-16T23:59:59-03:00');

const MILESTONES = [30, 15, 7, 1, 0] as const;
type Milestone = (typeof MILESTONES)[number];

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
function daysUntil(target: Date): number {
  return Math.ceil((target.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function trialEndFor(createdAt: string, isCoachClient: boolean): Date {
  const created = new Date(createdAt);
  const keepsLaunchPromo = created <= SELF_SIGNUP_CUTOFF;
  return isCoachClient || keepsLaunchPromo
    ? addMonths(created, TRIAL_MONTHS_COACH_CLIENT)
    : addDays(created, TRIAL_DAYS_SELF_SIGNUP);
}

// ─── Conteúdo por marco ──────────────────────────────────────────────────────

interface MilestoneCopy {
  subject: string;
  emoji: string;
  title: string;
  tagline: string;
  body1: string;
  body2: string;
  cta: string;
}

function copyFor(milestone: Milestone, firstName: string): MilestoneCopy {
  const name = firstName || 'Guerreiro(a)';
  switch (milestone) {
    case 30:
      return {
        subject: '🎉 Seus 30 dias grátis no Kashim começaram!',
        emoji: '🚀',
        title: `Bem-vindo(a), ${name}!`,
        tagline: 'Seu período gratuito começou',
        body1: 'Você tem <strong style="color:#1d1d1f;">30 dias grátis</strong> para experimentar tudo que o Kashim oferece: planejamento dos 12 meses, diagnóstico em tempo real, teto de gastos, metas e o AICoach.',
        body2: 'Dica de quem entende: quem lança os gastos na primeira semana tem 3x mais chance de fechar o mês no azul. Comece hoje!',
        cta: 'Começar agora',
      };
    case 15:
      return {
        subject: `${name}, metade do seu período gratuito já foi — como está sua organização?`,
        emoji: '📊',
        title: 'Você está na metade!',
        tagline: '15 dias grátis restantes',
        body1: `Já se passaram 15 dias, ${name}. Como está a sua organização financeira? Se ainda não montou seu plano completo, este é o momento.`,
        body2: 'Para não perder o acesso ao seu plano depois do período gratuito, você pode assinar a qualquer momento pelo site.',
        cta: 'Ver meu plano',
      };
    case 7:
      return {
        subject: `⏳ ${name}, faltam 7 dias do seu acesso gratuito ao Kashim`,
        emoji: '⏳',
        title: 'Faltam 7 dias',
        tagline: 'Seu período gratuito está acabando',
        body1: `${name}, seu acesso gratuito ao Kashim termina em <strong style="color:#1d1d1f;">7 dias</strong>. Depois disso, seu plano financeiro fica guardado, mas o acesso é bloqueado.`,
        body2: 'Assine agora pelo site e continue exatamente de onde parou — todos os seus dados permanecem intactos.',
        cta: 'Assinar e continuar',
      };
    case 1:
      return {
        subject: `⚠️ Último dia! Seu acesso gratuito ao Kashim termina amanhã`,
        emoji: '⚠️',
        title: 'Último dia de acesso',
        tagline: 'Seu período gratuito termina amanhã',
        body1: `${name}, amanhã seu acesso gratuito ao Kashim se encerra. Seus dados ficam salvos e seguros, mas você não conseguirá mais acessar o app.`,
        body2: 'Garanta a continuidade agora — a assinatura é feita pelo site em menos de 2 minutos.',
        cta: 'Assinar agora',
      };
    case 0:
      return {
        subject: `Seu acesso gratuito ao Kashim encerrou — seus dados estão te esperando`,
        emoji: '🔒',
        title: 'Seu acesso encerrou',
        tagline: 'Mas seus dados estão salvos',
        body1: `${name}, seu período gratuito no Kashim terminou hoje. Todo o seu plano financeiro — lançamentos, metas, histórico — está guardado e seguro.`,
        body2: 'Para voltar a acessar tudo, basta assinar pelo site. Você continua exatamente de onde parou.',
        cta: 'Reativar meu acesso',
      };
  }
}

// Layout oficial Kashim (mesmo padrão do convite de casal): fundo #f5f5f7,
// card branco arredondado, logo com $ no verde-lima, CTA em gradiente lime.
function buildTrialEmail(c: MilestoneCopy): string {
  const ctaUrl = 'https://app.kashim.com.br';
  return `<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Kashim</title>
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

              <!-- Ícone -->
              <div style="text-align:center;margin-bottom:24px;">
                <div style="display:inline-block;background:#f0fad0;border-radius:50%;width:60px;height:60px;line-height:60px;text-align:center;border:1px solid rgba(122,184,0,0.2);">
                  <span style="font-size:26px;">${c.emoji}</span>
                </div>
              </div>

              <!-- Título -->
              <h1 style="margin:0 0 8px;text-align:center;color:#1d1d1f;font-size:22px;font-weight:900;text-transform:uppercase;letter-spacing:-0.5px;">
                ${c.title}
              </h1>
              <p style="margin:0 0 28px;text-align:center;color:#7ab800;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:3px;">
                ${c.tagline}
              </p>

              <!-- Corpo -->
              <p style="margin:0 0 12px;color:#6e6e73;font-size:15px;line-height:1.7;">
                ${c.body1}
              </p>
              <p style="margin:0 0 28px;color:#6e6e73;font-size:15px;line-height:1.7;">
                ${c.body2}
              </p>

              <!-- Botão CTA -->
              <div style="text-align:center;margin-bottom:28px;">
                <a href="${ctaUrl}"
                   style="display:inline-block;background:linear-gradient(180deg,#c5f23a 0%,#a2d800 50%,#8cc400 100%);color:#182200;font-size:14px;font-weight:900;text-transform:uppercase;letter-spacing:2px;padding:18px 48px;border-radius:14px;text-decoration:none;box-shadow:0 4px 14px rgba(130,192,0,0.35);">
                  ${c.cta} →
                </a>
              </div>

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #f0f0f5;margin:0 0 20px;" />

              <!-- Link de texto -->
              <p style="margin:0;color:#aeaeb2;font-size:11px;text-align:center;line-height:1.8;">
                Acesse pelo navegador:<br />
                <a href="${ctaUrl}" style="color:#7ab800;word-break:break-all;font-size:11px;">${ctaUrl}</a>
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

// ─── Clerk: e-mail + nome do usuário ─────────────────────────────────────────

async function getClerkUser(clerkUserId: string): Promise<{ email: string | null; firstName: string }> {
  try {
    const r = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    });
    if (!r.ok) return { email: null, firstName: '' };
    const u = await r.json() as {
      first_name?: string;
      primary_email_address_id?: string;
      email_addresses?: Array<{ id: string; email_address: string }>;
    };
    const primary = u.email_addresses?.find(e => e.id === u.primary_email_address_id)
      ?? u.email_addresses?.[0];
    return { email: primary?.email_address ?? null, firstName: u.first_name ?? '' };
  } catch {
    return { email: null, firstName: '' };
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel Cron manda "Authorization: Bearer ${CRON_SECRET}" automaticamente
  // quando a env var CRON_SECRET existe. Sem match = 401 (evita disparo público).
  const auth = (req.headers.authorization as string | undefined) ?? '';
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const results: Array<{ householdId: string; milestone: number; to: string; status: string }> = [];

  try {
    // Households + memberships + coach_access num passe só (3 queries)
    // select('*') de propósito: o schema de households divergiu do código no
    // passado (subscription_expires_at faltando derrubava a query inteira).
    // Campos ausentes viram undefined e a régua continua funcionando.
    const [{ data: households, error: hhErr }, { data: members }, { data: coachRows }] = await Promise.all([
      db.from('households').select('*'),
      db.from('household_members').select('household_id, clerk_user_id, role'),
      db.from('coach_access').select('*'),
    ]);
    if (hhErr || !households) {
      return res.status(500).json({ error: `households: ${hhErr?.message ?? 'sem dados'}` });
    }

    const membersByHh = new Map<string, Array<{ clerk_user_id: string }>>();
    for (const m of members ?? []) {
      const arr = membersByHh.get(m.household_id) ?? [];
      arr.push(m);
      membersByHh.set(m.household_id, arr);
    }

    const now = Date.now();
    const coachInfoByHh = new Map<string, { isCoachClient: boolean; coachActive: boolean }>();
    for (const c of coachRows ?? []) {
      if (c.status !== 'approved') continue;
      const ends = c.expires_at ?? c.coaching_ends_at;
      const active = !ends || new Date(ends).getTime() > now;
      const prev = coachInfoByHh.get(c.household_id);
      coachInfoByHh.set(c.household_id, {
        isCoachClient: true,
        coachActive: (prev?.coachActive ?? false) || active,
      });
    }

    for (const hh of households) {
      if (!hh.created_at) continue;
      const coach = coachInfoByHh.get(hh.id);

      // Coach ativo = acesso garantido pela consultoria; sem régua por enquanto
      if (coach?.coachActive) continue;

      // Assinatura paga vigente = sem régua
      if (hh.subscription_status === 'active' && hh.subscription_expires_at &&
          new Date(hh.subscription_expires_at).getTime() > now) continue;

      const trialEnd = trialEndFor(hh.created_at, coach?.isCoachClient ?? false);
      const daysLeft = daysUntil(trialEnd);

      // Fora dos marcos = nada a fazer hoje. daysLeft < 0 = expirou há dias
      // (o marco 0 já foi ou nunca será — não spamamos conta antiga).
      const milestone = MILESTONES.find(m => m === daysLeft);
      if (milestone === undefined) continue;

      const hhMembers = membersByHh.get(hh.id) ?? [];
      for (const member of hhMembers) {
        if (ADMIN_IDS.includes(member.clerk_user_id)) continue;

        // Dedup: INSERT falha (23505) se este marco já foi enviado a este membro
        const { error: dedupErr } = await db.from('trial_emails').insert({
          household_id: hh.id,
          clerk_user_id: member.clerk_user_id,
          milestone,
        });
        if (dedupErr) {
          if (dedupErr.code !== '23505') {
            results.push({ householdId: hh.id, milestone, to: member.clerk_user_id, status: `dedup-error: ${dedupErr.message}` });
          }
          continue; // já enviado (ou erro de tabela — não envia sem dedup)
        }

        const { email, firstName } = await getClerkUser(member.clerk_user_id);
        if (!email) {
          results.push({ householdId: hh.id, milestone, to: member.clerk_user_id, status: 'sem e-mail no Clerk' });
          continue;
        }

        const c = copyFor(milestone, firstName);
        try {
          await resend.emails.send({
            from: 'Kashim <noreply@kashim.com.br>',
            to: email,
            subject: c.subject,
            html: buildTrialEmail(c),
          });
          results.push({ householdId: hh.id, milestone, to: email, status: 'enviado' });
        } catch (e) {
          // Marca de dedup fica — preferimos perder 1 e-mail a duplicar.
          const msg = e instanceof Error ? e.message : 'erro desconhecido';
          results.push({ householdId: hh.id, milestone, to: email, status: `resend-error: ${msg}` });
        }
      }
    }

    return res.status(200).json({ ok: true, sent: results.filter(r => r.status === 'enviado').length, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erro desconhecido';
    return res.status(500).json({ error: msg });
  }
}
