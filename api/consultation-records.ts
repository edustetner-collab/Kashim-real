import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

// ─── Registros da consultoria (raio-X imutável) ──────────────────────────────
// POST { householdId, clientName, snapshot } → grava snapshot + hash SHA-256
//   com carimbo do servidor e envia e-mail-cópia ao cliente (prova em posse
//   de terceiro). NÃO existe update/delete — registro é imutável.
// GET  ?householdId= → lista os registros do cliente (para reabrir o PDF).
// Só staff: super-admin ou assistente (admin_users) — exceto perfis privados.

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

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

async function isStaffAllowed(sub: string, householdId: string): Promise<boolean> {
  if (ADMIN_IDS.includes(sub)) return true;
  try {
    const r = await fetch(`https://api.clerk.com/v1/users/${sub}`, {
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    });
    if (!r.ok) return false;
    const u = await r.json() as { email_addresses?: Array<{ email_address: string }> };
    const email = (u.email_addresses?.[0]?.email_address ?? '').toLowerCase();
    if (!email) return false;
    const { data: assistant } = await db.from('admin_users').select('id').eq('email', email).maybeSingle();
    if (!assistant) return false;
    const { data: hh } = await db.from('households').select('is_private').eq('id', householdId).maybeSingle();
    return !hh?.is_private;
  } catch {
    return false;
  }
}

async function getClientEmail(householdId: string): Promise<string | null> {
  const { data: hh } = await db.from('households')
    .select('prospect_email').eq('id', householdId).maybeSingle();
  if (hh?.prospect_email) return hh.prospect_email;
  const { data: member } = await db.from('household_members')
    .select('clerk_user_id').eq('household_id', householdId).limit(1).maybeSingle();
  if (!member) return null;
  try {
    const r = await fetch(`https://api.clerk.com/v1/users/${member.clerk_user_id}`, {
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    });
    if (!r.ok) return null;
    const u = await r.json() as { email_addresses?: Array<{ email_address: string }> };
    return u.email_addresses?.[0]?.email_address ?? null;
  } catch {
    return null;
  }
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

interface Snapshot {
  clientName: string;
  months: { monthName: string; year: number }[];
  items: { description: string; category: string; values: number[] }[];
  summaries: Array<{
    totalIncome: number; totalCreditCard: number; totalFixed: number;
    totalVariable: number; totalLeisure: number; totalCost: number;
    balance: number; accumulated: number;
  }>;
}

// E-mail-cópia do registro: layout Kashim + raio-X COMPLETO (todas as seções,
// item a item, 12 meses — igual ao PDF) + hash. A cópia na caixa do cliente,
// datada pelo provedor dele, é a prova externa do cenário registrado.
function buildRecordEmail(clientFirstName: string, dateLabel: string, snap: Snapshot, hash: string): string {
  const monthHead = snap.months.map(m =>
    `<th style="border:1px solid #e8e8ed;padding:4px 6px;background:#f5f5f7;font-size:9px;white-space:nowrap;">${m.monthName}<br/><span style="color:#aeaeb2;font-weight:400;">${m.year}</span></th>`
  ).join('');
  const row = (label: string, vals: Array<number | null>, bold = false, color = '#6e6e73') =>
    `<tr><td style="border:1px solid #e8e8ed;padding:4px 6px;font-size:9px;font-weight:${bold ? 800 : 600};color:${color};white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis;">${label}</td>${vals.map(v =>
      `<td style="border:1px solid #e8e8ed;padding:4px 6px;font-size:9px;text-align:right;font-family:monospace;white-space:nowrap;color:${(v ?? 0) < 0 ? '#dc2626' : '#1d1d1f'};font-weight:${bold ? 700 : 400};">${v == null ? '' : fmtBRL(v)}</td>`).join('')}</tr>`;

  const wrapTable = (headLabel: string, bodyRows: string) =>
    `<div style="overflow-x:auto;margin-bottom:4px;"><table style="border-collapse:collapse;width:100%;">
      <thead><tr><th style="border:1px solid #e8e8ed;padding:4px 6px;background:#f5f5f7;font-size:9px;text-align:left;">${headLabel}</th>${monthHead}</tr></thead>
      <tbody>${bodyRows}</tbody></table></div>`;

  // Seções item a item (mesma ordem e categorias do PDF — enum CategoryType)
  const SECTIONS: Array<{ category: string; title: string; color: string }> = [
    { category: 'Renda',                   title: 'Entradas (Rendas)',       color: '#15803d' },
    { category: 'Cartão de Crédito',       title: 'Faturas de Cartão',       color: '#ea580c' },
    { category: 'Contas Fixas',            title: 'Contas Fixas',            color: '#dc2626' },
    { category: 'Contas Variáveis',        title: 'Contas Variáveis',        color: '#0891b2' },
    { category: 'Lazer e Gastos Pessoais', title: 'Lazer e Gastos Pessoais', color: '#9333ea' },
  ];
  const sectionsHtml = SECTIONS.map(sec => {
    const catItems = snap.items.filter(i => i.category === sec.category);
    if (catItems.length === 0) return '';
    const itemRows = catItems.map(item =>
      row(item.description || '—', item.values.map(v => (v > 0 ? v : null)))
    ).join('');
    const totalRow = row('TOTAL', snap.months.map((_, idx) =>
      catItems.reduce((sum, i) => sum + (i.values[idx] || 0), 0)), true);
    return `<p style="margin:16px 0 6px;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:${sec.color};border-left:4px solid ${sec.color};padding-left:8px;">${sec.title}</p>
      ${wrapTable('Descrição', itemRows + totalRow)}`;
  }).join('');

  const s = snap.summaries;
  const table = wrapTable('Resumo', [
    row('Total de Entradas', s.map(x => x.totalIncome), false, '#15803d'),
    row('Faturas de Cartão', s.map(x => x.totalCreditCard)),
    row('Custos Fixos', s.map(x => x.totalFixed)),
    row('Custos Variáveis', s.map(x => x.totalVariable)),
    row('Gastos Pessoais e Lazer', s.map(x => x.totalLeisure)),
    row('Total de Custos', s.map(x => x.totalCost), true),
    row('Saldo Mensal', s.map(x => x.balance), true),
    row('Acumulado', s.map(x => x.accumulated), true, '#7ab800'),
  ].join(''));

  return `<!DOCTYPE html>
<html lang="pt-br">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Registro da consultoria</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:40px 12px;">
    <tr><td align="center">
      <table width="680" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;">
        <tr><td style="padding-bottom:28px;text-align:center;">
          <div style="display:inline-flex;align-items:center;gap:10px;">
            <div style="background:#a8e716;border-radius:12px;width:40px;height:40px;display:inline-block;line-height:40px;text-align:center;">
              <span style="font-size:20px;font-weight:900;color:#182200;">$</span>
            </div>
            <span style="font-size:20px;font-weight:900;color:#1d1d1f;letter-spacing:2px;text-transform:uppercase;font-style:italic;">KASHIM</span>
          </div>
        </td></tr>
        <tr><td style="background:#ffffff;border:1px solid #e8e8ed;border-radius:24px;padding:36px 32px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
          <h1 style="margin:0 0 8px;text-align:center;color:#1d1d1f;font-size:20px;font-weight:900;text-transform:uppercase;letter-spacing:-0.5px;">Registro da sua consultoria</h1>
          <p style="margin:0 0 24px;text-align:center;color:#7ab800;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:3px;">${dateLabel}</p>
          <p style="margin:0 0 12px;color:#6e6e73;font-size:14px;line-height:1.7;">
            Olá, <strong style="color:#1d1d1f;">${clientFirstName}</strong>! Este é o retrato do seu planejamento financeiro conforme registrado na consultoria de <strong style="color:#1d1d1f;">${dateLabel}</strong>. Guarde este e-mail — ele é o seu comprovante do cenário acordado nesta data.
          </p>
          <p style="margin:0 0 8px;color:#6e6e73;font-size:14px;line-height:1.7;">
            Abaixo, o seu raio-X completo: todas as contas, item a item, nos 12 meses do plano.
          </p>
          ${sectionsHtml}
          <p style="margin:20px 0 6px;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:#1d1d1f;border-left:4px solid #a8e716;padding-left:8px;">Compilação Financeira</p>
          ${table}
          <p style="margin:20px 0 0;color:#6e6e73;font-size:13px;line-height:1.7;">
            Se algo não refletir o que foi combinado na reunião, <strong style="color:#1d1d1f;">responda este e-mail</strong> apontando a diferença.
          </p>
          <hr style="border:none;border-top:1px solid #f0f0f5;margin:24px 0 16px;" />
          <p style="margin:0;color:#aeaeb2;font-size:10px;text-align:center;line-height:1.8;word-break:break-all;">
            Código de integridade do registro (SHA-256):<br/>${hash}
          </p>
        </td></tr>
        <tr><td style="padding-top:24px;text-align:center;">
          <p style="margin:0;color:#aeaeb2;font-size:11px;line-height:1.7;">Kashim — Finanças Pessoais com Coach</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (req.method === 'GET') {
      const householdId = String(req.query.householdId ?? '');
      if (!householdId) return res.status(400).json({ error: 'householdId obrigatório' });
      if (!(await isStaffAllowed(claims.sub, householdId))) return res.status(403).json({ error: 'Sem permissão' });
      const { data, error } = await db
        .from('consultation_records')
        .select('id, created_at, client_name, content_hash, email_sent_to, snapshot')
        .eq('household_id', householdId)
        .order('created_at', { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ records: data ?? [] });
    }

    if (req.method === 'POST') {
      const { householdId, clientName, snapshot } = (req.body ?? {}) as {
        householdId?: string; clientName?: string; snapshot?: Snapshot;
      };
      if (!householdId || !snapshot?.months?.length || !snapshot?.summaries?.length) {
        return res.status(400).json({ error: 'householdId e snapshot são obrigatórios' });
      }
      if (!(await isStaffAllowed(claims.sub, householdId))) return res.status(403).json({ error: 'Sem permissão' });

      const contentHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');

      const clientEmail = await getClientEmail(householdId);

      const { data: record, error } = await db.from('consultation_records').insert({
        household_id: householdId,
        created_by: claims.sub,
        client_name: clientName ?? snapshot.clientName ?? null,
        content_hash: contentHash,
        snapshot,
        email_sent_to: clientEmail,
      }).select('id, created_at').single();
      if (error || !record) return res.status(500).json({ error: error?.message ?? 'falha ao gravar' });

      // E-mail-cópia ao cliente: best-effort — o registro já está gravado.
      let emailStatus = 'sem e-mail do cliente';
      if (clientEmail) {
        const dateLabel = new Date(record.created_at).toLocaleDateString('pt-BR');
        const firstName = (clientName ?? snapshot.clientName ?? '').trim().split(' ')[0] || 'Cliente';
        try {
          await resend.emails.send({
            from: 'Kashim <noreply@kashim.com.br>',
            to: clientEmail,
            subject: `📋 Registro da sua consultoria — ${dateLabel}`,
            html: buildRecordEmail(firstName, dateLabel, snapshot, contentHash),
          });
          emailStatus = `enviado para ${clientEmail}`;
        } catch (e) {
          emailStatus = 'falha no envio: ' + (e instanceof Error ? e.message : 'erro');
        }
      }

      // ── Sincroniza com o sistema de agendamentos (best-effort) ─────────────
      let agendamentosStatus = 'nao_vinculado';
      const AGEND_URL = process.env.AGENDAMENTOS_SUPABASE_URL ?? '';
      const AGEND_KEY = process.env.AGENDAMENTOS_SERVICE_KEY ?? '';

      if (AGEND_URL && AGEND_KEY) {
        const { data: hhLink } = await db
          .from('households')
          .select('agendamentos_client_id')
          .eq('id', householdId)
          .maybeSingle();

        const agendClientId = hhLink?.agendamentos_client_id as string | null | undefined;
        if (agendClientId) {
          try {
            const agend = createClient(AGEND_URL, AGEND_KEY);
            const today = new Date();
            const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
            const dayOfMonth = today.getDate();

            const { data: agendClient } = await agend
              .from('clients')
              .select('status_by_month')
              .eq('id', agendClientId)
              .maybeSingle();

            if (!agendClient) {
              agendamentosStatus = 'cliente_nao_encontrado';
            } else {
              const statusByMonth = (agendClient.status_by_month as Record<string, { status: string; customDate?: number; notified?: boolean }>) || {};
              if (statusByMonth[monthKey]?.status === 'DONE') {
                agendamentosStatus = 'ja_marcado';
              } else {
                const updated = {
                  ...statusByMonth,
                  [monthKey]: { ...(statusByMonth[monthKey] ?? {}), status: 'DONE', customDate: dayOfMonth },
                };
                const { error: agendErr } = await agend
                  .from('clients')
                  .update({ status_by_month: updated })
                  .eq('id', agendClientId);
                agendamentosStatus = agendErr ? `erro: ${agendErr.message}` : 'atualizado';
              }
            }
          } catch (e) {
            agendamentosStatus = 'erro: ' + (e instanceof Error ? e.message : 'desconhecido');
          }
        }
      }
      // ────────────────────────────────────────────────────────────────────────

      return res.status(200).json({ ok: true, id: record.id, createdAt: record.created_at, hash: contentHash, emailStatus, agendamentosStatus });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erro desconhecido';
    return res.status(500).json({ error: msg });
  }
}
