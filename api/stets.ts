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
    text: userMessage || 'Analise este comprovante ou extrato e identifique todas as despesas.',
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

      // Chamada 2: Extração forçada de TODAS as despesas (tool_choice: any)
      availableItems?.length
        ? anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 512,
            system: 'Você é um extrator de despesas financeiras. Analise a mensagem ou imagem e extraia TODAS as despesas encontradas usando a tool disponível. Se for um extrato bancário ou de cartão, liste cada transação individualmente.',
            messages: [{
              role: 'user',
              content: [
                ...userParts,
                {
                  type: 'text',
                  text: `Itens disponíveis (use o índice numérico): ${JSON.stringify(
                    availableItems.map((item, idx) => ({ idx, description: item.description }))
                  )}\n\nExtraia TODAS as despesas com valores monetários claros. Para cada uma, use o índice do item mais adequado (0-${availableItems.length - 1}) ou -1 se não houver correspondência. Retorne lista vazia se não há despesas.`,
                },
              ],
            }],
            tools: [{
              name: 'extract_expenses',
              description: 'Extrai TODAS as despesas encontradas na mensagem ou imagem. Retorna lista vazia se não há despesas.',
              input_schema: {
                type: 'object' as const,
                properties: {
                  expenses: {
                    type: 'array',
                    description: 'Lista de todas as despesas identificadas. Vazia se nenhuma.',
                    items: {
                      type: 'object',
                      properties: {
                        itemIdx: {
                          type: 'number',
                          description: `Índice (0 a ${availableItems.length - 1}) do item da lista. -1 se sem correspondência.`,
                        },
                        value: {
                          type: 'number',
                          description: 'Valor do gasto em reais.',
                        },
                        description: {
                          type: 'string',
                          description: 'Descrição curta do que foi comprado ou estabelecimento.',
                        },
                        installments: {
                          type: 'number',
                          description: 'Número de parcelas. 1 se pagamento à vista.',
                        },
                      },
                      required: ['itemIdx', 'value', 'description', 'installments'],
                    },
                  },
                },
                required: ['expenses'],
              },
            }],
            tool_choice: { type: 'any' },
          })
        : Promise.resolve(null),
    ]);

    // Extrai texto da chamada 1
    const text = stetsResponse.content
      .filter(b => b.type === 'text')
      .map(b => (b as Anthropic.TextBlock).text)
      .join('');

    // Extrai todas as despesas da chamada 2 — mapeia índices de volta para IDs reais
    const expenses: { itemId: string; value: number; description: string; installments: number }[] = [];
    if (extractResponse && availableItems?.length) {
      const toolBlock = extractResponse.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined;
      if (toolBlock) {
        const input = toolBlock.input as {
          expenses: { itemIdx: number; value: number; description: string; installments: number }[];
        };
        for (const exp of input.expenses ?? []) {
          if (exp.value > 0) {
            const idx = Math.round(exp.itemIdx ?? -1);
            const matchedItem = availableItems[idx];
            expenses.push({
              itemId: matchedItem ? matchedItem.id : '',
              value: exp.value,
              description: exp.description,
              installments: Math.max(1, Math.round(exp.installments ?? 1)),
            });
          }
        }
      }
    }

    return res.json({ text, expenses });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno';
    return res.status(500).json({ error: message });
  }
}
