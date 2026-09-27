import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';

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
    // Só token do CLERK. O mesmo segredo assina os tokens do GoTrue do
    // Supabase: sem esta linha, um cadastro direto no Supabase entraria como
    // usuário do app (revisão de segurança, 2026-09-24).
    if (!String(claims.sub).startsWith('user_')) return null;
    if (typeof claims.exp === 'number' && claims.exp < Math.floor(Date.now() / 1000)) return null;
    return { sub: claims.sub };
  } catch {
    return null;
  }
}

/**
 * "Parabéns, entrou gente nova" — o aviso de cadastro, no celular do Eduardo.
 *
 * Este é o único ponto do sistema por onde passa um cadastro espontâneo, e
 * passa UMA vez só: quem já é membro sai na linha de cima, e a corrida de duas
 * abas cai no ramo do `memberError`. Por isso o aviso mora aqui e não vira
 * duplicado.
 *
 * Regra de ouro: **nada disto pode atrapalhar o cadastro**. Tudo com prazo
 * curto e dentro de try/catch — se o push ou o e-mail falhar, a pessoa entra
 * no app do mesmo jeito e o Eduardo perde um aviso, que é o lado barato de
 * errar (Eduardo, 2026-09-25).
 */
const CASA_DO_DONO = process.env.ALERTA_HOUSEHOLD_ID ?? '40c52935-268e-44fa-9dc5-cc16be9046f5';
const DONO_EMAIL = 'eduardo_cda@hotmail.com';

/** Nome e e-mail de quem acabou de entrar, para o aviso dizer QUEM. */
async function quemEntrou(sub: string): Promise<{ nome: string; email: string | null }> {
  const key = process.env.CLERK_SECRET_KEY ?? '';
  if (!key) return { nome: 'Alguém', email: null };
  try {
    const r = await fetch(`https://api.clerk.com/v1/users/${sub}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return { nome: 'Alguém', email: null };
    const u = await r.json() as {
      first_name?: string | null; last_name?: string | null;
      primary_email_address_id?: string;
      email_addresses?: Array<{ id: string; email_address: string }>;
    };
    const principal = u.email_addresses?.find((e) => e.id === u.primary_email_address_id)
      ?? u.email_addresses?.[0];
    const nome = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
    return { nome: nome || principal?.email_address?.split('@')[0] || 'Alguém', email: principal?.email_address ?? null };
  } catch {
    return { nome: 'Alguém', email: null };
  }
}

async function avisarCadastroNovo(sub: string): Promise<void> {
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  try {
    const [{ nome, email }, { count }] = await Promise.all([
      quemEntrou(sub),
      db.from('household_members').select('clerk_user_id', { count: 'exact', head: true }),
    ]);
    const total = count ?? 0;
    const titulo = 'Kashim 🎉 Cadastro novo';
    // O número total é o que responde "está entrando gente todo dia?" sem
    // precisar abrir painel nenhum.
    const corpo = `${nome} acabou de criar a conta. Já são ${total} pessoas no Kashim.`;

    const appId = process.env.ONESIGNAL_APP_ID;
    const apiKey = process.env.ONESIGNAL_REST_API_KEY;
    if (appId && apiKey) {
      const { data: devices } = await db
        .from('push_devices')
        .select('onesignal_id')
        .eq('household_id', CASA_DO_DONO);
      const ids = (devices ?? [])
        .map((d) => d.onesignal_id as string)
        .filter((x) => x && !x.startsWith('apns:'));
      if (ids.length > 0) {
        await fetch('https://api.onesignal.com/notifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Key ${apiKey}` },
          body: JSON.stringify({
            app_id: appId,
            include_subscription_ids: ids,
            headings: { en: titulo, pt: titulo },
            contents: { en: corpo, pt: corpo },
            ios_sound: 'kashim.wav',
          }),
          signal: AbortSignal.timeout(3000),
        });
      }
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: 'Kashim <noreply@kashim.com.br>',
          to: DONO_EMAIL,
          subject: `🎉 Cadastro novo: ${nome}`,
          html: `<div style="font-family:system-ui;max-width:520px;padding:24px">
            <h1 style="font-size:20px;margin:0 0 12px">Entrou gente nova no Kashim</h1>
            <p style="font-size:15px;line-height:1.6;color:#3a3a3c">
              <strong>${nome}</strong>${email ? ` (${email})` : ''} acabou de criar a conta.
            </p>
            <p style="font-size:15px;line-height:1.6;color:#3a3a3c">
              Total de pessoas no Kashim: <strong>${total}</strong>.
            </p>
          </div>`,
        }),
        signal: AbortSignal.timeout(3000),
      });
    }
  } catch { /* aviso é acessório: cadastro nunca pode falhar por causa dele */ }
}

/**
 * Cria (ou retorna) o household do usuário logado usando a service key, que
 * ignora o RLS. Necessário porque o cliente não tem permissão de INSERT em
 * households — mover isto pro servidor destrava o cadastro de usuário novo.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });
  const clerkUserId = claims.sub;

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Já é membro de algum household? Retorna esse.
  const { data: membership } = await db
    .from('household_members')
    .select('household_id')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle();
  if (membership) return res.status(200).json({ householdId: membership.household_id });

  // Cria o household
  const { data: household, error: hhError } = await db
    .from('households')
    /**
     * `status: 'active'` explícito: cadastro espontâneo nasce ativo.
     *
     * Sem isto a coluna caía no padrão 'draft', o MESMO que o `create-client`
     * grava no cliente de coach — e o dado deixava de dizer quem era quem.
     * Quem lê isto espera que 'draft' signifique "criado pelo coach"; agora
     * significa (2026-09-27).
     */
    .insert({
      start_month: new Date().getMonth(),
      start_year: new Date().getFullYear(),
      status: 'active',
    })
    .select('id')
    .single();
  if (hhError || !household) {
    return res.status(500).json({ error: `households.insert: ${hhError?.message ?? 'sem dados'}` });
  }

  // Associa o usuário como owner
  const { error: memberError } = await db.from('household_members').insert({
    household_id: household.id,
    clerk_user_id: clerkUserId,
    role: 'owner',
  });
  if (memberError) {
    // Corrida: uma requisição simultânea (ex.: app aberto em 2 abas logo após o
    // signup) já criou a membership deste usuário. A UNIQUE constraint em
    // household_members.clerk_user_id barra o segundo insert (código 23505).
    // Recupera o household que venceu a corrida e descarta o órfão recém-criado.
    const { data: winner } = await db
      .from('household_members')
      .select('household_id')
      .eq('clerk_user_id', clerkUserId)
      .maybeSingle();
    if (winner) {
      await db.from('households').delete().eq('id', household.id);
      return res.status(200).json({ householdId: winner.household_id });
    }
    return res.status(500).json({ error: `household_members.insert: ${memberError.message}` });
  }

  // Cadastro concluído: só aqui, e só uma vez por pessoa.
  await avisarCadastroNovo(clerkUserId);

  return res.status(200).json({ householdId: household.id });
}
