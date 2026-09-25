import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

/**
 * VIGIA DA SINCRONIZAÇÃO — o alarme que faltou.
 *
 * Em 23/09 o cron parou de rodar (um import local em `api/`, que a Vercel não
 * empacota) e ficou DOIS DIAS sem buscar nada. Ninguém percebeu: não houve
 * erro na tela, o app continuou abrindo, e o Eduardo só descobriu porque
 * estranhou uma compra do cartão que não chegava.
 *
 * Esta rota roda de hora em hora, olha a sincronização mais recente entre as
 * conexões VIVAS e avisa o dono — no celular e por e-mail — quando o silêncio
 * passa do limite. É deliberadamente separada do `of-cron`: um vigia que mora
 * dentro do que ele vigia não serve para nada.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';
const CRON_SECRET = process.env.CRON_SECRET ?? '';
const DONO_EMAIL = 'eduardo_cda@hotmail.com';
/** Casa do Eduardo — é para onde vai o push do alarme. */
const CASA_DO_DONO = process.env.ALERTA_HOUSEHOLD_ID ?? '40c52935-268e-44fa-9dc5-cc16be9046f5';
/** Silêncio tolerado. O cron roda a cada 5 min; 3h já é anormal. */
const LIMITE_HORAS = Number(process.env.ALERTA_HORAS ?? 3);

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

async function avisarNoCelular(titulo: string, corpo: string): Promise<boolean> {
  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) return false;

  const { data: devices } = await db
    .from('push_devices')
    .select('onesignal_id')
    .eq('household_id', CASA_DO_DONO);
  const ids = (devices ?? [])
    .map((d) => d.onesignal_id as string)
    .filter((x) => x && !x.startsWith('apns:'));
  if (ids.length === 0) return false;

  try {
    const r = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Key ${apiKey}` },
      body: JSON.stringify({
        app_id: appId,
        include_subscription_ids: ids,
        headings: { en: titulo, pt: titulo },
        contents: { en: corpo, pt: corpo },
        ios_sound: 'kashim.wav',
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = (req.headers.authorization ?? '').replace('Bearer ', '').trim();
  if (CRON_SECRET && auth !== CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  const { data: vivas, error } = await db
    .from('bank_connections')
    .select('id, bank_name, last_synced_at')
    .eq('consent_status', 'active');
  if (error) return res.status(500).json({ error: error.message });

  const conexoes = vivas ?? [];
  if (conexoes.length === 0) return res.status(200).json({ ok: true, motivo: 'nenhuma conexão ativa' });

  const maisRecente = conexoes
    .map((c) => (c.last_synced_at ? new Date(c.last_synced_at as string).getTime() : 0))
    .reduce((a, b) => Math.max(a, b), 0);
  const horas = maisRecente === 0 ? 999 : (Date.now() - maisRecente) / 3_600_000;

  /**
   * `?teste=1` dispara o alarme mesmo com tudo em ordem. Serve para provar que
   * o push e o e-mail realmente chegam — um alarme que nunca foi ouvido não é
   * alarme. Continua exigindo o CRON_SECRET.
   */
  const ensaio = req.query.teste === '1';

  if (horas < LIMITE_HORAS && !ensaio) {
    return res.status(200).json({ ok: true, horas_sem_sincronizar: Number(horas.toFixed(1)), alarme: false });
  }

  const quanto = horas >= 999 ? 'nunca sincronizou' : `há ${Math.floor(horas)}h sem sincronizar`;
  const titulo = ensaio ? 'Kashim · Teste do vigia' : 'Kashim · Sincronização parada';
  const corpo = ensaio
    ? `Teste. O alarme está funcionando. Última sincronização há ${horas.toFixed(1)}h.`
    : `Nenhum banco sincroniza ${quanto}. ${conexoes.length} conexões ativas.`;

  const push = await avisarNoCelular(titulo, corpo);
  try {
    await resend.emails.send({
      from: 'Kashim <noreply@kashim.com.br>',
      to: DONO_EMAIL,
      subject: ensaio ? '✅ Teste do vigia do Kashim' : `🚨 Sincronização parada — ${quanto}`,
      html: `<div style="font-family:system-ui;max-width:520px;padding:24px">
        <h1 style="font-size:20px;margin:0 0 12px">${ensaio ? 'Teste do vigia — está funcionando' : 'Os bancos pararam de sincronizar'}</h1>
        <p style="font-size:15px;line-height:1.6;color:#3a3a3c">
          ${ensaio
            ? `Isto é um teste. Se você recebeu este e-mail e o aviso no celular, o alarme está de pé. A sincronização mais recente entre as <strong>${conexoes.length} conexões ativas</strong> foi há ${horas.toFixed(1)}h — dentro do normal.`
            : `A sincronização mais recente entre as <strong>${conexoes.length} conexões ativas</strong> foi ${quanto}. O normal é a cada poucos minutos.`}
        </p>
        <p style="font-size:14px;line-height:1.6;color:#6e6e73">
          O que costuma causar: erro novo no <code>api/of-cron.ts</code> (import local em <code>api/</code> não
          é empacotado pela Vercel), credencial da Technospeed vencida, ou bloqueio de IP.
        </p>
      </div>`,
    });
  } catch { /* e-mail é acessório: o push já saiu */ }

  return res.status(200).json({
    ok: true,
    alarme: true,
    horas_sem_sincronizar: Number(horas.toFixed(1)),
    conexoes_ativas: conexoes.length,
    push_enviado: push,
  });
}
