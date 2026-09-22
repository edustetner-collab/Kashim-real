
import React, { useState, useEffect, useRef } from 'react';
import { FinanceItem, CategoryType } from '../types';
import { formatCurrency } from '../constants';
import ConfirmarMesLancamento, { precisaConfirmarMes } from './ConfirmarMesLancamento';

export interface DetectedExpense {
  itemId: string;
  value: number;
  description: string;
  installments: number;
  isCredit: boolean;
  category?: CategoryType;
  linkedCardId?: string;
  purchaseDate?: { day: number; month: number; year: number }; // month: 0-indexed (0=Jan)
}

interface ExpenseSheetProps {
  open: boolean;
  source: 'ai' | 'manual';
  items: FinanceItem[];
  initialItemId?: string;
  initialValue?: number;
  initialDescription?: string;
  initialInstallments?: number;
  initialCategory?: CategoryType;
  /** Categoria já decidida (conta fixa do extrato): abre na escolha da linha. */
  irDiretoParaLinha?: boolean;
  /** Parcela como o banco informou (ex.: 21/21). Só informa; não pergunta. */
  parcelaDoBanco?: { current: number; total: number } | null;
  /** Finais dos cartões que já vêm pelo Open Finance — gasto deles chega sozinho. */
  cartoesConectadosLast4?: string[];
  /** Há conta bancária conectada: débito e Pix dela também chegam sozinhos. */
  contaConectada?: boolean;
  /**
   * Forma de pagamento JA conhecida — vem do extrato bancario, onde a origem
   * nao e duvida: transacao de cartao foi no credito, de conta foi no debito.
   * Perguntar de novo era ruido, e o cliente reclamou com razao.
   */
  knownPayMethod?: 'debit' | 'credit';
  /** Ultimos 4 digitos do cartao — vindo do extrato, nao ha o que perguntar. */
  knownCardLast4?: string | null;
  defaultPurchaseDate?: { day: number; month: number; year: number };
  onConfirm: (data: DetectedExpense) => void;
  onClose: () => void;
  onCreateItem?: (description: string, category: CategoryType, isOneTime?: boolean) => string;
  /** Atalhos de entrada no topo da escolha de categoria. */
  onAbrirCamera?: () => void;
  onAbrirGaleria?: () => void;
  onAbrirVoz?: () => void;
  /** Abre o Stets com a pergunta já digitada. */
  onPerguntarStets?: (pergunta: string) => void;
}

type Step = 'category' | 'variable-entry' | 'item-picker' | 'value-payment';
type PayMethod = '' | 'debit' | 'credit';
type CreditType = '' | 'avista' | 'parcelado';

const CATEGORIES = [
  {
    type: CategoryType.VARIABLE_EXPENSE,
    label: 'Gasto Variável',
    sub: 'Um imprevisto, algo que aconteceu de repente',
    icon: 'fa-bolt',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10 border-blue-500/30',
  },
  {
    type: CategoryType.PERSONAL_LEISURE,
    label: 'Lazer & Pessoal',
    sub: 'Restaurante, viagem, cinema, presentes...',
    icon: 'fa-cocktail',
    color: 'text-pink-400',
    bg: 'bg-pink-500/10 border-pink-500/30',
  },
  {
    type: CategoryType.FIXED_EXPENSE,
    label: 'Conta Fixa',
    sub: 'Algo que você já paga todo mês (mercado, gasolina, aluguel...)',
    icon: 'fa-anchor',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10 border-purple-500/30',
  },
];

function catStyle(cat: CategoryType) {
  if (cat === CategoryType.VARIABLE_EXPENSE) return { icon: 'fa-bolt', color: 'text-blue-400' };
  if (cat === CategoryType.PERSONAL_LEISURE) return { icon: 'fa-cocktail', color: 'text-pink-400' };
  return { icon: 'fa-anchor', color: 'text-purple-400' };
}

const MONTHS_BR_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

const ExpenseSheet: React.FC<ExpenseSheetProps> = ({
  open, source, items,
  initialItemId, initialValue, initialDescription, initialInstallments,
  initialCategory,
  irDiretoParaLinha,
  parcelaDoBanco,
  cartoesConectadosLast4,
  contaConectada,
  knownPayMethod,
  knownCardLast4,
  defaultPurchaseDate,
  onConfirm, onClose, onCreateItem,
  onAbrirCamera, onAbrirGaleria, onAbrirVoz, onPerguntarStets,
}) => {
  const [step, setStep] = useState<Step>('category');
  const [category, setCategory] = useState<CategoryType | null>(null);
  const [itemId, setItemId] = useState('');
  const [variableDesc, setVariableDesc] = useState('');
  const [search, setSearch] = useState('');
  const [value, setValue] = useState('');
  const [payMethod, setPayMethod] = useState<PayMethod>('');
  const [creditType, setCreditType] = useState<CreditType>('');
  const [installCount, setInstallCount] = useState('');
  const [expenseDesc, setExpenseDesc] = useState('');
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState('');
  const [purchaseDay, setPurchaseDay] = useState(() => defaultPurchaseDate?.day ?? new Date().getDate());
  const [purchaseMonth, setPurchaseMonth] = useState(() => defaultPurchaseDate?.month ?? new Date().getMonth());
  const [purchaseYear, setPurchaseYear] = useState(() => defaultPurchaseDate?.year ?? new Date().getFullYear());

  const valueRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const ref = defaultPurchaseDate ?? { day: new Date().getDate(), month: new Date().getMonth(), year: new Date().getFullYear() };
    setPurchaseDay(ref.day);
    setPurchaseMonth(ref.month);
    setPurchaseYear(ref.year);
    setSearch('');
    setShowItemPicker(false);
    if (source === 'ai') {
      setStep('value-payment');
      setCategory(null);
      setItemId(initialItemId ?? '');
      setVariableDesc(initialDescription ?? '');
      setExpenseDesc(initialDescription ?? '');
      setValue(initialValue ? String(initialValue) : '');
      const init = Math.max(1, initialInstallments ?? 1);
      if (init > 1) { setPayMethod('credit'); setCreditType('parcelado'); setInstallCount(String(init)); }
      else { setPayMethod(''); setCreditType(''); setInstallCount(''); }
      // Pre-select card if item already has one linked
      const matchedItem = items.find(i => i.id === (initialItemId ?? ''));
      setSelectedCardId(matchedItem?.linkedCardId ?? '');
    } else {
      const precat = initialCategory ?? null;
      // Sugestao do Open Finance NUNCA pula a escolha de categoria. Antes,
      // "Variavel" caia direto em `variable-entry` e o cliente so podia
      // confirmar — sem caminho para dizer que na verdade era Fixa ou Lazer.
      // Fixa nao tinha o problema porque ja parava em `category`.
      if (precat === CategoryType.VARIABLE_EXPENSE && source !== 'manual') {
        setStep('variable-entry');
        setCategory(CategoryType.VARIABLE_EXPENSE);
      } else if (precat && irDiretoParaLinha) {
        // Confirmado no extrato como conta fixa, mas sem linha conhecida:
        // a pergunta é só "qual conta?". Voltar leva à categoria, se mudar de ideia.
        setStep('item-picker');
        setCategory(precat);
      } else {
        setStep('category');
        setCategory(precat);
      }
      setItemId('');
      setVariableDesc(initialDescription ?? '');
      setValue(initialValue ? String(initialValue) : '');
      setPayMethod(knownPayMethod ?? '');
      // Parcelamento vem do extrato: 3/10 é parcelado, sem precisar perguntar.
      const parcelasConhecidas = Math.max(1, initialInstallments ?? 1);
      setCreditType(knownPayMethod ? (parcelasConhecidas > 1 ? 'parcelado' : 'avista') : '');
      // Cartao tambem: se o extrato disse quais os 4 digitos, acha o item
      // correspondente no plano em vez de pedir para o cliente escolher.
      const cardDoExtrato = knownCardLast4
        ? items.find((i) => i.category === CategoryType.CREDIT_CARD && (i.description ?? '').includes(knownCardLast4))
        : null;
      if (cardDoExtrato) setSelectedCardId(cardDoExtrato.id);
      setSelectedCardId('');
      setExpenseDesc(initialDescription ?? '');
      const initManual = Math.max(1, initialInstallments ?? 1);
      setInstallCount(initManual > 1 ? String(initManual) : '');
    }
  }, [open, source, initialItemId, initialValue, initialDescription, initialInstallments, initialCategory, irDiretoParaLinha, defaultPurchaseDate, knownPayMethod, knownCardLast4]);

  useEffect(() => {
    if (step === 'value-payment' && open && !showItemPicker) {
      setTimeout(() => valueRef.current?.focus(), 200);
    }
  }, [step, open, showItemPicker]);

  const selectedItem = items.find(i => i.id === itemId);
  const numericValue = parseFloat(value.replace(',', '.')) || 0;
  const installments = Math.max(2, parseInt(installCount) || 2);
  const isCredit = payMethod === 'credit';
  // Parcelamento agora vale para DÉBITO também (ex.: semijoias 3x no débito),
  // não só crédito — pedido do Eduardo 2026-07-XX.
  const isParcelado = creditType === 'parcelado';

  // Campo "Descrição da despesa": aparece quando veio da IA (voz/foto) OU é
  // Lazer. Serve para o usuário nomear o lançamento (ex.: "camisetas") mantendo
  // a categoria — esse texto vira o rótulo do gasto em Gastos Frequentes.
  // Vindo do Extrato (`knownPayMethod`) o campo vira "Nome do estabelecimento":
  // quem recategoriza também corrige o nome (Eduardo, 2026-09-22).
  const showDescField = source === 'ai' || category === CategoryType.PERSONAL_LEISURE || !!knownPayMethod;
  const hasItem = !!itemId || (category === CategoryType.VARIABLE_EXPENSE && variableDesc.trim().length > 0);
  // Exigir cartao escolhido SO quando o seletor esta visivel. Com o extrato
  // informando o cartao, o seletor fica escondido — e se a pre-selecao nao
  // achasse o item correspondente no plano, o botao "Lançar" morria sem nada
  // na tela dizendo o porque. Vincular ao cartao e um detalhe; travar o
  // lancamento por causa dele nao se justifica.
  const needsCard = isCredit
    && !knownCardLast4
    && items.filter(i => i.category === CategoryType.CREDIT_CARD).length > 0;
  /**
   * Gasto que JÁ vem do banco não precisa ser lançado à mão.
   *
   * Lançar de novo conta o mesmo dinheiro duas vezes: uma no lançamento, outra
   * quando a transação chega no Extrato e é categorizada. Marcando como débito,
   * o estrago é maior — o valor entra como saída da conta e a fatura do banco
   * já o contém (Eduardo, 2026-09-17).
   *
   * O aviso só aparece onde o risco existe: cartão CONECTADO, ou débito/Pix com
   * conta conectada. Cartão de fora do app e dinheiro em espécie passam direto,
   * porque para eles lançar à mão é o caminho certo.
   */
  const [avisoDispensado, setAvisoDispensado] = useState(false);
  useEffect(() => { setAvisoDispensado(false); }, [open, payMethod, selectedCardId]);

  const cartaoEscolhido = items.find(i => i.id === selectedCardId);
  const cartaoEhConectado = !!(cartoesConectadosLast4 ?? []).find(
    (l4) => l4 && (cartaoEscolhido?.description ?? '').includes(l4),
  );
  const avisoChegaDoBanco = !knownPayMethod && !avisoDispensado && (
    (payMethod === 'credit' && cartaoEhConectado) ||
    (payMethod === 'debit' && !!contaConectada)
  );

  const canConfirm = hasItem && numericValue > 0 && payMethod !== '' && (!needsCard || !!selectedCardId) && !avisoChegaDoBanco;

  const pickerItems = items.filter(i => {
    if (i.category === CategoryType.INCOME || i.category === CategoryType.CREDIT_CARD) return false;
    if (source === 'manual' && category && i.category !== category) return false;
    if (!search) return true;
    return i.description.toLowerCase().includes(search.toLowerCase());
  });

  const variableSuggestions = variableDesc.length > 1
    ? items.filter(i =>
        i.category === CategoryType.VARIABLE_EXPENSE &&
        i.description.toLowerCase().includes(variableDesc.toLowerCase())
      )
    : [];

  const [confirmarMes, setConfirmarMes] = useState(false);


  const handleConfirmClick = () => {
    if (!canConfirm) return;
    // Lançamento à mão fora do mês atual pede confirmação no app. Os que vêm do
    // extrato (forma de pagamento já conhecida) têm a data do banco — não pergunta.
    if (!knownPayMethod && precisaConfirmarMes(purchaseYear, purchaseMonth)) {
      setConfirmarMes(true);
      return;
    }
    efetivarLancamento();
  };

  const efetivarLancamento = (dataHoje?: { day: number; month: number; year: number }) => {
    setConfirmarMes(false);

    let finalItemId = itemId;
    // Vindo do Extrato (`knownPayMethod`), o nome do lugar foi confirmado pelo
    // cliente na pergunta anterior e vale para qualquer categoria. Antes, conta
    // fixa gravava o nome da linha e "Sabesp" se perdia (Eduardo, 2026-09-22).
    let finalDesc = ((showDescField || knownPayMethod) && expenseDesc.trim())
      ? expenseDesc.trim()
      : (selectedItem?.description ?? variableDesc.trim());

    if (!itemId && category === CategoryType.VARIABLE_EXPENSE && variableDesc.trim() && onCreateItem) {
      const isOneTime = !isParcelado && !isCredit;
      finalItemId = onCreateItem(variableDesc.trim(), CategoryType.VARIABLE_EXPENSE, isOneTime);
      finalDesc = variableDesc.trim();
    }
    if (!finalItemId) return;

    onConfirm({
      itemId: finalItemId,
      value: numericValue,
      description: finalDesc,
      installments: isParcelado ? installments : 1,
      isCredit,
      category: category ?? selectedItem?.category,
      linkedCardId: isCredit && selectedCardId ? selectedCardId : undefined,
      purchaseDate: dataHoje ?? { day: purchaseDay, month: purchaseMonth, year: purchaseYear },
    });
  };

  if (!open) return null;

  const isPickerVisible = showItemPicker || (source === 'manual' && step === 'item-picker');

  const creditCards = items.filter(i => i.category === CategoryType.CREDIT_CARD);

  const renderValuePayment = () => (
    <div className="space-y-4">
      {/* Item badge / selector */}
      <button
        onClick={() => { setSearch(''); source === 'ai' ? setShowItemPicker(true) : (category === CategoryType.VARIABLE_EXPENSE ? setStep('variable-entry') : setStep('item-picker')); }}
        className="flex items-center gap-2.5 px-3 py-2 bg-zinc-800 rounded-xl border border-zinc-700 active:scale-95 max-w-full"
      >
        {selectedItem && (() => { const { icon, color } = catStyle(selectedItem.category); return <i className={`fas ${icon} ${color} text-xs shrink-0`} />; })()}
        <span className="text-zinc-200 text-xs font-bold truncate flex-1">
          {selectedItem?.description || variableDesc || 'Selecionar item...'}
        </span>
        <i className="fas fa-pen text-zinc-600 text-[9px] shrink-0" />
      </button>

      {/* Descrição da despesa — editável (ex.: "camisetas"). Vira o rótulo do
          lançamento em Gastos Frequentes, mantendo a categoria (ex.: Lazer).
          Aparece pra despesas da IA (voz/foto) e pra Lazer. */}
      {showDescField && (
        <div className="px-4 py-3 bg-zinc-800 rounded-2xl border border-zinc-700 focus-within:border-green-400/40 transition-colors">
          <p className="text-[9px] text-zinc-500 uppercase font-black tracking-wider mb-1">
            {knownPayMethod ? 'Nome do estabelecimento' : 'Descrição da despesa'}
          </p>
          <input
            type="text"
            value={expenseDesc}
            onChange={e => setExpenseDesc(e.target.value)}
            placeholder="Ex: camisetas, tênis, presente..."
            className="w-full bg-transparent text-white text-sm font-medium outline-none placeholder:text-zinc-600"
          />
        </div>
      )}

      {/* Value */}
      <div className={`px-4 py-3 rounded-2xl border transition-colors ${knownPayMethod ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-zinc-800 border-zinc-700 focus-within:border-green-400/40'}`}>
        <div className="flex items-center justify-between mb-1">
          <p className="text-[9px] text-zinc-500 uppercase font-black tracking-wider">Valor</p>
          {knownPayMethod && <span className="text-[9px] text-zinc-600 font-bold">do banco · não editável</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 font-mono text-sm">R$</span>
          <input
            ref={valueRef}
            type="number"
            inputMode="decimal"
            step="0.01"
            value={value}
            onChange={e => { if (!knownPayMethod) setValue(e.target.value); }}
            readOnly={!!knownPayMethod}
            className={`flex-1 bg-transparent text-2xl font-black font-mono outline-none ${knownPayMethod ? 'text-zinc-500 cursor-default' : 'text-white'}`}
            placeholder="0,00"
          />
        </div>
        {/* Só no lançamento à mão: com o extrato, quem conta a história das
            parcelas é o bloco "como foi pago", com o número real (3/10). */}
        {isParcelado && !knownPayMethod && numericValue > 0 && installments > 1 && (
          <p className="text-zinc-500 text-[10px] mt-1 font-mono">
            {installments}x de {formatCurrency(numericValue)} · total {formatCurrency(numericValue * installments)}
          </p>
        )}
        {isParcelado && !knownPayMethod && (
          <p className="text-zinc-600 text-[9px] mt-0.5">Digite o valor de UMA parcela</p>
        )}
      </div>

      {/* Purchase date */}
      <div className="px-4 py-3 bg-zinc-800 rounded-2xl border border-zinc-700">
        <p className="text-[9px] text-zinc-500 uppercase font-black tracking-wider mb-2">Data da compra</p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            value={purchaseDay}
            onChange={e => setPurchaseDay(Math.max(1, Math.min(31, parseInt(e.target.value) || 1)))}
            className="w-12 bg-zinc-900 rounded-xl px-2 py-1.5 text-white text-sm font-black text-center outline-none border border-zinc-700 focus:border-green-400/50"
            placeholder="DD"
          />
          <span className="text-zinc-600 text-sm font-bold">/</span>
          <select
            value={purchaseMonth}
            onChange={e => setPurchaseMonth(parseInt(e.target.value))}
            className="bg-zinc-900 rounded-xl px-2 py-1.5 text-white text-sm font-black outline-none border border-zinc-700 focus:border-green-400/50"
          >
            {MONTHS_BR_SHORT.map((m, i) => (
              <option key={i} value={i}>{m}</option>
            ))}
          </select>
          <span className="text-zinc-600 text-sm font-bold">/</span>
          <input
            type="number"
            inputMode="numeric"
            min={2020}
            max={2099}
            value={purchaseYear}
            onChange={e => setPurchaseYear(parseInt(e.target.value) || new Date().getFullYear())}
            className="w-20 bg-zinc-900 rounded-xl px-2 py-1.5 text-white text-sm font-black text-center outline-none border border-zinc-700 focus:border-green-400/50"
            placeholder="AAAA"
          />
        </div>
        {(purchaseMonth !== new Date().getMonth() || purchaseYear !== new Date().getFullYear()) && (
          <p className="text-amber-400 text-[10px] mt-2 font-bold">
            <i className="fas fa-history mr-1" />
            Lançamento retroativo — registrando em {MONTHS_BR_SHORT[purchaseMonth]}/{purchaseYear}
          </p>
        )}
      </div>

      {/* Forma de pagamento — escondida quando o extrato ja disse qual foi. */}
      <div data-tour="sheet-payment" className={knownPayMethod ? 'hidden' : ''}>
        <p className="text-[9px] text-zinc-500 uppercase font-black tracking-wider mb-2">Como foi pago?</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => { setPayMethod('debit'); if (!creditType) setCreditType('avista'); }}
            className={`py-3 rounded-2xl text-sm font-black transition-all active:scale-95 border ${payMethod === 'debit' ? 'bg-zinc-100 text-black border-zinc-100' : 'bg-zinc-800 text-zinc-400 border-zinc-700'}`}
          >
            <i className="fas fa-money-bill-wave mr-2 text-xs" />
            Débito / Pix
          </button>
          <button
            onClick={() => { setPayMethod('credit'); if (!creditType) setCreditType('avista'); }}
            className={`py-3 rounded-2xl text-sm font-black transition-all active:scale-95 border ${payMethod === 'credit' ? 'bg-green-400 text-black border-green-400' : 'bg-zinc-800 text-zinc-400 border-zinc-700'}`}
          >
            <i className="fas fa-credit-card mr-2 text-xs" />
            Crédito
          </button>
        </div>
      </div>

      {/* Card picker — required when credit is selected */}
      {isCredit && creditCards.length > 0 && !knownCardLast4 && (
        <div data-tour="sheet-card">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[9px] text-zinc-500 uppercase font-black tracking-wider">Em qual cartão?</p>
            {!selectedCardId && (
              <span className="text-[9px] text-amber-400 font-black uppercase tracking-wide">
                <i className="fas fa-exclamation-circle mr-0.5" />obrigatório
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {creditCards.map(card => (
              <button
                key={card.id}
                onClick={() => setSelectedCardId(prev => prev === card.id ? '' : card.id)}
                className={`px-3 py-2 rounded-xl text-xs font-black transition-all active:scale-95 border ${
                  selectedCardId === card.id
                    ? 'bg-green-400/20 text-green-300 border-green-400/40'
                    : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                }`}
              >
                {card.description}
              </button>
            ))}
          </div>
        </div>
      )}

      {avisoChegaDoBanco && (
        <div className="px-4 py-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col gap-3">
          <div className="flex items-start gap-2.5">
            <i className="fas fa-circle-info text-amber-400 text-sm mt-0.5" />
            <p className="text-amber-200/90 text-[13px] leading-snug">
              {payMethod === 'credit' ? (
                <>As compras deste cartão <b>chegam sozinhas do seu banco</b> e aparecem no Extrato para você categorizar. Lançando agora, esse gasto pode ficar contado duas vezes.</>
              ) : (
                <>Se foi pago pela conta do banco conectado, esse gasto <b>chega sozinho</b> e aparece no Extrato. Lançando agora, ele pode ficar contado duas vezes. Se foi dinheiro em espécie, pode lançar.</>
              )}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onClose}
              className="py-2.5 rounded-xl bg-amber-400 text-black text-[12px] font-black active:scale-95"
            >
              Deixa chegar do banco
            </button>
            <button
              onClick={() => setAvisoDispensado(true)}
              className="py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300 text-[12px] font-black active:scale-95"
            >
              {payMethod === 'credit' ? 'Lançar mesmo assim' : 'Foi dinheiro, lançar'}
            </button>
          </div>
        </div>
      )}

      {/* À vista ou parcelado — NUNCA aparece quando o lançamento veio do
          extrato. O banco já disse como foi pago e em quantas vezes; perguntar
          de novo só dava chance de contradizer o extrato. Na 21/21 do Michael
          faltava uma parcela e a pergunta voltava, oferecendo parcelar de novo
          uma compra que está acabando (2026-09-17). */}
      {payMethod !== '' && !knownPayMethod && (
        <div data-tour="sheet-credit-type">
          <p className="text-[9px] text-zinc-500 uppercase font-black tracking-wider mb-2">À vista ou parcelado?</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => { setCreditType('avista'); setInstallCount(''); }}
              className={`py-2.5 rounded-2xl text-sm font-black transition-all active:scale-95 border ${creditType === 'avista' ? 'bg-green-400/20 text-green-300 border-green-400/40' : 'bg-zinc-800 text-zinc-500 border-zinc-700'}`}
            >
              À vista
            </button>
            <button
              onClick={() => setCreditType('parcelado')}
              className={`py-2.5 rounded-2xl text-sm font-black transition-all active:scale-95 border ${creditType === 'parcelado' ? 'bg-green-400/20 text-green-300 border-green-400/40' : 'bg-zinc-800 text-zinc-500 border-zinc-700'}`}
            >
              Parcelado
            </button>
          </div>
        </div>
      )}

      {/* Em quantas vezes — idem: só para lançamento digitado à mão. */}
      {isParcelado && !knownPayMethod && (
        <div>
          <p className="text-[9px] text-zinc-500 uppercase font-black tracking-wider mb-2">Em quantas vezes?</p>
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {[2,3,4,5,6,7,8,9,10,11,12,15,18,21,24].map(n => (
              <button
                key={n}
                onClick={() => setInstallCount(String(n))}
                className={`shrink-0 w-11 h-11 rounded-xl font-black text-sm transition-all active:scale-95 border ${
                  parseInt(installCount) === n
                    ? 'bg-green-400 text-black border-green-400'
                    : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                }`}
              >
                {n}x
              </button>
            ))}
          </div>
          {numericValue > 0 && parseInt(installCount) >= 2 && (
            <p className="text-zinc-500 text-[10px] mt-1.5 font-mono">
              {parseInt(installCount)}x de {formatCurrency(numericValue)} · total {formatCurrency(numericValue * parseInt(installCount))}
            </p>
          )}
        </div>
      )}
      {/* Como foi pago, em texto: o extrato é a fonte, e o cliente só precisa
          saber o que vai ser lançado. Vale também para a compra à vista e para
          a última parcela, que antes caíam na pergunta. */}
      {!!knownPayMethod && (
        <div className="px-4 py-3 bg-zinc-800/50 rounded-2xl border border-zinc-700/50">
          <p className="text-[9px] text-zinc-500 uppercase font-black tracking-wider mb-1">Como foi pago (informado pelo banco)</p>
          {parcelaDoBanco ? (
            <>
              <p className="text-zinc-400 text-sm font-black k-num">
                Parcela {parcelaDoBanco.current} de {parcelaDoBanco.total} · {formatCurrency(numericValue)}
              </p>
              <p className="text-zinc-600 text-[9px] mt-0.5">
                {(initialInstallments ?? 1) > 1
                  ? `Lança esta e as ${(initialInstallments ?? 1) - 1} parcelas que faltam, na linha que você escolher.`
                  : 'Última parcela — lança só esta.'}
              </p>
            </>
          ) : (
            <>
              <p className="text-zinc-400 text-sm font-black k-num">
                {knownPayMethod === 'credit' ? 'Crédito à vista' : 'Débito'} · {formatCurrency(numericValue)}
              </p>
              <p className="text-zinc-600 text-[9px] mt-0.5">Não editável — veio do extrato bancário</p>
            </>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        <button onClick={onClose} className="flex-1 py-3.5 rounded-2xl bg-zinc-800 text-zinc-400 font-black text-sm active:scale-95">
          CANCELAR
        </button>
        <button
          data-tour="sheet-confirm"
          onClick={handleConfirmClick}
          disabled={!canConfirm}
          className={`flex-[2] py-3.5 rounded-2xl font-black text-sm transition-all ${canConfirm ? 'bg-green-400 text-black active:scale-95' : 'bg-zinc-800 text-zinc-600'}`}
        >
          {source === 'ai' ? 'CONFIRMAR' : 'LANÇAR'}
        </button>
      </div>
    </div>
  );

  /**
   * Criar a linha pelo próprio seletor.
   *
   * Sem isto, quem ainda não tinha nenhuma linha de Lazer (ou de Conta Fixa)
   * digitava "Semijoias", via "Nenhum item encontrado" e ficava preso — não
   * havia como lançar o gasto (Giane, 2026-09-17). Agora o nome digitado vira
   * a linha na categoria escolhida e o fluxo segue para valor e pagamento.
   */
  const nomeNovo = search.trim();
  const podeCriar = source === 'manual' && !!category && !!onCreateItem && nomeNovo.length > 0
    && !pickerItems.some(i => i.description.trim().toLowerCase() === nomeNovo.toLowerCase());
  const criarLinha = () => {
    if (!podeCriar || !category || !onCreateItem) return;
    const novoId = onCreateItem(nomeNovo, category);
    setItemId(novoId);
    setExpenseDesc(prev => prev || nomeNovo);
    setSearch('');
    setStep('value-payment');
  };

  const renderPicker = () => (
    <div className="space-y-3">
      <p className="text-white font-black text-sm uppercase tracking-wider">
        {source === 'ai' ? 'Trocar item' : 'Qual item?'}
      </p>
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={source === 'manual' && category ? 'Buscar ou digitar um nome novo...' : 'Buscar...'}
        onKeyDown={e => { if (e.key === 'Enter' && podeCriar && pickerItems.length === 0) criarLinha(); }}
        autoFocus
        className="w-full px-4 py-2.5 bg-zinc-800 rounded-2xl border border-zinc-700 text-white text-sm outline-none focus:border-green-400/50 placeholder:text-zinc-600"
      />
      <div className="space-y-1 max-h-52 overflow-y-auto">
        {pickerItems.map(item => {
          const { icon, color } = catStyle(item.category);
          return (
            <button
              key={item.id}
              onClick={() => { setItemId(item.id); setSearch(''); source === 'ai' ? setShowItemPicker(false) : setStep('value-payment'); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left active:scale-[0.98] ${itemId === item.id ? 'bg-green-400/15 border border-green-400/30' : 'bg-zinc-800/50 border border-transparent'}`}
            >
              <i className={`fas ${icon} ${color} text-xs w-4 text-center shrink-0`} />
              <span className="text-white text-sm">{item.description}</span>
              {itemId === item.id && <i className="fas fa-check text-green-400 text-xs ml-auto" />}
            </button>
          );
        })}
        {podeCriar && (
          <button
            onClick={criarLinha}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left active:scale-[0.98] bg-green-400/10 border border-green-400/30"
          >
            <i className="fas fa-plus text-green-400 text-xs w-4 text-center shrink-0" />
            <span className="text-white text-sm">Criar "<b>{nomeNovo}</b>"</span>
          </button>
        )}
        {pickerItems.length === 0 && !podeCriar && (
          <p className="text-zinc-600 text-sm text-center py-8">
            {source === 'manual' && category && onCreateItem ? 'Digite o nome do gasto para criar' : 'Nenhum item encontrado'}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center">
      {confirmarMes && (
        <ConfirmarMesLancamento
          ano={purchaseYear}
          mes={purchaseMonth}
          onMesAtual={() => {
            const hoje = new Date();
            efetivarLancamento({ day: hoje.getDate(), month: hoje.getMonth(), year: hoje.getFullYear() });
          }}
          onManter={() => efetivarLancamento()}
          onFechar={() => setConfirmarMes(false)}
        />
      )}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      {/* `pb-20` no celular: a barra de baixo agora fica POR CIMA das folhas
          (ela é fixa em qualquer tela), e sem esse respiro os botões da folha
          ficavam escondidos atrás dela (Eduardo, 2026-09-20). */}
      <div className="relative w-full max-w-lg bg-[#111] rounded-t-3xl border-t border-zinc-800 shadow-2xl animate-in slide-in-from-bottom duration-300 pb-20 lg:pb-0">
        <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mt-3 mb-1" />
        <div className="px-5 pb-10 pt-2">

          {/* Back button */}
          {(isPickerVisible || (source === 'manual' && step !== 'category')) && (
            <button
              onClick={() => {
                setSearch('');
                if (showItemPicker) { setShowItemPicker(false); return; }
                if (step === 'variable-entry') {
                  // Voltar sobe uma etapa, sempre. Fechar a tela deixava o
                  // cliente preso na categoria que o app escolheu por ele.
                  setStep('category');
                } else if (step === 'item-picker') {
                  setStep('category');
                } else if (step === 'value-payment') {
                  if (category === CategoryType.VARIABLE_EXPENSE) setStep('variable-entry');
                  else setStep('item-picker');
                }
              }}
              className="flex items-center gap-2 text-zinc-500 active:text-zinc-300 py-2 mb-2"
            >
              <i className="fas fa-chevron-left text-xs" />
              <span className="text-xs font-black uppercase tracking-wider">Voltar</span>
            </button>
          )}

          {/* CATEGORY */}
          {step === 'category' && source === 'manual' && (
            <div className="space-y-3" data-tour="sheet-categories">
              {/* Atalhos de entrada antes da escolha de categoria: quem tem o
                  comprovante na mão não deveria precisar decidir a categoria
                  primeiro — a foto ou a voz já dizem o que foi o gasto. */}
              {(onAbrirCamera || onAbrirGaleria || onAbrirVoz) && (
                <div className="flex gap-2 pt-1">
                  {onAbrirCamera && (
                    <button
                      onClick={onAbrirCamera}
                      className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-2xl bg-white/5 border border-white/10 active:bg-white/10 transition-colors"
                    >
                      <i className="fas fa-camera text-[#a2d800] text-base" />
                      <span className="text-zinc-400 text-[10px] font-bold">Foto</span>
                    </button>
                  )}
                  {onAbrirGaleria && (
                    <button
                      onClick={onAbrirGaleria}
                      className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-2xl bg-white/5 border border-white/10 active:bg-white/10 transition-colors"
                    >
                      <i className="fas fa-image text-[#a2d800] text-base" />
                      <span className="text-zinc-400 text-[10px] font-bold">Anexar</span>
                    </button>
                  )}
                  {onAbrirVoz && (
                    <button
                      onClick={onAbrirVoz}
                      className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-2xl bg-white/5 border border-white/10 active:bg-white/10 transition-colors"
                    >
                      <i className="fas fa-microphone text-[#a2d800] text-base" />
                      <span className="text-zinc-400 text-[10px] font-bold">Falar</span>
                    </button>
                  )}
                </div>
              )}

              {/* A dúvida de categoria nasce AQUI, na hora de escolher — é o
                  único lugar onde esse convite não é ruído. */}
              {onPerguntarStets && (
                <button
                  onClick={() => onPerguntarStets(
                    'Não sei em qual categoria lançar um gasto. Pode me ajudar a decidir se é conta fixa, conta variável ou gasto pessoal e lazer?',
                  )}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-2xl bg-[#7ab800]/10 border border-[#7ab800]/30 active:bg-[#7ab800]/15 transition-colors"
                >
                  <span className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: 'linear-gradient(180deg,#c5f23a 0%,#a2d800 50%,#8cc400 100%)' }}>
                    <i className="fas fa-bolt text-[#182200] text-[10px]" />
                  </span>
                  <span className="flex-1 text-left text-[#a2d800] text-[11px] font-bold leading-tight">
                    Não sabe a categoria do seu gasto? Pergunte ao Stets
                  </span>
                  <i className="fas fa-chevron-right text-[#a2d800] text-[10px] shrink-0" />
                </button>
              )}

              <p className="text-white font-black text-base uppercase tracking-wider py-2">Qual tipo de despesa?</p>
              {CATEGORIES.map(cat => (
                <button
                  key={cat.type}
                  onClick={() => {
                    setCategory(cat.type);
                    setItemId('');
                    setStep(cat.type === CategoryType.VARIABLE_EXPENSE ? 'variable-entry' : 'item-picker');
                  }}
                  className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl border ${cat.bg} active:scale-[0.98] transition-all`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${cat.bg}`}>
                    <i className={`fas ${cat.icon} ${cat.color} text-base`} />
                  </div>
                  <div className="text-left flex-1">
                    <p className={`font-black text-sm uppercase tracking-wider ${cat.color}`}>{cat.label}</p>
                    <p className="text-zinc-500 text-[10px] mt-0.5">{cat.sub}</p>
                  </div>
                  <i className="fas fa-chevron-right text-zinc-600 text-xs" />
                </button>
              ))}
            </div>
          )}

          {/* VARIABLE ENTRY */}
          {step === 'variable-entry' && (
            <div className="space-y-4">
              <p className="text-white font-black text-sm uppercase tracking-wider">O que aconteceu?</p>
              <input
                type="text"
                value={variableDesc}
                onChange={e => { setVariableDesc(e.target.value); setItemId(''); }}
                placeholder="Ex: bateria do carro, conserto, médico..."
                autoFocus
                className="w-full px-4 py-3 bg-zinc-800 rounded-2xl border border-zinc-700 text-white text-sm outline-none focus:border-green-400/50 placeholder:text-zinc-600"
              />
              {variableSuggestions.length > 0 && (
                <div className="space-y-1">
                  <p className="text-zinc-600 text-[10px] uppercase font-black tracking-wider">Já lançado antes</p>
                  {variableSuggestions.map(i => (
                    <button
                      key={i.id}
                      onClick={() => { setItemId(i.id); setVariableDesc(i.description); setStep('value-payment'); }}
                      className="w-full text-left px-4 py-2.5 bg-zinc-800/60 rounded-xl text-white text-sm active:scale-[0.98] border border-zinc-700"
                    >
                      {i.description}
                    </button>
                  ))}
                </div>
              )}
              {variableDesc.trim().length > 1 && (
                <button
                  onClick={() => setStep('value-payment')}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-blue-500/10 border border-blue-500/30 active:scale-[0.98]"
                >
                  <i className="fas fa-plus-circle text-blue-400 text-sm" />
                  <span className="text-blue-400 font-black text-sm">
                    {variableSuggestions.some(i => i.description.toLowerCase() === variableDesc.toLowerCase().trim()) ? `Usar: "${variableDesc.trim()}"` : `Criar: "${variableDesc.trim()}"`}
                  </span>
                </button>
              )}
              <p className="text-zinc-600 text-xs text-center pb-1">
                Não precisa existir na lista — pode ser qualquer imprevisto
              </p>
            </div>
          )}

          {/* ITEM PICKER (fixed/leisure) or AI item change */}
          {isPickerVisible && renderPicker()}

          {/* VALUE + PAYMENT */}
          {step === 'value-payment' && !isPickerVisible && renderValuePayment()}

        </div>
      </div>
    </div>
  );
};

export default ExpenseSheet;
