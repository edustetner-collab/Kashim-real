// Utilitário de autenticação compartilhado entre as APIs

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY!;
const ADMIN_IDS = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

export async function verifyAdmin(authHeader: string): Promise<string | null> {
  const token = (authHeader ?? '').replace('Bearer ', '').trim();
  if (!token) return null;

  try {
    // Decodifica o payload JWT sem verificar assinatura
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    const userId: string = payload.sub;
    if (!userId || !ADMIN_IDS.includes(userId)) return null;

    // Confirma que o usuário existe no Clerk (segurança adicional)
    const clerkRes = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` },
    });
    if (!clerkRes.ok) return null;

    return userId;
  } catch {
    return null;
  }
}
