// Simple in-process rate limiter for Vercel serverless functions.
// Uses a module-level Map that persists within a warm function instance.
// Provides basic protection against burst abuse — not a substitute for
// a distributed rate limiter (e.g. Upstash) at high scale.

const requests = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = requests.get(key);

  if (!entry || now > entry.resetAt) {
    requests.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= limit) return false;

  entry.count++;
  return true;
}
