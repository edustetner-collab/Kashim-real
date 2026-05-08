import Anthropic from '@anthropic-ai/sdk';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

    const tools: Anthropic.Tool[] = availableItems?.length
      ? [{
          name: 'register_expense',
          description: 'Registra um gasto quando o usuário menciona claramente ter gasto dinheiro em algo.',
          input_schema: {
            type: 'object' as const,
            properties: {
              itemId: {
                type: 'string',
                description: `ID do item da lista que melhor corresponde ao gasto. Itens disponíveis: ${JSON.stringify(availableItems)}`,
              },
              value: { type: 'number', description: 'Valor gasto em reais (número).' },
              description: { type: 'string', description: 'Descrição curta do que foi comprado.' },
            },
            required: ['itemId', 'value', 'description'],
          },
        }]
      : [];

    const userParts: Anthropic.ContentBlockParam[] = [];

    if (imageData && imageMimeType) {
      const validMime = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      const mime = validMime.includes(imageMimeType) ? imageMimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' : 'image/jpeg';
      userParts.push({
        type: 'image',
        source: { type: 'base64', media_type: mime, data: imageData },
      });
    }

    userParts.push({
      type: 'text',
      text: userMessage || 'Analise este comprovante e identifique o valor total e o tipo de gasto.',
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userParts }],
      ...(tools.length ? { tools, tool_choice: { type: 'auto' } } : {}),
    });

    let text = '';
    let expense: { itemId: string; value: number; description: string } | null = null;
    let toolUseBlock: Anthropic.ToolUseBlock | null = null;

    for (const block of response.content) {
      if (block.type === 'text') text += block.text;
      if (block.type === 'tool_use' && block.name === 'register_expense') {
        toolUseBlock = block;
        expense = block.input as { itemId: string; value: number; description: string };
      }
    }

    // Se usou a tool mas não gerou texto, pede resposta de texto
    if (!text && toolUseBlock && expense) {
      const followUp = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userParts },
          { role: 'assistant', content: response.content },
          {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: toolUseBlock.id,
              content: 'Gasto registrado com sucesso.',
            }],
          },
        ],
      });
      text = followUp.content.find(b => b.type === 'text')?.text ?? '';
    }

    return res.json({ text, expense });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno';
    return res.status(500).json({ error: message });
  }
}
