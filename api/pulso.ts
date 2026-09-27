import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

/**
 * PULSO — o raio-x do lançamento, numa chamada só.
 *
 * Depois que o app está no ar, o risco muda de lugar: não é mais "será que
 * funciona?", é "quebrou e ninguém me contou". Foi assim três vezes nesta
 * semana — o cron morto por dois dias, o script do layout bloqueado pelo CSP,
 * a assistente gravando no vazio. Nas três, o dado existia e ninguém olhava.
 *
 * Esta rota olha. Ela responde o que o Eduardo precisa saber todo dia:
 * entrou gente? essa gente ANDOU? onde ela parou?
 *
 * SÓ LEITURA. Protegida pelo CRON_SECRET, como o vigia e o `?faxina=1`.
 *
 * O funil, na ordem em que a pessoa vive:
 *   1. cadastrou        — a casa existe
 *   2. abriu o app      — `last_active_at` carimbado
 *   3. preencheu o plano— alguma linha com valor > 0 (o wizard grava aqui)
 *   4. conectou banco   — tem conexão não revogada
 *   5. categorizou      — tirou pelo menos uma transação da fila
 *
 * Quem para entre um degrau e outro é o que interessa: é ali que o produto
 * está perdendo gente, e é ali que dá para agir.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';
const CRON_SECRET = process.env.CRON_SECRET ?? '';
/** O Eduardo lê em horário de Brasília; o banco guarda em UTC. */
const FUSO_BR = -3;

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/** Início do dia brasileiro, em UTC. `voltar=1` é ontem. */
function inicioDoDiaBR(voltar = 0): Date {
  const agora = new Date();
  const br = new Date(agora.getTime() + FUSO_BR * 3_600_000);
  br.setUTCHours(0, 0, 0, 0);
  return new Date(br.getTime() - FUSO_BR * 3_600_000 - voltar * 86_400_000);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  const auth = (req.headers.authorization ?? '').replace('Bearer ', '').trim();
  if (CRON_SECRET && auth !== CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const hoje = inicioDoDiaBR();
    const ontem = inicioDoDiaBR(1);
    const seteDias = new Date(Date.now() - 7 * 86_400_000);
    const trintaDias = new Date(Date.now() - 30 * 86_400_000);

    // ── A coorte: quem entrou nos últimos 30 dias ────────────────────────────
    const { data: casas, error } = await db
      .from('households')
      .select('id, created_at, first_access_at, last_active_at, status, subscription_status, prospect_name, prospect_email')
      .gte('created_at', trintaDias.toISOString())
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    const { count: totalCasas } = await db
      .from('households').select('id', { count: 'exact', head: true });

    const recentes = casas ?? [];
    const ids = recentes.map((c) => c.id as string);

    // ── Degraus 3, 4 e 5, só para a coorte ──────────────────────────────────
    const [{ data: linhas }, { data: conexoes }, { data: transacoes }, { data: coachRows }] = await Promise.all([
      ids.length
        ? db.from('finance_items').select('household_id, values').in('household_id', ids)
        : Promise.resolve({ data: [] as Array<{ household_id: string; values: number[] }> }),
      ids.length
        ? db.from('bank_connections').select('household_id, consent_status, last_synced_at').in('household_id', ids)
        : Promise.resolve({ data: [] as Array<{ household_id: string; consent_status: string; last_synced_at: string | null }> }),
      ids.length
        ? db.from('bank_transactions').select('household_id, status').in('household_id', ids)
        : Promise.resolve({ data: [] as Array<{ household_id: string; status: string }> }),
      ids.length
        ? db.from('coach_access').select('household_id').in('household_id', ids)
        : Promise.resolve({ data: [] as Array<{ household_id: string }> }),
    ]);

    /**
     * A pessoa VÊ a conexão bancária?
     *
     * Repete, de propósito, a mesma regra do `check-coach-access.ts`, que é
     * quem o app pergunta. Cliente de coach não vê Open Finance; cadastro
     * espontâneo vê. Se este campo discordar da realidade, é aqui que se
     * descobre — e foi assim que apareceu o motivo de 0 de 7 não conectarem.
     */
    const temCoachRow = new Set((coachRows ?? []).map((c) => c.household_id as string));
    const veOpenFinance = (c: (typeof recentes)[number]) => {
      // Mesma regra do check-coach-access — `status` NAO entra: os dois
      // caminhos de criacao produzem 'draft'. Ver o comentario de la.
      const ehDoCoach = temCoachRow.has(c.id as string)
        || !!c.prospect_name || !!c.prospect_email;
      return !ehDoCoach;
    };

    const comPlano = new Set<string>();
    for (const l of linhas ?? []) {
      const vs = Array.isArray(l.values) ? l.values as number[] : [];
      if (vs.some((v) => Number(v) > 0)) comPlano.add(l.household_id as string);
    }
    const comBanco = new Set<string>();
    for (const c of conexoes ?? []) {
      if (c.consent_status !== 'revoked') comBanco.add(c.household_id as string);
    }
    const categorizou = new Set<string>();
    const filaPorCasa = new Map<string, number>();
    for (const t of transacoes ?? []) {
      const h = t.household_id as string;
      if (t.status === 'categorized') categorizou.add(h);
      if (t.status === 'pending') filaPorCasa.set(h, (filaPorCasa.get(h) ?? 0) + 1);
    }

    const desde = (d: Date) => recentes.filter((c) => new Date(String(c.created_at)) >= d);
    const naJanela = desde(seteDias);
    const contarNa = (lista: typeof recentes, conjunto: Set<string>) =>
      lista.filter((c) => conjunto.has(c.id as string)).length;

    /**
     * As duas populações NÃO têm o mesmo funil — e misturá-las mente.
     *
     * `create-client.ts` grava o plano do cliente no momento em que o coach o
     * cria, antes de a pessoa abrir o app uma única vez. Junto, o relatório
     * dizia "9 preencheram o plano, 4 abriram o app" — impossível, e foi esse
     * absurdo que denunciou a mistura (2026-09-27).
     *
     * Cadastro espontâneo:  cadastrou → abriu → preencheu → conectou → categorizou
     * Cliente do coach:     o coach já preencheu → falta ele ABRIR → conectar
     */
    const doCoach = (c: (typeof recentes)[number]) => !!(c.prospect_name || c.prospect_email);
    const espontaneos = naJanela.filter((c) => !doCoach(c));
    const doConsultor = naJanela.filter(doCoach);

    /** Onde a pessoa parou — o degrau mais alto que ela alcançou. */
    const ondeParou = (c: (typeof recentes)[number]): string => {
      const id = c.id as string;
      if (categorizou.has(id)) return 'categorizou';
      if (comBanco.has(id)) return 'conectou banco';
      // Cliente do coach nasce com o plano pronto: dizer que ele "preencheu"
      // seria dar crédito por um passo que quem deu foi o coach.
      if (!(c.prospect_name || c.prospect_email) && comPlano.has(id)) return 'preencheu o plano';
      if (c.last_active_at) return 'abriu o app';
      return 'NUNCA ABRIU';
    };

    const maisRecente = (conexoes ?? [])
      .map((c) => (c.last_synced_at ? new Date(String(c.last_synced_at)).getTime() : 0))
      .reduce((a, b) => Math.max(a, b), 0);

    return res.status(200).json({
      tirada_em: new Date().toISOString(),
      cadastros: {
        hoje: desde(hoje).length,
        ontem: desde(ontem).length - desde(hoje).length,
        ultimos_7_dias: naJanela.length,
        total_de_sempre: totalCasas ?? null,
      },
      funil_cadastro_espontaneo_7_dias: {
        '1_cadastraram': espontaneos.length,
        '2_abriram_o_app': espontaneos.filter((c) => !!c.last_active_at).length,
        '3_preencheram_o_plano': contarNa(espontaneos, comPlano),
        '4_conectaram_banco': contarNa(espontaneos, comBanco),
        '5_categorizaram': contarNa(espontaneos, categorizou),
      },
      // O coach já entrega o plano pronto: o degrau que falta é a pessoa ABRIR.
      funil_cliente_do_coach_7_dias: {
        '1_coach_criou': doConsultor.length,
        '2_abriram_o_app': doConsultor.filter((c) => !!c.last_active_at).length,
        '3_conectaram_banco': contarNa(doConsultor, comBanco),
        '4_categorizaram': contarNa(doConsultor, categorizou),
      },
      // Cada linha é uma pessoa de verdade que travou num degrau. É a lista
      // em que dá para AGIR — mandar mensagem, ligar, ajustar a tela.
      quem_entrou_nos_7_dias: naJanela.map((c) => ({
        casa: c.id,
        origem: doCoach(c) ? 'coach' : 'espontâneo',
        quem: c.prospect_name ?? c.prospect_email ?? '(cadastro espontâneo)',
        cadastrou_em: c.created_at,
        parou_em: ondeParou(c),
        status_da_casa: c.status ?? null,
        ve_open_finance: veOpenFinance(c),
        fila_esperando: filaPorCasa.get(c.id as string) ?? 0,
        assinatura: c.subscription_status ?? null,
      })),
      fila_de_categorizacao: {
        transacoes_pendentes: [...filaPorCasa.values()].reduce((a, b) => a + b, 0),
        casas_com_fila: filaPorCasa.size,
      },
      sincronizacao: {
        mais_recente: maisRecente ? new Date(maisRecente).toISOString() : null,
        horas_atras: maisRecente ? Number(((Date.now() - maisRecente) / 3_600_000).toFixed(1)) : null,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return res.status(500).json({ error: msg });
  }
}
