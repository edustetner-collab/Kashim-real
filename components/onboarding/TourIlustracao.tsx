// Telas desenhadas para o tour — nunca prints.
//
// Print envelhece a cada mudança de layout e, pior, carrega dado real: CPF,
// agência, conta e nome de terceiros que nunca autorizaram nada. Estes desenhos
// são esquemáticos de propósito: sem barra de status, sem bateria, sem detalhe
// que não ensina. Todos os valores vêm da tabela de dados fictícios em
// docs/openfinance/FLUXO-CONEXAO-TELAS.md.
//
// As telas 4 a 9 do fluxo NÃO são nossas (Technospeed, Pluggy, banco). Aqui elas
// aparecem em fundo claro, com a barra do navegador visível, justamente para o
// usuário reconhecer que saiu do Kashim — é o que ele vai ver de verdade.

import React from 'react';
import { TourIlustracaoId } from '../../lib/onboarding/types';

// ── Primitivas ───────────────────────────────────────────────────────────────

/** Moldura da tela. `clara` = fora do Kashim (navegador). */
const Tela: React.FC<{ clara?: boolean; children: React.ReactNode }> = ({ clara, children }) => (
  <div
    className={`rounded-xl overflow-hidden border ${
      clara ? 'bg-[#f7f7f9] border-zinc-300' : 'bg-[#111214] border-zinc-700'
    }`}
  >
    {children}
  </div>
);

/** Barra de endereço — o sinal de que o usuário saiu do app. */
const BarraNavegador: React.FC<{ url: string }> = ({ url }) => (
  <div className="flex items-center gap-1.5 bg-zinc-300 px-2 py-1.5">
    <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
    <span className="flex-1 truncate text-center text-[8px] font-medium text-zinc-700">{url}</span>
  </div>
);

const Titulo: React.FC<{ children: React.ReactNode; clara?: boolean }> = ({ children, clara }) => (
  <p className={`text-[10px] font-black leading-tight ${clara ? 'text-zinc-900' : 'text-white'}`}>
    {children}
  </p>
);

const Rotulo: React.FC<{ children: React.ReactNode; clara?: boolean }> = ({ children, clara }) => (
  <p className={`text-[7px] font-bold uppercase tracking-wider ${clara ? 'text-zinc-500' : 'text-zinc-500'}`}>
    {children}
  </p>
);

/** Campo de formulário preenchido. */
const Campo: React.FC<{ rotulo: string; valor: string }> = ({ rotulo, valor }) => (
  <div>
    <Rotulo>{rotulo}</Rotulo>
    <div className="mt-0.5 rounded-md bg-zinc-800 px-2 py-1.5 text-[8px] text-zinc-200">{valor}</div>
  </div>
);

const Botao: React.FC<{ children: React.ReactNode; cor?: 'verde' | 'laranja' | 'azul' }> = ({
  children, cor = 'verde',
}) => {
  const fundo =
    cor === 'laranja' ? 'bg-[#f47b20] text-white'
      : cor === 'azul' ? 'bg-[#1f7a8c] text-white'
        : 'bg-[#a8e716] text-black';
  return (
    <div className={`${fundo} rounded-lg py-1.5 text-center text-[8px] font-black uppercase tracking-wider`}>
      {children}
    </div>
  );
};

/** Linha de lançamento no extrato. */
const Lancamento: React.FC<{ nome: string; valor: string; etiqueta?: string; entrada?: boolean }> = ({
  nome, valor, etiqueta, entrada,
}) => (
  <div className="flex items-center gap-1.5 border-b border-zinc-200 px-2 py-1.5 last:border-0">
    <span
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[7px] ${
        entrada ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
      }`}
    >
      <i className={`fas ${entrada ? 'fa-arrow-down' : 'fa-arrow-up'}`} />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[8px] font-bold text-zinc-800">{nome}</span>
      {etiqueta && (
        <span
          className={`mt-0.5 inline-block rounded px-1 py-px text-[6px] font-bold ${
            etiqueta === 'escolher categoria'
              ? 'bg-zinc-200 text-zinc-600'
              : 'bg-sky-100 text-sky-700'
          }`}
        >
          {etiqueta}
        </span>
      )}
    </span>
    <span className={`shrink-0 text-[8px] font-black ${entrada ? 'text-green-600' : 'text-zinc-900'}`}>
      {valor}
    </span>
  </div>
);

// ── As nove telas ────────────────────────────────────────────────────────────

const DESENHOS: Record<TourIlustracaoId, React.FC> = {
  'of-seus-dados': () => (
    <Tela>
      <div className="space-y-2 p-2.5">
        <Rotulo>Passo 1 de 2</Rotulo>
        <Titulo>Seus dados</Titulo>
        <Campo rotulo="Nome completo" valor="Marina Alves Ferreira" />
        <Campo rotulo="CPF" valor="000.000.000-00" />
        <Campo rotulo="CEP" valor="00000-000" />
        <Botao>Continuar →</Botao>
      </div>
    </Tela>
  ),

  'of-dados-banco': () => (
    <Tela>
      <div className="space-y-2 p-2.5">
        <Rotulo>Passo 2 de 2</Rotulo>
        <Titulo>Dados do banco</Titulo>
        <div className="rounded-md border border-zinc-700 bg-zinc-800/60">
          {['Banco do Brasil', 'Caixa', 'Inter'].map((b, i) => (
            <div
              key={b}
              className={`px-2 py-1.5 text-[8px] ${i === 2 ? 'font-black text-[#a8e716]' : 'text-zinc-400'}`}
            >
              {b}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Campo rotulo="Agência" valor="0001" />
          <Campo rotulo="Conta" valor="12345-6" />
        </div>
        <Botao>Conectar banco →</Botao>
      </div>
    </Tela>
  ),

  'of-autorize': () => (
    <Tela>
      <div className="space-y-2 p-2.5">
        <Titulo>Autorize no seu banco</Titulo>
        <div className="space-y-1 rounded-md bg-zinc-800/60 p-2">
          {[
            'O banco pede para escolher a instituição de novo — é normal.',
            'Entre pelo site do banco, não pelo aplicativo.',
            'Informe o CPF e confirme o compartilhamento.',
          ].map((t, i) => (
            <div key={i} className="flex gap-1.5">
              <span className="text-[7px] font-black text-[#a8e716]">{i + 1}</span>
              <span className="text-[7px] leading-snug text-zinc-300">{t}</span>
            </div>
          ))}
        </div>
        <Botao>Abrir autorização do banco</Botao>
      </div>
    </Tela>
  ),

  'of-saindo-do-app': () => (
    <Tela clara>
      <BarraNavegador url="api.pagamentobancario.com.br" />
      <div className="space-y-2 p-2.5 text-center">
        <p className="text-[9px] font-black text-zinc-800">
          <span className="text-[#0a7ea4]">open</span>finance
        </p>
        <div className="rounded-md border border-zinc-300 bg-white p-2">
          <Rotulo clara>Informações da conta</Rotulo>
          <p className="mt-1 text-[8px] text-zinc-700">077 — Banco Inter</p>
          <p className="text-[8px] text-zinc-700">Ag. 0001 · Conta 12345-6</p>
        </div>
        <Botao cor="azul">+ Conectar conta</Botao>
        <p className="text-[7px] leading-snug text-zinc-500">
          O Kashim some da tela por algumas etapas. É normal.
        </p>
      </div>
    </Tela>
  ),

  'of-consentimento': () => (
    <Tela clara>
      <BarraNavegador url="banco.com.br" />
      <div className="space-y-1.5 p-2.5">
        <Titulo clara>Confirme os dados que serão compartilhados</Titulo>
        <Rotulo clara>Dados compartilhados</Rotulo>
        <div className="rounded-md border border-zinc-300 bg-white">
          {[
            ['Conta', true],
            ['Cartão de crédito', true],
            ['Investimentos', false],
            ['Cadastro', false],
            ['Operações de crédito', false],
          ].map(([nome, usado]) => (
            <div key={nome as string} className="flex items-center gap-1.5 border-b border-zinc-100 px-2 py-1 last:border-0">
              <i
                className={`fas ${usado ? 'fa-circle-check text-green-600' : 'fa-minus text-zinc-300'} text-[7px]`}
              />
              <span className={`text-[8px] ${usado ? 'font-bold text-zinc-800' : 'text-zinc-400'}`}>
                {nome}
              </span>
            </div>
          ))}
        </div>
        <p className="text-[7px] leading-snug text-zinc-600">
          <strong>Verde</strong> = o que o Kashim lê. O resto o banco oferece, mas não usamos.
        </p>
      </div>
    </Tela>
  ),

  'of-sucesso': () => (
    <Tela clara>
      <BarraNavegador url="api.pagamentobancario.com.br" />
      <div className="space-y-2 p-2.5 text-center">
        <p className="text-[13px] font-black text-zinc-800">100%</p>
        <div className="h-1 rounded-full bg-[#f47b20]" />
        <p className="text-[8px] font-bold text-zinc-700">Seus dados foram coletados com sucesso.</p>
        <div className="rounded-md border border-dashed border-zinc-400 bg-white px-2 py-1.5">
          <p className="font-mono text-[7px] text-zinc-500">a1b2c3d4-0000-0000</p>
          <p className="mt-0.5 text-[7px] font-bold text-zinc-600">Não precisa copiar</p>
        </div>
        <Botao cor="laranja">Fechar</Botao>
      </div>
    </Tela>
  ),

  'of-esperando': () => (
    <Tela clara>
      <div className="space-y-2 p-4 text-center">
        <i className="fas fa-clock text-lg text-[#7ab800]" />
        <p className="text-[9px] font-black text-zinc-800">Nenhuma transação a categorizar</p>
        <p className="text-[7px] leading-snug text-zinc-500">
          Quando o banco liberar os dados (pode levar até 24h), as transações aparecerão aqui.
        </p>
      </div>
    </Tela>
  ),

  'of-categorizar': () => (
    <Tela clara>
      <div className="border-b border-zinc-200 px-2 py-1.5">
        <Titulo clara>Banco Inter · Conta corrente</Titulo>
        <p className="text-[7px] font-bold text-[#f47b20]">3 transações a categorizar</p>
      </div>
      <Lancamento nome="Mercado Bom Preço" valor="R$ 245,90" etiqueta="Variável" />
      <Lancamento nome="Farmácia Central" valor="R$ 62,00" etiqueta="escolher categoria" />
      <Lancamento nome="Pagamento recebido" valor="+R$ 3.200,00" etiqueta="Renda" entrada />
      <p className="px-2 py-1.5 text-[7px] leading-snug text-zinc-500">
        Toque na etiqueta para trocar a categoria.
      </p>
    </Tela>
  ),

  'of-falhou': () => (
    <Tela clara>
      <BarraNavegador url="id.opf.seubanco.com.br" />
      <div className="space-y-2 p-3 text-center">
        <i className="fas fa-triangle-exclamation text-lg text-[#e8a33d]" />
        <p className="text-[9px] font-black text-zinc-800">
          Parece que você não tem o app do banco
        </p>
        <div className="rounded-md bg-zinc-200 py-1 text-[7px] font-bold text-zinc-600">
          baixar o app
        </div>
        <p className="text-[7px] leading-snug text-zinc-600">
          Você tem o app? Então não toque aqui. Copie o link e abra no Chrome ou Safari pela tela
          inicial do celular.
        </p>
      </div>
    </Tela>
  ),
};

const TourIlustracao: React.FC<{ id: TourIlustracaoId }> = ({ id }) => {
  const Desenho = DESENHOS[id];
  if (!Desenho) return null;
  return (
    <div className="mb-3" aria-hidden="true">
      <Desenho />
    </div>
  );
};

export default TourIlustracao;
