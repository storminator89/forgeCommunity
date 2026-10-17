import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getClientAddress, isSameOriginRequest, normalizeEmail, readRequestBody } from '@/lib/server/auth-security';
import { consumeRateLimit, LOGIN_AGGREGATE_RATE_LIMIT, LOGIN_RATE_LIMIT, rateLimitHeaders } from '@/lib/server/rate-limit';
import { authenticateAccount, jsonError, MAX_AUTH_BODY_BYTES, validCredentials } from '@/lib/sites-auth/credentials';

const schema = z.object({ email: z.string(), password: z.string() });
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return jsonError('Ungültige Anfragequelle.', 403);
  const address = getClientAddress(req.headers);
  const limit = consumeRateLimit(address === 'unknown' ? 'login:aggregate' : `login:ip:${address}`, address === 'unknown' ? LOGIN_AGGREGATE_RATE_LIMIT : LOGIN_RATE_LIMIT);
  if (!limit.allowed) return NextResponse.json({ message: 'Zu viele Anmeldeversuche. Bitte versuche es später erneut.' }, { status: 429, headers: rateLimitHeaders(limit) });
  let body: unknown;
  try {
    const raw = await readRequestBody(req, MAX_AUTH_BODY_BYTES);
    if (raw === null) return jsonError('Anfrage ist zu groß.', 413);
    body = JSON.parse(raw);
  } catch { return jsonError('Ungültige Anfrage.', 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success || !validCredentials(parsed.data)) return jsonError('E-Mail-Adresse oder Passwort ist falsch.', 401);
  const email = normalizeEmail(parsed.data.email);
  const emailLimit = consumeRateLimit(`login:email:${email}`, LOGIN_RATE_LIMIT);
  if (!emailLimit.allowed) return NextResponse.json({ message: 'Zu viele Anmeldeversuche. Bitte versuche es später erneut.' }, { status: 429, headers: rateLimitHeaders(emailLimit) });
  return authenticateAccount(email, parsed.data.password, req.url);
}
