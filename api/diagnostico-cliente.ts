import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

/**
 * Por que o cliente caiu no assistente de montagem?
 *
 * O app só força o assistente quando as TRÊS coisas valem ao mesmo tempo: não
 * há marca no navegador, `check-coach-access` respondeu que não há consultoria
 * aprovada, e o plano não tem nenhum valor preenchido. O coach, olhando o
 * painel, vê o cliente com prazo e plano montado — porque o painel olha OUTRO
 * household, o que ele criou.
 *
 * Esta rota mostra, por e-mail, todos os households ligados àquela pessoa, qual
 * deles o login dela resolve, quantas linhas cada um tem e o status do vínculo
 * de coach. `?varredura=1` faz o mesmo para todos os clientes de uma vez, que é
 * como se descobre quem mais está no mesmo buraco antes de o cliente reclamar.
 *
 * Só super-admin. GET é somente leitura.
 */

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? '';
const DONO_EMAILS = ['eduardo_cda@hotmail.com'];

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
    return claims;
  } catch {
    return null;
  }
}

async function podeDiagnosticar(sub: string): Promise<boolean> {
  if (ADMIN_IDS.includes(sub)) return true;
  if (!CLERK_SECRET_KEY) return false;
  try {
    const r = await fetch(`https://api.clerk.com/v1/users/${sub}`, {
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    });
    if (!r.ok) return false;
    const u = await r.json() as { email_addresses?: Array<{ email_address?: string }> };
    return (u.email_addresses ?? []).some(
      e => DONO_EMAILS.includes((e.email_address ?? '').toLowerCase().trim()),
    );
  } catch {
    return false;
  }
}

/**
 * E-mail de cada login, pelo id do Clerk.
 *
 * Casa vazia com login é sempre alguém — e esse alguém costuma ser um cliente
 * que já tem plano montado sob OUTRO e-mail. Sem resolver o e-mail, a varredura
 * devolve uma lista de UUIDs que não acusa ninguém.
 */
async function emailsPorId(ids: string[]): Promise<Record<string, string>> {
  const fora: Record<string, string> = {};
  if (!CLERK_SECRET_KEY || ids.length === 0) return fora;
  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50);
    const qs = lote.map(id => `user_id=${encodeURIComponent(id)}`).join('&');
    try {
      const r = await fetch(`https://api.clerk.com/v1/users?limit=50&${qs}`, {
        headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
      });
      if (!r.ok) continue;
      const lista = await r.json() as Array<{ id: string; email_addresses?: Array<{ email_address?: string }>; first_name?: string; last_name?: string }>;
      for (const u of lista ?? []) {
        const email = u.email_addresses?.[0]?.email_address ?? '';
        const nome = [u.first_name, u.last_name].filter(Boolean).join(' ');
        fora[u.id] = nome ? `${email} (${nome})` : email;
      }
    } catch { /* um lote que falha não invalida a varredura */ }
  }
  return fora;
}

/** Todos os usuários do Clerk com este e-mail (pode haver mais de um cadastro). */
async function usuariosPorEmail(email: string): Promise<Array<{ id: string; criadoEm: string | null }>> {
  if (!CLERK_SECRET_KEY) return [];
  try {
    const r = await fetch(
      `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}&limit=10`,
      { headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` } },
    );
    if (!r.ok) return [];
    const lista = await r.json() as Array<{ id: string; created_at?: number }>;
    return (lista ?? []).map(u => ({
      id: u.id,
      criadoEm: u.created_at ? new Date(u.created_at).toISOString() : null,
    }));
  } catch {
    return [];
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const claims = verifyAuthToken(req.headers.authorization as string | undefined);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });
  if (!(await podeDiagnosticar(claims.sub))) return res.status(403).json({ error: 'Forbidden' });

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  /** Uma casa com o que importa para julgar se ela é "a casa certa". */
  async function retratoDaCasa(id: string) {
    const [{ data: casa }, { data: membros }, { data: itens }, { data: coach }, { data: aparelhos }] = await Promise.all([
      db.from('households').select('id, prospect_name, prospect_email, status, created_at, first_access_at, access_until, subscription_status, start_month, start_year').eq('id', id).maybeSingle(),
      // Só colunas garantidas: pedir uma coluna inexistente derruba a query
      // inteira e devolve `data: null`, o que fazia a casa parecer sem membros.
      db.from('household_members').select('clerk_user_id, role').eq('household_id', id),
      db.from('finance_items').select('id, description, values').eq('household_id', id),
      db.from('coach_access').select('status, created_at').eq('household_id', id),
      // Sem aparelho registrado aqui, `pushParaCasa` sai em silêncio: o cron
      // avisa "pushed: 0" e ninguém recebe nada.
      db.from('push_devices').select('onesignal_id, platform, created_at').eq('household_id', id),
    ]);
    const linhas = itens ?? [];
    const comValor = linhas.filter(i => (i.values as number[] | null ?? []).some(v => (v ?? 0) > 0));
    return {
      household_id: id,
      nome: casa?.prospect_name ?? null,
      email_do_cadastro: casa?.prospect_email ?? null,
      status_da_casa: casa?.status ?? null,
      criada_em: casa?.created_at ?? null,
      primeiro_acesso: casa?.first_access_at ?? null,
      membros: (membros ?? []).map(m => ({ clerk_user_id: m.clerk_user_id, papel: m.role })),
      membros_lidos: membros !== null,
      linhas_no_plano: linhas.length,
      linhas_com_valor: comValor.length,
      coach_access: (coach ?? []).map(c => ({ status: c.status, desde: c.created_at })),
      push: {
        aparelhos_registrados: (aparelhos ?? []).length,
        // `apns:...` é registro de reserva: existe, mas não dispara push.
        aparelhos_que_recebem: (aparelhos ?? []).filter(a => {
          const oid = String(a.onesignal_id ?? '');
          return oid && !oid.startsWith('apns:');
        }).length,
        detalhes: (aparelhos ?? []).map(a => ({
          plataforma: a.platform,
          registrado_em: a.created_at,
          serve_para_enviar: !!a.onesignal_id && !String(a.onesignal_id).startsWith('apns:'),
        })),
      },
      tem_consultoria_aprovada: (coach ?? []).some(c => c.status === 'approved'),
    };
  }

  /**
   * O diagnóstico em si: o assistente aparece quando NÃO há consultoria
   * aprovada E o plano está sem valores. Basta uma das duas ser falsa para o
   * cliente entrar direto no plano.
   */
  function julgar(casaDoLogin: Awaited<ReturnType<typeof retratoDaCasa>> | null, outras: Array<Awaited<ReturnType<typeof retratoDaCasa>>>) {
    if (!casaDoLogin) return { assistente_vai_aparecer: null, motivo: 'Este e-mail ainda não tem login com household.' };
    const vaiAparecer = !casaDoLogin.tem_consultoria_aprovada && casaDoLogin.linhas_com_valor === 0;
    const casaDoCoach = outras.find(c => c.linhas_com_valor > 0 || c.tem_consultoria_aprovada) ?? null;
    return {
      assistente_vai_aparecer: vaiAparecer,
      motivo: vaiAparecer
        ? (casaDoCoach
          ? 'O login caiu numa casa VAZIA, e o plano montado está em OUTRA casa. Vínculo quebrado.'
          : 'Sem consultoria aprovada e sem nenhum valor no plano.')
        : 'Nada a corrigir: ou existe consultoria aprovada, ou o plano já tem valores.',
      casa_com_o_plano: casaDoCoach?.household_id ?? null,
    };
  }

  /**
   * CORREÇÃO: liga o login do cliente ao household onde está o plano.
   *
   * O caso clássico é a pessoa se cadastrar sozinha (ou com outro e-mail) e cair
   * numa casa nova e vazia, enquanto o plano que o coach montou está na casa
   * criada pelo painel. Em vez de remontar o plano, muda-se o vínculo.
   *
   * Recusa se a casa de origem tiver valor lançado (seria perda de dado) e se a
   * casa de destino já estiver com duas pessoas. A casa vazia que sobra é
   * apagada, para não voltar a confundir a próxima varredura.
   */
  if (req.method === 'POST') {
    const corpo = req.body as { acao?: string; householdId?: string; email?: string; som?: string; aplicar?: boolean };

    /**
     * Push de teste, disparado como o cron dispara.
     *
     * Serve para separar "o aparelho não recebe" de "o cron não mandou": aqui a
     * resposta crua do OneSignal volta na tela, com quantos destinatários ele
     * encontrou e quais erros devolveu.
     */
    /**
     * Apaga os valores FANTASMA das contas variáveis.
     *
     * Conta variável não tem previsão: o valor de cada mês é a soma dos
     * lançamentos daquele mês. O bug da janela de meses gravou valores em meses
     * sem lançamento nenhum (Eduardo, 2026-09-23). Sem `aplicar: true` apenas
     * mostra o que mudaria — escrita em dado de cliente nunca acontece sozinha.
     */
    if (corpo.acao === 'recalcular_variaveis') {
      const alvo = corpo.householdId;
      if (!alvo) return res.status(400).json({ error: 'householdId obrigatório' });
      const { data: casa } = await db.from('households').select('start_month, start_year').eq('id', alvo).maybeSingle();
      const mes0 = casa?.start_month ?? new Date().getMonth();
      const ano0 = casa?.start_year ?? new Date().getFullYear();
      const janela = Array.from({ length: 12 }, (_, i) => {
        const d = new Date(ano0, mes0 + i, 1);
        return { ano: d.getFullYear(), mes: d.getMonth() };
      });
      const { data: linhas } = await db
        .from('finance_items')
        .select('id, description, category, values, partial_expenses(year, month, value)')
        .eq('household_id', alvo)
        .eq('category', 'Contas Variáveis');

      const mudancas: Array<{ id: string; linha: string; de: number[]; para: number[] }> = [];
      for (const l of linhas ?? []) {
        const atuais = (l.values as number[] | null) ?? new Array(12).fill(0);
        const lancamentos = (l.partial_expenses ?? []) as Array<{ year: number; month: number; value: number }>;
        const novos = janela.map(({ ano, mes }) => {
          const soma = lancamentos
            .filter(p => p.year === ano && p.month === mes)
            .reduce((t, p) => t + Number(p.value ?? 0), 0);
          return Math.round(soma * 100) / 100;
        });
        const mudou = novos.some((v, i) => Math.abs(v - (atuais[i] ?? 0)) > 0.009);
        if (mudou) mudancas.push({ id: l.id as string, linha: String(l.description ?? ''), de: atuais, para: novos });
      }

      if (corpo.aplicar === true) {
        for (const m of mudancas) {
          await db.from('finance_items').update({ values: m.para, updated_at: new Date().toISOString() }).eq('id', m.id);
        }
      }
      return res.status(200).json({
        aplicado: corpo.aplicar === true,
        linhas_afetadas: mudancas.length,
        mudancas,
      });
    }

    if (corpo.acao === 'push_teste') {
      /**
       * `som` compara o som da marca com o do sistema no MESMO aparelho.
       * Som só o celular prova: se 'default' toca e 'kashim' não, o arquivo não
       * está no pacote do app publicado (Renata, 2026-09-22).
       */
      const som = String(corpo.som ?? 'kashim');
      const householdId = corpo.householdId ?? (corpo.email
        ? await (async () => {
            const us = await usuariosPorEmail(String(corpo.email).toLowerCase().trim());
            if (us.length === 0) return undefined;
            const { data } = await db.from('household_members')
              .select('household_id').in('clerk_user_id', us.map(u => u.id)).limit(1).maybeSingle();
            return data?.household_id as string | undefined;
          })()
        : undefined);
      if (!householdId) return res.status(400).json({ error: 'householdId (ou email) obrigatório' });
      const appId = process.env.ONESIGNAL_APP_ID;
      const apiKey = process.env.ONESIGNAL_REST_API_KEY;
      if (!appId || !apiKey) return res.status(500).json({ error: 'OneSignal não configurado nas variáveis de ambiente' });

      const { data: devices } = await db
        .from('push_devices')
        .select('onesignal_id, platform')
        .eq('household_id', householdId);
      const ids = (devices ?? [])
        .map(d => String(d.onesignal_id ?? ''))
        .filter(x => x && !x.startsWith('apns:'));
      if (ids.length === 0) return res.status(200).json({ enviado: false, motivo: 'Nenhum aparelho válido nesta casa', aparelhos: devices ?? [] });

      const r = await fetch('https://api.onesignal.com/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Key ${apiKey}` },
        body: JSON.stringify({
          app_id: appId,
          include_subscription_ids: ids,
          headings: { en: `Kashim 💚 Teste (som: ${som})`, pt: `Kashim 💚 Teste (som: ${som})` },
          contents: { en: 'Se você recebeu isto, os avisos do seu banco vão chegar.', pt: 'Se você recebeu isto, os avisos do seu banco vão chegar.' },
          url: 'https://app.kashim.com.br/?abrir=extrato',
          ...(som === 'nenhum' ? {} : { ios_sound: som === 'default' ? 'default' : 'kashim.wav' }),
          ...(som === 'kashim' ? { android_sound: 'kashim' } : {}),
        }),
      });
      const resposta = await r.json().catch(() => ({}));
      return res.status(200).json({
        enviado: r.ok,
        status_http: r.status,
        inscricoes_usadas: ids.length,
        resposta_onesignal: resposta,
      });
    }

    /**
     * Apagar UMA linha do plano, pelo id.
     *
     * Serve para a linha de cartão duplicada: as duas têm o mesmo nome na tela,
     * e mandar o coach adivinhar qual apagar é como pedir para ele jogar a
     * moeda. Aqui o id vem do diagnóstico `?cartoes=1`, com data de criação e
     * soma ao lado (Eduardo, 2026-09-20).
     */
    if (corpo.acao === 'apagar_linha') {
      const { linhaId } = req.body as { linhaId?: string };
      if (!linhaId) return res.status(400).json({ error: 'linhaId obrigatório' });
      const { data: linha } = await db
        .from('finance_items')
        .select('id, household_id, description, category, values')
        .eq('id', linhaId)
        .maybeSingle();
      if (!linha) return res.status(404).json({ error: 'Linha não encontrada' });
      const { error } = await db.from('finance_items').delete().eq('id', linhaId);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({
        ok: true,
        apagada: {
          id: linha.id,
          nome: linha.description,
          categoria: linha.category,
          household_id: linha.household_id,
          soma: Math.round(((linha.values as number[] | null) ?? []).reduce((a, v) => a + (v ?? 0), 0) * 100) / 100,
        },
      });
    }

    const { clerkUserId, householdDestino, forcar } = req.body as {
      clerkUserId?: string; householdDestino?: string; forcar?: boolean;
    };
    if (!clerkUserId || !householdDestino) {
      return res.status(400).json({ error: 'clerkUserId e householdDestino são obrigatórios' });
    }

    const { data: vinculo } = await db
      .from('household_members')
      .select('id, household_id, role')
      .eq('clerk_user_id', clerkUserId)
      .maybeSingle();

    const { count: noDestino } = await db
      .from('household_members')
      .select('*', { count: 'exact', head: true })
      .eq('household_id', householdDestino);
    if ((noDestino ?? 0) >= 2) return res.status(409).json({ error: 'A casa de destino já tem duas pessoas.' });

    const casaAntiga = vinculo?.household_id as string | undefined;
    let apagouCasaAntiga = false;

    if (casaAntiga && casaAntiga !== householdDestino) {
      const { data: itensAntigos } = await db
        .from('finance_items')
        .select('values')
        .eq('household_id', casaAntiga);
      const temValor = (itensAntigos ?? []).some(i => (i.values as number[] | null ?? []).some(v => (v ?? 0) > 0));
      if (temValor && !forcar) {
        return res.status(409).json({
          error: 'A casa atual deste login TEM valores lançados. Mover o vínculo abandonaria esses dados.',
          proximo_passo: 'Confira os dois planos. Se mesmo assim quiser mover, repita com forcar: true.',
          household_atual: casaAntiga,
          linhas_com_valor: (itensAntigos ?? []).filter(i => (i.values as number[] | null ?? []).some(v => (v ?? 0) > 0)).length,
        });
      }
    }

    if (vinculo) {
      const { error } = await db
        .from('household_members')
        .update({ household_id: householdDestino })
        .eq('id', vinculo.id);
      if (error) return res.status(500).json({ error: error.message, onde: 'mover vínculo' });
    } else {
      const { error } = await db
        .from('household_members')
        .insert({ household_id: householdDestino, clerk_user_id: clerkUserId, role: 'member' });
      if (error) return res.status(500).json({ error: error.message, onde: 'criar vínculo' });
    }

    if (casaAntiga && casaAntiga !== householdDestino) {
      const { count: sobraram } = await db
        .from('household_members')
        .select('*', { count: 'exact', head: true })
        .eq('household_id', casaAntiga);
      if ((sobraram ?? 0) === 0) {
        const { error } = await db.from('households').delete().eq('id', casaAntiga);
        apagouCasaAntiga = !error;
      }
    }

    return res.status(200).json({
      ok: true,
      clerkUserId,
      household_novo: householdDestino,
      household_antigo: casaAntiga ?? null,
      casa_antiga_apagada: apagouCasaAntiga,
      proximo_passo: 'Peça ao cliente para SAIR e ENTRAR de novo no app. O plano certo aparece no lugar do assistente.',
    });
  }

  /**
   * A FILA, LINHA POR LINHA — sem suposicao.
   *
   * O push falou em 2, o botao mostrou 2 e o Extrato mostrou nenhuma. Tres
   * numeros para a mesma coisa (Eduardo, 2026-09-21). Aqui sai cada transacao
   * ainda pendente com TUDO que decide se ela aparece: conexao, tipo, cartao,
   * flags de importacao, data, e o que cada filtro conclui. E tambem o que
   * chegou nas ultimas 24h, que e a origem do push.
   */
  if (req.query.fila === '1') {
    const alvo = (req.query.householdId as string | undefined)
      ?? (await (async () => {
        // Por nome do cliente: nem sempre se tem o e-mail à mão no meio do atendimento.
        const nome = String(req.query.nome ?? '').trim();
        if (nome) {
          const { data } = await db
            .from('households')
            .select('id')
            .ilike('prospect_name', `%${nome}%`)
            .limit(1)
            .maybeSingle();
          if (data?.id) return data.id as string;
        }
        const e = String(req.query.email ?? '').toLowerCase().trim();
        if (!e) return undefined;
        const us = await usuariosPorEmail(e);
        const ids = us.map(u => u.id);
        if (ids.length === 0) return undefined;
        const { data } = await db.from('household_members').select('household_id').in('clerk_user_id', ids).maybeSingle();
        return data?.household_id as string | undefined;
      })());
    if (!alvo) return res.status(400).json({ error: 'Passe ?householdId=... ou ?email=...' });

    const { data: casa } = await db
      .from('households').select('start_month, start_year').eq('id', alvo).maybeSingle();
    const mesInicio = casa?.start_month ?? new Date().getMonth();
    const anoInicio = casa?.start_year ?? new Date().getFullYear();
    const inicioDoPlano = `${anoInicio}-${String(mesInicio + 1).padStart(2, '0')}-01`;

    const { data: conexoes } = await db
      .from('bank_connections')
      .select('id, bank_name, consent_status, account_import_enabled, card_import_enabled, cards, categorize_from, last_synced_at')
      .eq('household_id', alvo);

    const info = new Map<string, { banco: string; viva: boolean; conta: boolean; cartao: boolean; cartoes: string[]; desligados: string[] }>();
    for (const c of conexoes ?? []) {
      const lista = Array.isArray(c.cards) ? c.cards as Array<{ last4?: string; enabled?: boolean }> : [];
      info.set(c.id as string, {
        banco: (c.bank_name as string) ?? '?',
        viva: c.consent_status !== 'revoked',
        conta: c.account_import_enabled !== false,
        cartao: c.card_import_enabled !== false,
        cartoes: lista.filter(k => k?.enabled && k?.last4).map(k => String(k.last4)),
        desligados: lista.filter(k => k?.enabled === false && k?.last4).map(k => String(k.last4)),
      });
    }

    const { data: pendentes } = await db
      .from('bank_transactions')
      .select('id, connection_id, account_type, card_last4, transaction_date, created_at, description, amount, suggestion_confidence, suggested_item_id, status')
      .eq('household_id', alvo)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(500);

    const julgar = (t: { connection_id?: string | null; account_type?: string | null; card_last4?: string | null; transaction_date?: string | null }) => {
      const i = info.get(t.connection_id ?? '');
      const motivos: string[] = [];
      if (!i) motivos.push('conexão não encontrada');
      else {
        if (!i.viva) motivos.push('conexão revogada');
        if (t.account_type === 'credit_card') {
          if (!i.cartao) motivos.push('importação de cartão desligada na conexão');
          else if (t.card_last4 && i.desligados.includes(String(t.card_last4))) {
            motivos.push(`cartão ${t.card_last4} desligado pelo cliente`);
          }
        } else if (!i.conta) motivos.push('importação de conta corrente desligada');
      }
      if ((t.transaction_date ?? '') < inicioDoPlano) motivos.push(`anterior ao início do plano (${inicioDoPlano})`);
      return motivos;
    };

    const linhas = (pendentes ?? []).map(t => {
      const motivos = julgar(t);
      return {
        id: t.id,
        quando_comprou: t.transaction_date,
        quando_chegou: String(t.created_at ?? '').slice(0, 16).replace('T', ' '),
        descricao: String(t.description ?? '').slice(0, 40),
        valor: t.amount,
        banco: info.get(t.connection_id ?? '')?.banco ?? '?',
        tipo: t.account_type === 'credit_card' ? `cartão ${t.card_last4 ?? '?'}` : 'conta',
        reconhecido: t.suggestion_confidence === 'memory' ? 'sim (lança sozinho ao abrir o Extrato)' : 'não (precisa de você)',
        aparece_para_o_cliente: motivos.length === 0,
        por_que_nao_aparece: motivos,
      };
    });

    /**
     * O que CHEGOU nas ultimas 48h, em qualquer estado.
     *
     * "O push falou em 2 e o Extrato nao tinha nenhuma" so se responde olhando
     * as transacoes que entraram naquele momento e onde elas estao agora:
     * pendente, categorizada (por quem e quando) ou ignorada
     * (Eduardo, 2026-09-21).
     */
    const desde48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: recentes } = await db
      .from('bank_transactions')
      .select('id, connection_id, account_type, card_last4, transaction_date, created_at, description, merchant, of_code, of_category, counterparty_doc, installment_current, installment_total, amount, status, suggestion_confidence, kashim_item_id, kashim_category, categorized_at')
      .eq('household_id', alvo)
      .gte('created_at', desde48h)
      .order('created_at', { ascending: false })
      .limit(200);

    const chegadas = (recentes ?? []).map(t => ({
      // Descrição INTEIRA: "CVS" cortado não diz nada; o texto cru do banco
      // costuma trazer cidade e sigla que identificam o lugar.
      descricao: t.description ?? null,
      estabelecimento: t.merchant ?? null,
      codigo_do_banco: t.of_code ?? null,
      categoria_do_banco: t.of_category ?? null,
      documento_da_outra_parte: t.counterparty_doc ?? null,
      parcela: t.installment_total ? `${t.installment_current}/${t.installment_total}` : null,
      comprou_em: t.transaction_date,
      valor: t.amount,
      banco: info.get(t.connection_id ?? '')?.banco ?? '?',
      tipo: t.account_type === 'credit_card' ? `cartão ${t.card_last4 ?? '?'}` : 'conta',
      chegou: String(t.created_at ?? '').slice(0, 16).replace('T', ' '),
      estado: t.status,
      foi_reconhecida: t.suggestion_confidence === 'memory',
      categorizada_em: t.categorized_at ? String(t.categorized_at).slice(0, 16).replace('T', ' ') : null,
      categoria_final: t.kashim_category ?? null,
      aparece_para_o_cliente: julgar(t).length === 0,
      por_que_nao_aparece: julgar(t),
    }));

    /**
     * UM CARTAO, TODAS AS TRANSACOES, QUALQUER ESTADO.
     *
     * "A fatura do 5198 veio, mas nunca apareceu nada para categorizar"
     * (Michael, via Eduardo, 2026-09-21). Pendente nao basta: pode ser que as
     * compras existam e estejam escondidas, categorizadas, ou anteriores ao
     * inicio do plano — cada caso tem conserto diferente.
     */
    const cartaoPedido = String(req.query.cartao ?? '').trim();
    let doCartao: unknown[] | null = null;
    if (cartaoPedido) {
      const { data: tx } = await db
        .from('bank_transactions')
        .select('transaction_date, created_at, description, amount, status, card_last4, connection_id, account_type, bill_due_date, suggestion_confidence, kashim_category')
        .eq('household_id', alvo)
        .eq('card_last4', cartaoPedido)
        .order('transaction_date', { ascending: false })
        .limit(300);
      doCartao = (tx ?? []).map(t => ({
        comprou_em: t.transaction_date,
        chegou: String(t.created_at ?? '').slice(0, 16).replace('T', ' '),
        descricao: t.description,
        valor: t.amount,
        estado: t.status,
        vencimento_da_fatura: t.bill_due_date,
        aparece_para_o_cliente: julgar(t).length === 0,
        por_que_nao_aparece: julgar(t),
      }));
    }

    const ultimas24h = (pendentes ?? []).filter(t => {
      const c = t.created_at ? new Date(t.created_at as string).getTime() : 0;
      return Date.now() - c < 24 * 60 * 60 * 1000;
    }).length;

    return res.status(200).json({
      household_id: alvo,
      inicio_do_plano: inicioDoPlano,
      conexoes: [...info.entries()].map(([id, i]) => ({ id, ...i })),
      chegadas_48h: chegadas,
      cartao_consultado: cartaoPedido || null,
      transacoes_do_cartao: doCartao,
      resumo_do_cartao: doCartao ? {
        total: doCartao.length,
        por_estado: doCartao.reduce((acc: Record<string, number>, t) => {
          const e = String((t as { estado?: string }).estado ?? '?');
          acc[e] = (acc[e] ?? 0) + 1;
          return acc;
        }, {}),
        escondidas: (doCartao as Array<{ aparece_para_o_cliente: boolean }>).filter(t => !t.aparece_para_o_cliente).length,
      } : null,
      resumo: {
        chegaram_em_48h: chegadas.length,
        pendentes_no_banco: linhas.length,
        aparecem_na_tela: linhas.filter(l => l.aparece_para_o_cliente).length,
        escondidas: linhas.filter(l => !l.aparece_para_o_cliente).length,
        chegaram_nas_ultimas_24h: ultimas24h,
        precisam_do_cliente: linhas.filter(l => l.aparece_para_o_cliente && l.reconhecido.startsWith('não')).length,
        lancam_sozinhas: linhas.filter(l => l.aparece_para_o_cliente && l.reconhecido.startsWith('sim')).length,
      },
      linhas,
    });
  }

  /**
   * QUANTO TEMPO O GASTO DEMORA PARA APARECER.
   *
   * "Comprei sexta as 20h e so vi domingo a noite" — a pergunta e legitima e a
   * resposta ate agora era teoria (Eduardo, 2026-09-20). Aqui e medicao: para
   * cada transacao, a distancia entre a DATA DA COMPRA e o instante em que ela
   * entrou no nosso banco, separada por banco e por tipo.
   *
   * Precisao: `transaction_date` e data, sem hora — entao o numero e em dias e
   * tem margem de ate 24h. Serve para comparar bancos e tipos, que e o que
   * interessa, nao para cravar minutos.
   */
  if (req.query.atraso === '1') {
    const desde = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    /**
     * `?chegadasDesde=7` mede so o que ENTROU nos ultimos 7 dias.
     *
     * A primeira importacao de uma conexao traz meses de historico de uma vez:
     * dezenas de compras antigas com o mesmo `created_at`. Misturadas, elas
     * inflam a media e fazem parecer que o banco demora dez dias
     * (Eduardo, 2026-09-20). Olhando so as chegadas recentes, sobra o ritmo
     * real de quem ja esta conectado.
     */
    const diasChegada = Number(req.query.chegadasDesde ?? 0);
    const corteChegada = diasChegada > 0
      ? new Date(Date.now() - diasChegada * 24 * 60 * 60 * 1000).toISOString()
      : null;

    let consulta = db
      .from('bank_transactions')
      .select('connection_id, account_type, transaction_date, created_at, description, amount')
      .gte('transaction_date', desde)
      .limit(20000);
    if (corteChegada) consulta = consulta.gte('created_at', corteChegada);
    const { data: txs } = await consulta;

    const { data: conns } = await db
      .from('bank_connections')
      .select('id, bank_name');
    const bancoDe = new Map((conns ?? []).map(c => [c.id as string, (c.bank_name as string) ?? '?']));

    interface Grupo { horas: number[]; exemplos: string[] }
    const grupos = new Map<string, Grupo>();

    for (const t of txs ?? []) {
      const compra = t.transaction_date ? new Date(`${String(t.transaction_date).slice(0, 10)}T12:00:00Z`) : null;
      const chegou = t.created_at ? new Date(t.created_at as string) : null;
      if (!compra || !chegou) continue;
      const horas = (chegou.getTime() - compra.getTime()) / 36e5;
      // Importacao inicial traz meses de historico de uma vez: nao e atraso.
      if (horas < -12 || horas > 24 * 20) continue;
      const chave = `${bancoDe.get(t.connection_id as string) ?? '?'} · ${t.account_type === 'credit_card' ? 'cartão' : 'conta'}`;
      const g = grupos.get(chave) ?? { horas: [], exemplos: [] };
      g.horas.push(horas);
      if (g.exemplos.length < 3) {
        g.exemplos.push(`${String(t.transaction_date).slice(0, 10)} → ${String(t.created_at).slice(0, 16).replace('T', ' ')} · ${String(t.description ?? '').slice(0, 28)}`);
      }
      grupos.set(chave, g);
    }

    const mediana = (v: number[]) => {
      const o = [...v].sort((a, b) => a - b);
      return o.length === 0 ? 0 : Math.round(o[Math.floor(o.length / 2)] * 10) / 10;
    };

    const resultado = [...grupos.entries()]
      .map(([chave, g]) => ({
        fonte: chave,
        transacoes: g.horas.length,
        // Mediana e o numero honesto aqui: uma importacao atipica nao desloca.
        atraso_tipico_horas: mediana(g.horas),
        pior_caso_horas: Math.round(Math.max(...g.horas) * 10) / 10,
        melhor_caso_horas: Math.round(Math.min(...g.horas) * 10) / 10,
        exemplos: g.exemplos,
      }))
      .sort((a, b) => b.transacoes - a.transacoes);

    return res.status(200).json({
      janela: `compras desde ${desde}${corteChegada ? `, que ENTRARAM nos últimos ${diasChegada} dias` : ''}`,
      observacao: 'A data da compra não traz hora; cada número tem margem de até 24h. Compare fontes entre si.',
      fontes: resultado,
    });
  }

  /**
   * LINHAS DE CARTAO DUPLICADAS.
   *
   * A linha da fatura nasce do efeito que le `bill_totals`. Quando o casamento
   * com a linha existente falha, ele cria outra — e a fatura aparece dobrada no
   * plano (Eduardo, 2026-09-20, Itau duplicado "do nada"). Aqui e so leitura:
   * mostra o que existe, com valores, para decidir qual apagar.
   */
  if (req.query.cartoes === '1') {
    const { data: linhas } = await db
      .from('finance_items')
      .select('id, household_id, description, values, created_at')
      .eq('category', 'Cartão de Crédito');

    const porCasa = new Map<string, Array<{ id: string; description: string; values: number[]; created_at: string }>>();
    for (const l of linhas ?? []) {
      const hid = l.household_id as string;
      porCasa.set(hid, [...(porCasa.get(hid) ?? []), {
        id: l.id as string,
        description: String(l.description ?? ''),
        values: (l.values as number[] | null) ?? [],
        created_at: l.created_at as string,
      }]);
    }

    const digitos = (d: string) => d.match(/••\s*(\d{4})/)?.[1] ?? null;
    const suspeitas: unknown[] = [];
    for (const [hid, lista] of porCasa) {
      const porChave = new Map<string, typeof lista>();
      for (const l of lista) {
        // Mesmo cartao = mesmos 4 digitos; sem digitos, mesmo nome normalizado.
        const chave = digitos(l.description) ?? l.description.toLowerCase().replace(/\s+/g, ' ').trim();
        porChave.set(chave, [...(porChave.get(chave) ?? []), l]);
      }
      const repetidas = [...porChave.entries()].filter(([, ls]) => ls.length > 1);
      if (repetidas.length === 0) continue;

      const { data: casa } = await db
        .from('households')
        .select('prospect_name, prospect_email')
        .eq('id', hid)
        .maybeSingle();

      suspeitas.push({
        household_id: hid,
        cliente: casa?.prospect_name ?? casa?.prospect_email ?? null,
        duplicadas: repetidas.map(([chave, ls]) => ({
          cartao: chave,
          linhas: ls.map(l => ({
            id: l.id,
            nome: l.description,
            criada_em: l.created_at,
            meses_com_valor: l.values.filter(v => (v ?? 0) > 0).length,
            soma: Math.round(l.values.reduce((a, v) => a + (v ?? 0), 0) * 100) / 100,
          })),
        })),
      });
    }

    return res.status(200).json({ casas_com_cartao_duplicado: suspeitas.length, suspeitas });
  }

  // ── Varredura: todos os clientes de uma vez ────────────────────────────────
  if (req.query.varredura === '1') {
    const { data: casas } = await db
      .from('households')
      .select('id, prospect_name, prospect_email, created_at');
    const { data: membros } = await db.from('household_members').select('household_id, clerk_user_id');
    const { data: itens } = await db.from('finance_items').select('household_id, values');
    const { data: coach } = await db.from('coach_access').select('household_id, status');

    const comValorPorCasa = new Map<string, number>();
    for (const i of itens ?? []) {
      const tem = (i.values as number[] | null ?? []).some(v => (v ?? 0) > 0);
      if (tem) comValorPorCasa.set(i.household_id as string, (comValorPorCasa.get(i.household_id as string) ?? 0) + 1);
    }
    const aprovada = new Set((coach ?? []).filter(c => c.status === 'approved').map(c => c.household_id as string));
    const membrosPorCasa = new Map<string, number>();
    for (const m of membros ?? []) membrosPorCasa.set(m.household_id as string, (membrosPorCasa.get(m.household_id as string) ?? 0) + 1);

    // Mesmo e-mail em duas casas é o sintoma do vínculo quebrado.
    const porEmail = new Map<string, string[]>();
    for (const c of casas ?? []) {
      const e = (c.prospect_email as string | null)?.toLowerCase().trim();
      if (!e) continue;
      porEmail.set(e, [...(porEmail.get(e) ?? []), c.id as string]);
    }

    // Quem é o dono de cada casa vazia — é isso que transforma UUID em nome.
    const idsVazias = new Set((casas ?? []).map(c => c.id as string)
      .filter(id => (comValorPorCasa.get(id) ?? 0) === 0 && (membrosPorCasa.get(id) ?? 0) > 0));
    const loginsDasVazias = (membros ?? [])
      .filter(m => idsVazias.has(m.household_id as string))
      .map(m => m.clerk_user_id as string);
    const emailDoLogin = await emailsPorId([...new Set(loginsDasVazias)]);
    const donosPorCasa = new Map<string, string[]>();
    for (const m of membros ?? []) {
      const casa = m.household_id as string;
      if (!idsVazias.has(casa)) continue;
      const quem = emailDoLogin[m.clerk_user_id as string] ?? m.clerk_user_id as string;
      donosPorCasa.set(casa, [...(donosPorCasa.get(casa) ?? []), quem]);
    }

    const suspeitos = (casas ?? []).map(c => {
      const id = c.id as string;
      const temLogin = (membrosPorCasa.get(id) ?? 0) > 0;
      const comValor = comValorPorCasa.get(id) ?? 0;
      const email = (c.prospect_email as string | null)?.toLowerCase().trim() ?? null;
      const irmas = email ? (porEmail.get(email) ?? []).filter(x => x !== id) : [];
      const alertas: string[] = [];
      if (temLogin && comValor === 0 && !aprovada.has(id)) alertas.push('Login cai aqui, plano vazio e sem consultoria aprovada → assistente de montagem vai aparecer');
      if (irmas.length > 0) alertas.push(`Mesmo e-mail em ${irmas.length + 1} casas: ${[id, ...irmas].join(', ')}`);
      if (!temLogin && comValor > 0) alertas.push('Plano montado mas nenhum login vinculado ainda');
      return alertas.length
        ? {
            household_id: id,
            nome: c.prospect_name,
            email,
            quem_entra_aqui: donosPorCasa.get(id) ?? [],
            linhas_com_valor: comValor,
            logins: membrosPorCasa.get(id) ?? 0,
            consultoria_aprovada: aprovada.has(id),
            criada_em: c.created_at,
            alertas,
          }
        : null;
    }).filter(Boolean);

    return res.status(200).json({ total_casas: (casas ?? []).length, suspeitos });
  }

  // ── Saldo que o banco informou na última leitura ─────────────────────────
  if (req.query.saldos === '1') {
    const e = String(req.query.email ?? '').toLowerCase().trim();
    const us = e ? await usuariosPorEmail(e) : [];
    const { data: vinc } = us.length
      ? await db.from('household_members').select('household_id').in('clerk_user_id', us.map(u => u.id))
      : { data: [] as Array<{ household_id: string }> };
    const casas = (vinc ?? []).map(v => v.household_id as string);
    if (casas.length === 0) return res.status(400).json({ error: 'Passe ?saldos=1&email=...' });
    const { data, error } = await db
      .from('bank_connections')
      .select('bank_name, consent_status, account_import_enabled, saldo_atual, saldo_em, last_synced_at')
      .in('household_id', casas);
    if (error) return res.status(500).json({ error: error.message, dica: 'Rodou a migração saldo-bancario.sql?' });
    return res.status(200).json({
      agora: new Date().toISOString(),
      conexoes: (data ?? []).map(c => ({
        banco: c.bank_name,
        viva: c.consent_status !== 'revoked',
        importa_conta: c.account_import_enabled !== false,
        saldo: c.saldo_atual,
        saldo_lido_em: c.saldo_em,
        ultima_sincronizacao: c.last_synced_at,
      })),
    });
  }

  // ── Últimos envios registrados no OneSignal (o que saiu, com qual som) ───
  if (req.query.push_ultimos === '1') {
    const appId = process.env.ONESIGNAL_APP_ID;
    const apiKey = process.env.ONESIGNAL_REST_API_KEY;
    if (!appId || !apiKey) return res.status(500).json({ error: 'OneSignal não configurado' });
    const r = await fetch(`https://api.onesignal.com/notifications?app_id=${appId}&limit=8`, {
      headers: { Authorization: `Key ${apiKey}` },
    });
    const j = await r.json().catch(() => ({})) as { notifications?: Array<Record<string, unknown>> };
    const envios = (j.notifications ?? []).map(n => ({
      quando: n.completed_at ?? n.queued_at,
      titulo: (n.headings as Record<string, string> | undefined)?.pt ?? (n.headings as Record<string, string> | undefined)?.en,
      ios_sound: n.ios_sound ?? null,
      android_sound: n.android_sound ?? null,
      enviados: n.successful,
      falhas: n.failed ?? n.errored,
    }));
    return res.status(200).json({ status_http: r.status, envios });
  }

  // ── Transações do banco com um valor exato (duplicata? de qual cartão?) ──
  if (req.query.valor) {
    const e = String(req.query.email ?? '').toLowerCase().trim();
    const us = e ? await usuariosPorEmail(e) : [];
    const { data: vinc } = us.length
      ? await db.from('household_members').select('household_id').in('clerk_user_id', us.map(u => u.id))
      : { data: [] as Array<{ household_id: string }> };
    const casas = (vinc ?? []).map(v => v.household_id as string);
    if (casas.length === 0) return res.status(400).json({ error: 'Passe ?valor=...&email=...' });
    const valor = Number(String(req.query.valor).replace(',', '.'));
    const { data: conexoes } = await db
      .from('bank_connections').select('id, bank_name, cards').in('household_id', casas);
    const { data: txs, error } = await db
      .from('bank_transactions').select('*')
      .in('household_id', casas)
      .gte('amount', valor - 0.005).lte('amount', valor + 0.005)
      .order('transaction_date', { ascending: false }).limit(50);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ casas, conexoes, transacoes: txs ?? [] });
  }

  // ── Plano completo de uma casa (foto antes de conectar o banco) ──────────
  if (req.query.plano) {
    const id = String(req.query.plano).trim();
    const [{ data: casa }, { data: itens, error }] = await Promise.all([
      db.from('households').select('*').eq('id', id).maybeSingle(),
      db.from('finance_items').select('*, partial_expenses(*)').eq('household_id', id),
    ]);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ tirada_em: new Date().toISOString(), casa, linhas: itens ?? [] });
  }

  // ── Um cliente, pelo e-mail ───────────────────────────────────────────────
  const email = String(req.query.email ?? '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'Passe ?email=... ou ?varredura=1' });

  const usuarios = await usuariosPorEmail(email);
  const ids = usuarios.map(u => u.id);

  const { data: vinculos } = ids.length
    ? await db.from('household_members').select('household_id, clerk_user_id').in('clerk_user_id', ids)
    : { data: [] as Array<{ household_id: string; clerk_user_id: string }> };

  const { data: porProspect } = await db
    .from('households')
    .select('id')
    .ilike('prospect_email', email);

  const idsCasas = [...new Set([
    ...(vinculos ?? []).map(v => v.household_id as string),
    ...(porProspect ?? []).map(c => c.id as string),
  ])];

  const retratos = [] as Array<Awaited<ReturnType<typeof retratoDaCasa>>>;
  for (const id of idsCasas) retratos.push(await retratoDaCasa(id));

  const idsDoLogin = new Set((vinculos ?? []).map(v => v.household_id as string));
  const casaDoLogin = retratos.find(r => idsDoLogin.has(r.household_id)) ?? null;
  const outras = retratos.filter(r => r !== casaDoLogin);

  return res.status(200).json({
    email,
    logins_no_clerk: usuarios,
    casa_em_que_o_login_cai: casaDoLogin,
    outras_casas_com_este_email: outras,
    diagnostico: julgar(casaDoLogin, outras),
  });
}
