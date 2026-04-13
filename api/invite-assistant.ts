import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

function getSuperAdminId(authHeader: string): string | null {
  const token = (authHeader ?? '').replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    const userId: string = payload.sub;
    if (!userId || !ADMIN_IDS.includes(userId)) return null;
    return userId;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const requesterId = getSuperAdminId(req.headers.authorization ?? '');
  if (!requesterId) return res.status(403).json({ error: 'Forbidden' });

  const { email, name } = req.body;
  if (!email || !name) return res.status(400).json({ error: 'email e name são obrigatórios' });

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Salva na tabela admin_users
    const { error: dbError } = await db.from('admin_users').upsert(
      { email: email.toLowerCase().trim(), name: name.trim(), added_by: requesterId },
      { onConflict: 'email' }
    );
    if (dbError) throw dbError;

    // Envia convite via Clerk
    const inviteRes = await fetch('https://api.clerk.com/v1/invitations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLERK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email_address: email.toLowerCase().trim(),
        notify: true,
        public_metadata: { role: 'assistant' },
      }),
    });

    if (!inviteRes.ok) {
      const err = await inviteRes.json();
      const msg: string = err.errors?.[0]?.long_message ?? err.errors?.[0]?.message ?? '';
      // Se já tem conta, o invite falha mas está tudo certo — ela já pode logar
      if (msg.toLowerCase().includes('already') || err.errors?.[0]?.code === 'duplicate_record') {
        return res.status(200).json({ ok: true, alreadyExists: true });
      }
      throw new Error(msg || 'Erro ao enviar convite');
    }

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('invite-assistant error:', err);
    return res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
}
