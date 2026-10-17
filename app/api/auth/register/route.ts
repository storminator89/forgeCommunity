import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isSameOriginRequest, readRequestBody } from '@/lib/server/auth-security';
import { REGISTER_AGGREGATE_RATE_LIMIT, REGISTER_RATE_LIMIT, consumeRateLimit, rateLimitHeaders } from '@/lib/server/rate-limit';
import { MAX_AUTH_BODY_BYTES, registerAccount } from '@/lib/sites-auth/credentials';

const schema = z.object({ name: z.string(), email: z.string(), password: z.string() });
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return NextResponse.json({ message: 'Ungültige Anfragequelle.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  const address = req.headers.get('cf-connecting-ip') ?? 'unknown';
  const limit = consumeRateLimit(address === 'unknown' ? 'register:aggregate' : `register:ip:${address}`, address === 'unknown' ? REGISTER_AGGREGATE_RATE_LIMIT : REGISTER_RATE_LIMIT);
  if (!limit.allowed) return NextResponse.json({ message: 'Zu viele Anfragen. Bitte versuche es später erneut.' }, { status: 429, headers: rateLimitHeaders(limit) });
  let body: unknown;
  try {
    const raw = await readRequestBody(req, MAX_AUTH_BODY_BYTES);
    if (raw === null) return NextResponse.json({ message: 'Anfrage ist zu groß.' }, { status: 413, headers: { 'Cache-Control': 'no-store' } });
    body = JSON.parse(raw);
  } catch { return NextResponse.json({ message: 'Ungültige Anfrage.' }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ message: 'Bitte prüfe Name, E-Mail und Passwort.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  const email = parsed.data.email.trim().toLowerCase();
  const emailLimit = consumeRateLimit(`register:email:${email}`, REGISTER_RATE_LIMIT);
  if (!emailLimit.allowed) return NextResponse.json({ message: 'Zu viele Anfragen. Bitte versuche es später erneut.' }, { status: 429, headers: rateLimitHeaders(emailLimit) });
  return registerAccount(parsed.data, req.url);
}
