import Anthropic from '@anthropic-ai/sdk';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type ContentPart = Anthropic.ContentBlockParam;

function buildUserParts(userMessage?: string, imageData?: string, imageMimeType?: string): ContentPart[] {
  const parts: ContentPart[] = [];
  if (imageData) {
    const validMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
    type ValidMime = typeof validMimes[number];
    const mime: ValidMime = validMimes.includes(imageMimeType as ValidMime)
      ? (imageMimeType as ValidMime)
      : 'image/jpeg';
    parts.push({ type: 'image', source: { type: 'base64', media_type: mime, data: imageData } });
  }
  parts.push({
    type: 'text',
    text: userMessage || 'Analise este comprovante e identifique o valor total e o tipo de gasto.',
  });
  return parts;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { userMessage, imageData, imageMimeType, systemPrompt, availableItems } = req.body as {
      userMessage?: string;
      imageData?: string;
      imageMimeType?: string;
      systemPrompt: string;
      availableItems?: { id: string; description: string }[];
    };

    if (!userMessage && !imageData) {
      return res.status(400).json({ error: 'userMessage ou imageData obrigatório' });
    }

    const userParts = buildUserParts(userMessage, imageData, imageMimeType);

    // Roda as duas chamadas em paralelo para maximizar velocidade
    const [stetsResponse, extractResponse] = await Promise.all([

      // Chamada 1: Resposta natural do Stets (sem tools — foco total na qualidade da resposta)
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: 'user', content: userParts }],
      }),

      // Chamada 2: Extração forçada de gasto (tool_choice: any — Claude DEVE chamar a tool)
      // Usa índice numérico em vez de UUID para evitar alucinação de IDs
      availableItems?.length
        ? anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 256,
            system: 'Você é um extrator de despesas financeiras. Analise a mensagem ou imagem e extraia os dados de gasto usando a tool disponível.',
            messages: [{
              role: 'user',
              content: [
                ...userParts,
                {
                  type: 'text',
                  text: `Itens disponíveis (use o índice numérico): ${JSON.stringify(
                    availableItems.map((item, idx) => ({ idx, description: item.description }))
                  )}\n\nIdentifique se há um gasto com valor monetário claro. Se sim, extraia o itemIdx do item mais adequado (número inteiro 0-${availableItems.length - 1}), o valor e uma descrição curta. Se não houver gasto claro, defina hasExpense como false.`,
                },
              ],
            }],
            tools: [{
              name: 'extract_expense',
              description: 'Extrai dados de gasto da mensagem ou imagem. Deve ser chamada sempre — use hasExpense:false se não houver gasto.',
              input_schema: {
                type: 'object' as const,
                properties: {
                  hasExpense: {
                    type: 'boolean',
                    description: 'true se há um gasto com valor monetário claro, false caso contrário.',
                  },
                  itemIdx: {
                    type: 'number',
                    description: `Índice (0 a ${availableItems.length - 1}) do item da lista que melhor corresponde. -1 se não há gasto.`,
                  },
                  value: {
                    type: 'number',
                    description: 'Valor do gasto em reais (número). 0 se não há gasto.',
                  },
                  description: {
                    type: 'string',
                    description: 'Descrição curta do que foi comprado. String vazia se não há gasto.',
                  },
                  installments: {
                    type: 'number',
                    description: 'Número de parcelas. 1 se pagamento à vista. Ex: "em 3 vezes" → 3, "duas parcelas" → 2.',
                  },
                },
                required: ['hasExpense', 'itemIdx', 'value', 'description', 'installments'],
              },
            }],
            tool_choice: { type: 'any' }, // OBRIGA Claude a chamar a tool
          })
        : Promise.resolve(null),
    ]);

    // Extrai texto da chamada 1
    const text = stetsResponse.content
      .filter(b => b.type === 'text')
      .map(b => (b as Anthropic.TextBlock).text)
      .join('');

    // Extrai gasto da chamada 2 — mapeia índice de volta para o ID real
    let expense: { itemId: string; value: number; description: string; installments: number } | null = null;
    if (extractResponse && availableItems?.length) {
      const toolBlock = extractResponse.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined;
      if (toolBlock) {
        const input = toolBlock.input as {
          hasExpense: boolean;
          itemIdx: number;
          value: number;
          description: string;
          installments: number;
        };
        const idx = Math.round(input.itemIdx ?? -1);
        const matchedItem = availableItems[idx];
        if (input.hasExpense && matchedItem && input.value > 0) {
          expense = {
            itemId: matchedItem.id,
            value: input.value,
            description: input.description,
            installments: Math.max(1, Math.round(input.installments ?? 1)),
          };
        }
      }
    }

    return res.json({ text, expense });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno';
    return res.status(500).json({ error: message });
  }
}
