import React, { useState, useEffect } from 'react';
import { useUser, useAuth } from '@clerk/clerk-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BankConnection {
  id: string;
  bankCode: string;
  bankName: string;
  accountType: 'checking' | 'credit_card';
  displayName: string;
  consentStatus: 'pending_authorization' | 'authorized_fetching' | 'active' | 'expired' | 'revoked';
  lastSyncedAt: string | null;
  openFinanceLink: string | null;
  openFinanceId?: string | null;
  openfinanceStatus?: string | null;
}

interface Props {
  householdId: string;
  onClose: () => void;
}

// ─── Bank list ────────────────────────────────────────────────────────────────

/**
 * Instituições habilitadas para Extrato Open Finance na Technospeed,
 * filtradas pelas que atendem Pessoa Física.
 * Fonte: artigo "Bancos Disponíveis para Extratos Open Finance" (rev. 2026-07-28).
 *
 * Atenção: este NÃO é o enum `bankCode` de POST /api/v1/account — aquele é do
 * produto de pagamentos (CNAB) e tem só 18 códigos corporativos. O Open Finance
 * usa esta lista, que inclui código '000' para carteiras sem COMPE próprio.
 */
interface Bank {
  /** identificador único — `code` se repete (Bradesco e Next são ambos 237) */
  id: string;
  /** código COMPE enviado à Technospeed */
  code: string;
  name: string;
  /** termos extras para a busca encontrar (apelidos, nome completo) */
  alias?: string;
  /** slug do arquivo em /bancos — só quando difere do id */
  logo?: string;
  /** aviso mostrado ao selecionar */
  note?: string;
}

const BANKS: Bank[] = [
  { id: 'nubank',      code: '260', name: 'Nubank',            alias: 'nu roxinho' },
  { id: 'itau',        code: '341', name: 'Itaú',              alias: 'unibanco' },
  { id: 'bradesco',    code: '237', name: 'Bradesco' },
  { id: 'santander',   code: '033', name: 'Santander' },
  { id: 'bb',          code: '001', name: 'Banco do Brasil',   alias: 'bb' },
  { id: 'caixa',       code: '104', name: 'Caixa',             alias: 'cef economica federal',
    note: 'A Caixa está com instabilidade para novas conexões. Se falhar, tente mais tarde.' },
  { id: 'inter',       code: '077', name: 'Inter',             alias: 'banco inter' },
  { id: 'c6',          code: '336', name: 'C6 Bank',           alias: 'c6' },
  { id: 'btg',         code: '208', name: 'BTG Pactual' },
  { id: 'picpay',      code: '380', name: 'PicPay' },
  { id: 'mercadopago', code: '323', name: 'Mercado Pago',      alias: 'mp meli' },
  { id: 'pagbank',     code: '290', name: 'PagBank',           alias: 'pagseguro' },
  { id: 'neon',        code: '536', name: 'Neon' },
  { id: 'xp',          code: '348', name: 'XP Banking',        alias: 'xp investimentos' },
  { id: 'sicredi',     code: '748', name: 'Sicredi' },
  { id: 'sicoob',      code: '756', name: 'Sicoob' },
  { id: 'next',        code: '237', name: 'Next',              alias: 'bradesco digital', logo: 'bradesco' },
  { id: 'digio',       code: '335', name: 'Banco Digio',       alias: 'digio' },
  { id: 'pan',         code: '623', name: 'Banco PAN' },
  { id: 'bv',          code: '655', name: 'Banco BV',          alias: 'votorantim' },
  { id: 'safra',       code: '422', name: 'Safra' },
  { id: 'safrapay',    code: '422', name: 'SafraPay',          alias: 'safra pagamentos' },
  { id: 'safrafin',    code: '422', name: 'Safra Financeira',  logo: 'safra' },
  { id: 'banrisul',    code: '041', name: 'Banrisul' },
  { id: 'bmg',         code: '318', name: 'Banco BMG' },
  { id: 'unicred',     code: '136', name: 'Unicred' },
  { id: 'brb',         code: '070', name: 'Banco BRB',         alias: 'brasilia' },
  { id: 'bnb',         code: '004', name: 'Banco do Nordeste', alias: 'bnb' },
  { id: 'mercantil',   code: '389', name: 'Banco Mercantil' },
  { id: 'sofisa',      code: '637', name: 'Banco Sofisa',      alias: 'sofisa direto' },
  { id: 'paulista',    code: '611', name: 'Banco Paulista' },
  { id: 'portobank',   code: '724', name: 'Porto Bank',        alias: 'porto seguro' },
  { id: 'stone',       code: '197', name: 'Stone Pagamentos',  alias: 'stone' },
  { id: 'recargapay',  code: '301', name: 'RecargaPay' },
  { id: 'necton',      code: '208', name: 'Necton',            alias: 'corretora btg' },
  { id: 'woop',        code: '748', name: 'Woop',              alias: 'woop sicredi' },
  { id: 'caixatem',    code: '104', name: 'Caixa Tem',         alias: 'poupanca digital caixa' },
  { id: 'uberconta',   code: '335', name: 'Uber Conta',        alias: 'uber digio' },
  { id: 'meliuz',      code: '000', name: 'Méliuz' },
  { id: 'infinitepay', code: '000', name: 'InfinitePay' },
  { id: 'celcoin',     code: '000', name: 'Rede Celcoin',      alias: 'celcoin' },
  { id: 'pagueveloz',  code: '000', name: 'PagueVeloz',        alias: 'serasa' },
  { id: 'midway',      code: '000', name: 'Midway',            alias: 'riachuelo' },
];

/** Círculo com o logo do banco em alto relevo */
function BankAvatar({ bank, size = 44 }: { bank: Bank; size?: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className="shrink-0 rounded-full flex items-center justify-center overflow-hidden"
      style={{
        width: size,
        height: size,
        background: 'linear-gradient(145deg, #33343a, #1c1d20)',
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.10), -3px -3px 7px rgba(255,255,255,0.04), 4px 4px 9px rgba(0,0,0,0.65)',
      }}
    >
      {failed ? (
        <span className="text-zinc-300 font-black" style={{ fontSize: size * 0.34 }}>
          {bank.name.charAt(0)}
        </span>
      ) : (
        <img
          src={`/bancos/${bank.logo ?? bank.id}.png`}
          alt=""
          width={Math.round(size * 0.62)}
          height={Math.round(size * 0.62)}
          onError={() => setFailed(true)}
          style={{ width: size * 0.62, height: size * 0.62, objectFit: 'contain', borderRadius: 6 }}
        />
      )}
    </div>
  );
}

/** Tenta achar o banco no array BANKS pelo código COMPE e nome da conexão. */
function findBankForConn(bankCode: string, bankName: string): Bank | null {
  const lname = bankName.toLowerCase().trim();
  return (
    BANKS.find((b) => b.code === bankCode && b.name.toLowerCase() === lname) ??
    BANKS.find((b) => b.code === bankCode) ??
    null
  );
}

/** Badge de status da conexão bancária. */
function ConnectionStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'pending_authorization':
      return (
        <span className="text-amber-400 text-xs">
          <i className="fas fa-clock mr-1" />Aguardando autorização
        </span>
      );
    case 'authorized_fetching':
      return (
        <span className="text-blue-400 text-xs">
          <i className="fas fa-arrow-down-to-line mr-1" />Importando histórico
        </span>
      );
    case 'active':
      return (
        <span className="text-green-400 text-xs">
          <i className="fas fa-circle-check mr-1" />Conectado
        </span>
      );
    case 'expired':
      return (
        <span className="text-orange-400 text-xs">
          <i className="fas fa-rotate mr-1" />Autorização expirada
        </span>
      );
    default:
      return (
        <span className="text-red-400 text-xs">
          <i className="fas fa-circle-xmark mr-1" />Desconectado
        </span>
      );
  }
}

// localStorage: salvar/carregar identidade para evitar redigitar CPF/endereço
/**
 * Chave POR USUÁRIO. Antes era uma só: num aparelho compartilhado — o caso do
 * modo casal — o formulário do segundo vinha preenchido com o CPF do primeiro,
 * e cadastrava a conta dela sob o CPF dele sem ninguém perceber.
 */
const identityKeyFor = (userId: string | undefined) => `kashim_of_identity_${userId ?? 'anon'}`;

interface SavedIdentity {
  ownerName: string;
  cpf: string;
  cep: string;
  address: { neighborhood: string; city: string; state: string; zipcode: string; street?: string };
  addressNumber: string;
  neighborhood: string;
}

function loadSavedIdentity(userId: string | undefined): SavedIdentity | null {
  try {
    const raw = localStorage.getItem(identityKeyFor(userId));
    return raw ? (JSON.parse(raw) as SavedIdentity) : null;
  } catch {
    return null;
  }
}

function persistIdentity(userId: string | undefined, data: SavedIdentity) {
  try { localStorage.setItem(identityKeyFor(userId), JSON.stringify(data)); } catch { /* ignore */ }
}

/** Remove acento para a busca casar "itau" com "Itaú" */
function searchable(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCPF(raw: string) {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  return digits
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

function stripMask(s: string) {
  return s.replace(/\D/g, '');
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Lê a resposta com segurança: quando a função serverless falha, o Vercel
 * devolve HTML — e um res.json() cru estoura com erro ilegível no Safari.
 */
async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { /* resposta não é JSON */ }

  if (!res.ok) {
    const fromBody = parsed && typeof parsed === 'object' && 'error' in parsed
      ? String((parsed as { error: unknown }).error)
      : '';
    throw new Error(fromBody || `O servidor respondeu ${res.status}. Tente novamente em instantes.`);
  }

  if (parsed === null) {
    throw new Error('Resposta inesperada do servidor. Tente novamente.');
  }
  return parsed as T;
}

// ─── Sub-views ────────────────────────────────────────────────────────────────

type View = 'list' | 'step-identity' | 'step-bank' | 'connecting' | 'authorize' | 'syncing';

// ─── Component ────────────────────────────────────────────────────────────────

const ConectarBanco: React.FC<Props> = ({ householdId, onClose }) => {
  const { user } = useUser();
  const { getToken } = useAuth();

  const [view, setView] = useState<View>('list');
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // Form state
  const [ownerName, setOwnerName] = useState(user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() : '');
  const [cpf, setCpf] = useState('');
  const [cep, setCep] = useState('');
  const [cepLoading, setCepLoading] = useState(false);
  const [address, setAddress] = useState<{ neighborhood: string; city: string; state: string; zipcode: string; street?: string } | null>(null);
  // A Technospeed exige addressNumber e um bairro com pelo menos 1 caractere.
  // O ViaCEP não devolve número e deixa o bairro vazio em vários CEPs, então os
  // dois precisam ser editáveis pelo usuário.
  const [addressNumber, setAddressNumber] = useState('');
  const [neighborhood, setNeighborhood] = useState('');

  const [selectedBank, setSelectedBank] = useState<Bank | null>(null);
  const [bankQuery, setBankQuery] = useState('');
  const [agency, setAgency] = useState('');
  const [agencyDigit, setAgencyDigit] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountNumberDigit, setAccountNumberDigit] = useState('');

  const [error, setError] = useState('');
  const [openFinanceLink, setOpenFinanceLink] = useState('');
  const [newConnectionId, setNewConnectionId] = useState('');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'done'>('idle');
  const [syncedCount, setSyncedCount] = useState(0);
  const [syncError, setSyncError] = useState('');
  /** A Technospeed respondeu que a autorização ainda não chegou. */
  const [authPending, setAuthPending] = useState(false);
  /** id da conexão cujo status está sendo reconsultado na lista */
  const [rechecking, setRechecking] = useState('');

  // ── Load existing connections ───────────────────────────────────────────────

  useEffect(() => {
    loadConnections();
  }, [householdId]);

  /** Household com mais de um membro = modo casal ativo. */
  const [isCouple, setIsCouple] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken({ template: 'supabase' });
        const res = await fetch(`/api/of-connect?householdId=${householdId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const d = await res.json() as { connections?: Array<{ ownerFirstName?: string | null }> };
        // Dois titulares distintos entre as conexões já indicam conta dividida.
        const donos = new Set((d.connections ?? []).map((c) => c.ownerFirstName).filter(Boolean));
        if (!cancelled && donos.size > 1) setIsCouple(true);
      } catch { /* sem aviso é melhor que aviso errado */ }
    })();
    return () => { cancelled = true; };
  }, [householdId, getToken]);

  // Pré-preencher campos de identidade a partir do localStorage (evita redigitar)
  useEffect(() => {
    const saved = loadSavedIdentity(user?.id);
    if (!saved) return;
    setOwnerName((v) => v || saved.ownerName);
    setCpf((v) => v || saved.cpf);
    if (!cep && saved.cep) {
      setCep(saved.cep);
      setAddress(saved.address);
      setNeighborhood(saved.neighborhood);
      setAddressNumber(saved.addressNumber);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadConnections() {
    setLoadingList(true);
    try {
      const token = await getToken({ template: 'supabase' });
      const res = await fetch(`/api/of-connect?householdId=${householdId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await readJson<{ connections: BankConnection[] }>(res);
      setConnections(data.connections ?? []);
    } catch { /* sem conexões */ } finally {
      setLoadingList(false);
    }
  }

  // ── CEP lookup ─────────────────────────────────────────────────────────────

  async function lookupCep(value: string) {
    const digits = stripMask(value);
    if (digits.length !== 8) { setAddress(null); return; }
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json() as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
      if (data.erro) { setAddress(null); setError('CEP não encontrado'); return; }
      setAddress({
        neighborhood: data.bairro ?? '',
        city: data.localidade ?? '',
        state: data.uf ?? '',
        zipcode: digits,
        street: data.logradouro,
      });
      setNeighborhood(data.bairro ?? '');
      setError('');
    } catch {
      setAddress(null);
    } finally {
      setCepLoading(false);
    }
  }

  // ── Connect flow ───────────────────────────────────────────────────────────

  async function handleConnect() {
    setError('');
    const cpfDigits = stripMask(cpf);
    if (!ownerName.trim()) { setError('Informe seu nome completo'); return; }
    if (cpfDigits.length !== 11) { setError('CPF inválido'); return; }
    if (!address) { setError('CEP não encontrado'); return; }
    if (!addressNumber.trim()) { setError('Informe o número do endereço'); return; }
    if (!neighborhood.trim()) { setError('Informe o bairro'); return; }
    if (!selectedBank) { setError('Selecione o banco'); return; }
    if (!agency.trim()) { setError('Informe a agência'); return; }
    if (!accountNumber.trim()) { setError('Informe a conta'); return; }

    setView('connecting');
    try {
      const token = await getToken({ template: 'supabase' });
      const res = await fetch('/api/of-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          householdId,
          ownerName: ownerName.trim(),
          cpf: cpfDigits,
          address: { ...address, neighborhood: neighborhood.trim(), addressNumber: addressNumber.trim() },
          bankCode: selectedBank.code,
          agency: agency.trim(),
          agencyDigit: agencyDigit.trim() || undefined,
          accountNumber: accountNumber.trim(),
          accountNumberDigit: accountNumberDigit.trim() || undefined,
          accountType: 'checking',
        }),
      });

      const data = await readJson<{ connectionId: string; openFinanceLink: string }>(res);

      // Salvar identidade para a próxima conexão
      if (address) {
        persistIdentity(user?.id, {
          ownerName: ownerName.trim(),
          cpf,
          cep,
          address,
          addressNumber: addressNumber.trim(),
          neighborhood: neighborhood.trim(),
        });
      }

      setOpenFinanceLink(data.openFinanceLink);
      setNewConnectionId(data.connectionId);
      setView('authorize');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao conectar');
      setView('step-bank');
    }
  }

  // ── Sync after authorization ───────────────────────────────────────────────

  /**
   * "Já autorizei" pergunta à Technospeed em vez de acreditar no clique.
   * Antes daqui saía um `authorized_fetching` gravado na fé — e uma conexão que
   * nunca concluiu a jornada no banco ficava "Importando histórico" para sempre.
   */
  async function handleCheckAuthorization() {
    setSyncStatus('syncing');
    setAuthPending(false);
    setView('syncing');
    try {
      const token = await getToken({ template: 'supabase' });

      const statusRes = await fetch('/api/of-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ householdId, connectionId: newConnectionId }),
      });
      const status = await readJson<{ authorized: boolean; consentStatus: string }>(statusRes);

      // Banco ainda não confirmou: dizer isso, e não fingir que deu certo.
      if (!status.authorized) {
        setAuthPending(true);
        setSyncStatus('done');
        loadConnections();
        return;
      }

      const res = await fetch('/api/of-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ householdId, connectionId: newConnectionId }),
      });
      const data = await readJson<{ upserted?: number; status?: string }>(res);
      setSyncedCount(data.upserted ?? 0);
      setSyncError('');
      setSyncStatus('done');
      loadConnections();
    } catch (err: unknown) {
      setSyncError(err instanceof Error ? err.message : 'Não foi possível verificar agora. Tente novamente.');
      setSyncStatus('done');
    }
  }

  /** Reconsulta o status de uma conexão já existente na lista. */
  async function handleRecheck(connectionId: string) {
    setRechecking(connectionId);
    try {
      const token = await getToken({ template: 'supabase' });
      await fetch('/api/of-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ householdId, connectionId }),
      });
      await loadConnections();
    } catch { /* status fica como está */ } finally {
      setRechecking('');
    }
  }

  // ── Revoke ─────────────────────────────────────────────────────────────────

  async function handleRevoke(connectionId: string) {
    if (!confirm('Deseja desconectar este banco? Seus dados históricos serão mantidos.')) return;
    try {
      const token = await getToken({ template: 'supabase' });
      await fetch('/api/of-connect', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ householdId, connectionId }),
      });
      loadConnections();
    } catch { /* ignore */ }
  }

  // ── Renders ────────────────────────────────────────────────────────────────

  function resetForm() {
    setSelectedBank(null);
    setAgency('');
    setAgencyDigit('');
    setAccountNumber('');
    setAccountNumberDigit('');
    setError('');
    setView('list');
  }

  // ─── View: list ────────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="fixed inset-0 z-[300] overflow-y-auto bg-black/80 backdrop-blur-sm flex items-start justify-center p-4 pt-10">
        <div className="max-w-lg w-full pb-16">

          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-black uppercase italic tracking-tighter text-white">
              <i className="fas fa-university text-green-400 mr-2"></i>Bancos conectados
            </h2>
            <button onClick={onClose} className="w-10 h-10 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
              <i className="fas fa-times"></i>
            </button>
          </div>

          {loadingList ? (
            <div className="text-center py-12 text-zinc-500">
              <i className="fas fa-circle-notch animate-spin text-2xl mb-3 block"></i>
              Carregando…
            </div>
          ) : connections.length === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 text-center mb-4">
              <div className="text-5xl mb-4">🏦</div>
              <p className="text-white font-bold mb-1">Nenhum banco conectado</p>
              <p className="text-zinc-500 text-sm">Conecte seu banco para ver seus gastos automaticamente.</p>
            </div>
          ) : (
            <div className="space-y-3 mb-4">
              {connections.map((conn) => {
                const bank = findBankForConn(conn.bankCode ?? '', conn.bankName);
                return (
                  <div key={conn.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center gap-3">
                    {bank
                      ? <BankAvatar bank={bank} size={40} />
                      : (
                        <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center flex-shrink-0">
                          <span className="text-zinc-400 font-black text-sm">{conn.bankName.charAt(0)}</span>
                        </div>
                      )
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-bold text-sm truncate">{conn.displayName}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <ConnectionStatusBadge status={conn.consentStatus} />
                        {conn.lastSyncedAt && (
                          <span className="text-zinc-600 text-xs">· {formatDate(conn.lastSyncedAt)}</span>
                        )}
                      </div>
                      {(conn.consentStatus === 'pending_authorization' || conn.consentStatus === 'authorized_fetching') && (
                        <div className="flex items-center gap-3 mt-1.5">
                          {conn.openFinanceLink && (
                            <a
                              href={conn.openFinanceLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-amber-400 text-xs hover:underline"
                            >
                              Retomar autorização →
                            </a>
                          )}
                          <button
                            onClick={() => handleRecheck(conn.id)}
                            disabled={rechecking === conn.id}
                            className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors disabled:opacity-50"
                          >
                            {rechecking === conn.id
                              ? <><i className="fas fa-circle-notch animate-spin mr-1"></i>Verificando…</>
                              : <><i className="fas fa-rotate mr-1"></i>Verificar status</>}
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleRevoke(conn.id)}
                      className="text-zinc-700 hover:text-red-400 transition-colors text-sm px-2 py-1 flex-shrink-0"
                    >
                      <i className="fas fa-trash-can"></i>
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <button
            onClick={() => setView('step-identity')}
            className="w-full py-4 bg-green-500 hover:bg-green-400 text-black font-black uppercase tracking-widest text-sm rounded-2xl transition-all active:scale-95"
          >
            <i className="fas fa-plus mr-2"></i>Conectar banco
          </button>
        </div>
      </div>
    );
  }

  // ─── View: step-identity (nome + CPF + CEP) ────────────────────────────────
  if (view === 'step-identity') {
    return (
      <div className="fixed inset-0 z-[300] overflow-y-auto bg-black/80 backdrop-blur-sm flex items-start justify-center p-4 pt-10">
        <div className="max-w-lg w-full pb-16">

          <div className="flex items-center gap-3 mb-6">
            <button onClick={resetForm} className="w-10 h-10 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
              <i className="fas fa-arrow-left"></i>
            </button>
            <div>
              <p className="text-zinc-500 text-xs uppercase tracking-widest">Passo 1 de 2</p>
              <h2 className="text-xl font-black uppercase italic tracking-tighter text-white">Seus dados</h2>
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-4">

            <div>
              <label className="text-zinc-400 text-xs uppercase tracking-widest block mb-1.5">Nome completo</label>
              <input
                type="text"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Seu nome completo"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-green-500"
              />
            </div>

            <div>
              <label className="text-zinc-400 text-xs uppercase tracking-widest block mb-1.5">CPF</label>
              <input
                type="text"
                inputMode="numeric"
                value={cpf}
                onChange={(e) => setCpf(formatCPF(e.target.value))}
                placeholder="000.000.000-00"
                maxLength={14}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-green-500"
              />
            </div>

            <div>
              <label className="text-zinc-400 text-xs uppercase tracking-widest block mb-1.5">CEP</label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  value={cep}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 8);
                    setCep(v);
                    lookupCep(v);
                  }}
                  placeholder="00000000"
                  maxLength={8}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-green-500"
                />
                {cepLoading && (
                  <i className="fas fa-circle-notch animate-spin absolute right-4 top-3.5 text-zinc-500"></i>
                )}
              </div>
              {address && (
                <p className="text-green-400 text-xs mt-1.5">
                  <i className="fas fa-check mr-1"></i>{address.street ? `${address.street}, ` : ''}{address.city} — {address.state}
                </p>
              )}
            </div>

            {address && (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-zinc-400 text-xs uppercase tracking-widest block mb-1.5">Número</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={addressNumber}
                    onChange={(e) => setAddressNumber(e.target.value.slice(0, 10))}
                    placeholder="123"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-green-500"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-zinc-400 text-xs uppercase tracking-widest block mb-1.5">Bairro</label>
                  <input
                    type="text"
                    value={neighborhood}
                    onChange={(e) => setNeighborhood(e.target.value.slice(0, 100))}
                    placeholder="Centro"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-green-500"
                  />
                </div>
              </div>
            )}

            {error && (
              <p className="text-red-400 text-xs"><i className="fas fa-circle-exclamation mr-1"></i>{error}</p>
            )}

            <button
              onClick={() => {
                const d = stripMask(cpf);
                if (!ownerName.trim()) { setError('Informe seu nome completo'); return; }
                if (d.length !== 11) { setError('CPF inválido'); return; }
                if (!address) { setError('CEP não encontrado'); return; }
                if (!addressNumber.trim()) { setError('Informe o número do endereço'); return; }
                if (!neighborhood.trim()) { setError('Informe o bairro'); return; }
                setError('');
                setView('step-bank');
              }}
              className="w-full py-4 bg-green-500 hover:bg-green-400 text-black font-black uppercase tracking-widest text-sm rounded-2xl transition-all active:scale-95"
            >
              Continuar <i className="fas fa-arrow-right ml-1"></i>
            </button>
          </div>

          <p className="text-zinc-600 text-xs text-center mt-4 px-4">
            Seus dados são usados apenas para autorizar a conexão com o banco. Nada é compartilhado.
          </p>
        </div>
      </div>
    );
  }

  // ─── View: step-bank ───────────────────────────────────────────────────────
  if (view === 'step-bank') {
    return (
      <div className="fixed inset-0 z-[300] overflow-y-auto bg-black/80 backdrop-blur-sm flex items-start justify-center p-4 pt-10">
        <div className="max-w-lg w-full pb-16">

          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => { setError(''); setView('step-identity'); }} className="w-10 h-10 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
              <i className="fas fa-arrow-left"></i>
            </button>
            <div>
              <p className="text-zinc-500 text-xs uppercase tracking-widest">Passo 2 de 2</p>
              <h2 className="text-xl font-black uppercase italic tracking-tighter text-white">Dados do banco</h2>
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-5">

            {/* Bank picker — busca + lista com logo em alto relevo */}
            <div>
              <label className="text-zinc-400 text-xs uppercase tracking-widest block mb-2">Banco</label>

              <div className="relative mb-2">
                <i className="fas fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 text-sm"></i>
                <input
                  type="text"
                  value={bankQuery}
                  onChange={(e) => setBankQuery(e.target.value)}
                  placeholder="Buscar banco…"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl pl-11 pr-10 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-green-500"
                />
                {bankQuery && (
                  <button
                    onClick={() => setBankQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-zinc-700 text-zinc-300 flex items-center justify-center hover:bg-zinc-600 transition-colors"
                    aria-label="Limpar busca"
                  >
                    <i className="fas fa-times text-[10px]"></i>
                  </button>
                )}
              </div>

              <div className="max-h-64 overflow-y-auto rounded-xl border border-zinc-800 divide-y divide-zinc-800">
                {(() => {
                  const q = searchable(bankQuery.trim());
                  const list = q
                    ? BANKS.filter((b) =>
                        searchable(`${b.name} ${b.alias ?? ''} ${b.code}`).includes(q),
                      )
                    : BANKS;
                  // `code` se repete entre instituições — a chave é o id

                  if (list.length === 0) {
                    return (
                      <p className="text-zinc-500 text-sm text-center py-8 px-4">
                        Nenhum banco encontrado com “{bankQuery}”.
                      </p>
                    );
                  }

                  return list.map((bank) => {
                    const active = selectedBank?.id === bank.id;
                    return (
                      <button
                        key={bank.id}
                        onClick={() => setSelectedBank(bank)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${active ? 'bg-green-500/15' : 'hover:bg-zinc-800/70'}`}
                      >
                        <BankAvatar bank={bank} />
                        <span className={`flex-1 text-sm font-bold ${active ? 'text-green-400' : 'text-zinc-200'}`}>
                          {bank.name}
                        </span>
                        {active && <i className="fas fa-circle-check text-green-400"></i>}
                      </button>
                    );
                  });
                })()}
              </div>

              {selectedBank && (
                <p className="text-zinc-500 text-xs mt-2">
                  Selecionado: <span className="text-zinc-300 font-bold">{selectedBank.name}</span>
                </p>
              )}

              {selectedBank?.note && (
                <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2.5 mt-2">
                  <i className="fas fa-triangle-exclamation text-amber-400 text-xs mt-0.5"></i>
                  <span className="text-amber-300/90 text-xs leading-relaxed">{selectedBank.note}</span>
                </div>
              )}
            </div>

            {/* Agency + account */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-zinc-400 text-xs uppercase tracking-widest block mb-1.5">Agência</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={agency}
                  onChange={(e) => setAgency(e.target.value.replace(/\D/g, ''))}
                  placeholder="0000"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-green-500"
                />
              </div>
              <div>
                <label className="text-zinc-400 text-xs uppercase tracking-widest block mb-1.5">Dígito</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={agencyDigit}
                  onChange={(e) => setAgencyDigit(e.target.value.slice(0, 2))}
                  placeholder="0"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-green-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-zinc-400 text-xs uppercase tracking-widest block mb-1.5">Conta</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                  placeholder="00000"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-green-500"
                />
              </div>
              <div>
                <label className="text-zinc-400 text-xs uppercase tracking-widest block mb-1.5">Dígito</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={accountNumberDigit}
                  onChange={(e) => setAccountNumberDigit(e.target.value.slice(0, 2))}
                  placeholder="0"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-green-500"
                />
              </div>
            </div>

            {error && (
              <p className="text-red-400 text-xs"><i className="fas fa-circle-exclamation mr-1"></i>{error}</p>
            )}

            <button
              onClick={handleConnect}
              className="w-full py-4 bg-green-500 hover:bg-green-400 text-black font-black uppercase tracking-widest text-sm rounded-2xl transition-all active:scale-95"
            >
              Conectar banco <i className="fas fa-arrow-right ml-1"></i>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── View: connecting (loading) ────────────────────────────────────────────
  if (view === 'connecting') {
    return (
      <div className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-sm flex items-center justify-center">
        <div className="text-center">
          <i className="fas fa-circle-notch animate-spin text-green-400 text-4xl mb-4 block"></i>
          <p className="text-white font-bold">Configurando conexão…</p>
          <p className="text-zinc-500 text-sm mt-1">Isso leva apenas alguns segundos</p>
        </div>
      </div>
    );
  }

  // ─── View: authorize ───────────────────────────────────────────────────────
  if (view === 'authorize') {
    return (
      <div className="fixed inset-0 z-[300] overflow-y-auto bg-black/80 backdrop-blur-sm flex items-start justify-center p-4 pt-10">
        <div className="max-w-lg w-full pb-16 text-center">

          <div className="text-6xl mb-6">🔐</div>

          <h2 className="text-2xl font-black uppercase italic tracking-tighter text-white mb-2">
            Autorize no seu banco
          </h2>
          {/* No modo casal o extrato bruto fica visível para o parceiro — coisa
              diferente de compartilhar o plano. Quem autorizou na Technospeed
              autorizou os dados DELE; dividir isso dentro do app é decisão
              nossa, e precisa ser dita antes, não descoberta depois. */}
          {isCouple && (
            <div className="bg-amber-500/10 border border-amber-500/25 rounded-2xl px-4 py-3 mb-4 text-left flex items-start gap-2.5">
              <i className="fas fa-users text-amber-400 text-sm mt-0.5 flex-shrink-0" />
              <p className="text-amber-200/90 text-xs leading-relaxed">
                Sua conta é compartilhada. Os lançamentos deste banco — valores, datas e
                estabelecimentos — <strong>ficarão visíveis para a outra pessoa</strong> do plano.
              </p>
            </div>
          )}

          {/* Instrução baseada no que REALMENTE funcionou: a única autorização
              concluída até hoje (Bradesco, 2026-08-11) foi pelo navegador. Pelo
              app do banco a jornada quebra — o Itaú chega a pedir para instalar
              um app já instalado. Enquanto a Tecnospeed não resolve, mandamos
              pelo caminho que fecha. */}
          <p className="text-zinc-400 text-sm mb-5 px-4">
            Faça pelo <strong className="text-zinc-200">navegador</strong>, entrando na sua conta pelo
            site do banco. Pelo aplicativo a autorização costuma travar no meio.
          </p>

          {/* O que esperar — de propósito não pedimos para "marcar conta e
              cartão": o fluxo do banco não oferece essa escolha, é uma
              autorização única. Mandar procurar por ela só gera dúvida. */}
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl px-4 py-4 mb-5 text-left">
            <p className="text-zinc-300 text-xs font-bold uppercase tracking-widest mb-3">
              O que vai acontecer
            </p>
            <div className="space-y-2.5">
              {[
                'O banco pede para escolher a instituição de novo — é normal, pode escolher.',
                'Entre pelo site do banco, não pelo aplicativo.',
                'Você informa o CPF e confirma o compartilhamento.',
                'Pronto. Uma autorização já cobre conta e cartão do mesmo banco.',
              ].map((text, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="w-4 flex-shrink-0 text-green-400 text-xs font-black mt-0.5">{i + 1}</span>
                  <p className="text-zinc-300 text-sm leading-snug">{text}</p>
                </div>
              ))}
            </div>
          </div>

          <a
            href={openFinanceLink}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full py-4 bg-green-500 hover:bg-green-400 text-black font-black uppercase tracking-widest text-sm rounded-2xl transition-all active:scale-95 mb-3"
          >
            <i className="fas fa-external-link mr-2"></i>Abrir autorização do banco
          </a>

          <button
            onClick={handleCheckAuthorization}
            className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 text-white font-black uppercase tracking-widest text-sm rounded-2xl transition-all active:scale-95"
          >
            Já autorizei no banco
          </button>

          <div className="flex items-start gap-2.5 bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3.5 mt-4 text-left">
            <i className="fas fa-clock text-zinc-500 text-sm mt-0.5"></i>
            <p className="text-zinc-400 text-xs leading-relaxed">
              Depois de autorizar, o banco leva de <strong className="text-zinc-200">6 a 24 horas</strong> para
              liberar seu histórico — é uma regra do Open Finance, não do Kashim. Pode fechar o app:
              seus gastos aparecem sozinhos quando o banco enviar.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ─── View: syncing ─────────────────────────────────────────────────────────
  if (view === 'syncing') {
    return (
      <div className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-sm flex items-center justify-center">
        <div className="max-w-sm w-full mx-4 text-center">
          {syncStatus !== 'done' ? (
            <>
              <i className="fas fa-circle-notch animate-spin text-green-400 text-4xl mb-4 block"></i>
              <p className="text-white font-bold">Verificando com o banco…</p>
              <p className="text-zinc-500 text-sm mt-1">Só um instante</p>
            </>
          ) : authPending ? (
            /* A Technospeed diz que o consentimento não existe ainda. Antes
               daqui saía "Banco conectado" — que era mentira e escondia uma
               jornada de autorização que tinha quebrado no meio. */
            <>
              <div className="text-6xl mb-4">⏳</div>
              <p className="text-white font-black text-xl mb-2">Ainda não chegou</p>
              <p className="text-zinc-400 text-sm mb-2 px-2">
                O banco não confirmou a autorização. Se você acabou de autorizar, aguarde
                alguns minutos e verifique de novo.
              </p>
              <p className="text-zinc-500 text-xs mb-6 px-2">
                Se a tela do banco não abriu ou deu erro no meio, é só refazer pelo link.
              </p>

              {openFinanceLink && (
                <a
                  href={openFinanceLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full py-4 bg-green-500 hover:bg-green-400 text-black font-black uppercase tracking-widest text-sm rounded-2xl transition-all active:scale-95 mb-3"
                >
                  <i className="fas fa-external-link mr-2"></i>Autorizar de novo
                </a>
              )}
              <button
                onClick={handleCheckAuthorization}
                className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 text-white font-black uppercase tracking-widest text-sm rounded-2xl transition-all active:scale-95 mb-3"
              >
                Verificar de novo
              </button>
              <button
                onClick={() => { setAuthPending(false); resetForm(); }}
                className="w-full py-3 text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
              >
                Deixar para depois
              </button>
            </>
          ) : (
            <>
              {/* 0 transações não é erro: o banco leva de 6 a 24h para liberar
                  o histórico depois da autorização (latência do Open Finance). */}
              <div className="text-6xl mb-4">{syncError ? '⚠️' : syncedCount > 0 ? '✅' : '🔗'}</div>
              <p className="text-white font-black text-xl mb-2">
                {syncError ? 'Não deu certo' : syncedCount > 0 ? 'Pronto!' : 'Banco conectado'}
              </p>

              {syncError ? (
                <p className="text-zinc-400 text-sm mb-8">{syncError}</p>
              ) : syncedCount > 0 ? (
                <>
                  <p className="text-zinc-400 text-sm mb-2">
                    {syncedCount} transação{syncedCount !== 1 ? 'ões' : ''} importada{syncedCount !== 1 ? 's' : ''}.
                  </p>
                  <p className="text-zinc-500 text-xs mb-8">
                    Seus gastos já estão nas categorias.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-zinc-400 text-sm mb-2 px-2">
                    Agora é com o banco: ele libera seu histórico em até 24 horas.
                  </p>
                  <p className="text-zinc-500 text-xs mb-8 px-2">
                    Você não precisa fazer mais nada — seus gastos entram sozinhos assim que chegarem.
                  </p>
                </>
              )}

              <button
                onClick={syncError ? () => setView('list') : onClose}
                className="w-full py-4 bg-green-500 hover:bg-green-400 text-black font-black uppercase tracking-widest text-sm rounded-2xl transition-all active:scale-95"
              >
                {syncError ? 'Voltar' : syncedCount > 0 ? 'Ver meus gastos' : 'Entendi'}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return null;
};

export default ConectarBanco;
