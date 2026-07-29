import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

// Escapa para uso seguro dentro de atributos HTML (o target é gerado por nós,
// mas escapamos por princípio).
function htmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const OG_TITLE = 'Kashim — seu link para controlar suas finanças';
const OG_DESC = 'Toque para entrar no seu plano financeiro do Kashim.';
const OG_IMAGE = 'https://app.kashim.com.br/kashim-icon.png';

function page(opts: { redirectTo?: string; heading: string; sub: string }): string {
  const { redirectTo, heading, sub } = opts;
  // Redireciona por META REFRESH (não por JS) de propósito:
  //  - a CSP do site bloqueia script inline (script-src 'self');
  //  - crawlers de preview (WhatsApp/iMessage) leem as OG tags mas NÃO seguem o
  //    refresh, então o sign_in_token (uso único) não é consumido pela prévia —
  //    só pelo navegador de verdade quando a pessoa abre o link.
  const refresh = redirectTo ? `<meta http-equiv="refresh" content="0;url=${htmlAttr(redirectTo)}" />` : '';
  const link = redirectTo
    ? `<a href="${htmlAttr(redirectTo)}" style="color:#7ab800;font-weight:800;text-decoration:none;">Entrar no Kashim →</a>`
    : '';
  return `<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
${refresh}
<title>${OG_TITLE}</title>
<meta property="og:title" content="${OG_TITLE}" />
<meta property="og:description" content="${OG_DESC}" />
<meta property="og:image" content="${OG_IMAGE}" />
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${OG_TITLE}" />
<meta name="twitter:description" content="${OG_DESC}" />
</head>
<body style="margin:0;background:#0a0a0a;color:#fff;font-family:'Helvetica Neue',Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;">
  <div style="text-align:center;padding:24px;">
    <img src="${OG_IMAGE}" alt="Kashim" width="72" height="72" style="border-radius:18px;" />
    <h1 style="font-size:20px;font-weight:900;text-transform:uppercase;letter-spacing:1px;margin:20px 0 8px;">${heading}</h1>
    <p style="color:#a1a1aa;font-size:14px;margin:0 0 20px;">${sub}</p>
    ${link}
  </div>
</body>
</html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const code = (req.query.code as string | undefined)?.trim();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!code) {
    res.status(400).send(page({ heading: 'Link inválido', sub: 'Este link não é válido. Peça um novo ao seu consultor.' }));
    return;
  }

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data } = await db
      .from('short_links')
      .select('target_url, expires_at')
      .eq('code', code)
      .maybeSingle();

    const expired = data?.expires_at ? new Date(data.expires_at).getTime() < Date.now() : false;
    if (!data || expired) {
      res.status(410).send(page({ heading: 'Link expirado', sub: 'Este link de acesso expirou. Peça um novo ao seu consultor.' }));
      return;
    }

    res.status(200).send(page({
      redirectTo: data.target_url,
      heading: 'Abrindo o Kashim…',
      sub: 'Se não abrir automaticamente, toque no botão abaixo.',
    }));
  } catch (err) {
    console.error('short-redirect error:', err);
    res.status(500).send(page({ heading: 'Erro', sub: 'Não foi possível abrir o link. Tente de novo em instantes.' }));
  }
}
