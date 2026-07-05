// Utilitário de autenticação compartilhado entre as APIs.
// A verificação de assinatura vive em ./_verifyToken.
import { verifyAdminToken } from './_verifyToken';

export async function verifyAdmin(authHeader: string): Promise<string | null> {
  return verifyAdminToken(authHeader);
}
