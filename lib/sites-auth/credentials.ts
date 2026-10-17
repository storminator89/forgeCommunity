import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { normalizeEmail, utf8ByteLength } from '@/lib/server/auth-security';
import { clearedSessionCookie, sessionCookie } from '@/lib/sites-auth/server';

export const MAX_AUTH_BODY_BYTES = 16 * 1024;
const BCRYPT_ROUNDS = 12;
const SESSION_DAYS = 30;

export function createSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function startSession(userId: string, requestUrl: string) {
  const token = createSessionToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { sessionToken: token, userId, expires } });
  return sessionCookie(token, requestUrl, expires);
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function validCredentials(value: unknown): value is { email: string; password: string } {
  if (!value || typeof value !== 'object') return false;
  const { email, password } = value as Record<string, unknown>;
  return typeof email === 'string' && email.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    typeof password === 'string' && password.length >= 1 && utf8ByteLength(password) <= 72;
}

export async function registerAccount(input: { name: string; email: string; password: string }, requestUrl: string) {
  const email = normalizeEmail(input.email);
  const password = input.password;
  if (!input.name.trim() || input.name.trim().length > 120) return jsonError('Bitte gib einen Namen mit höchstens 120 Zeichen ein.', 400);
  if (!validCredentials({ email, password })) return jsonError('Bitte gib eine gültige E-Mail-Adresse ein.', 400);
  if (password.length < 12 || utf8ByteLength(password) > 72 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return jsonError('Das Passwort braucht mindestens 12 Zeichen mit Groß- und Kleinbuchstaben, Zahl und Sonderzeichen.', 400);
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    const user = await prisma.user.create({
      data: { name: input.name.trim(), email, password: hashedPassword, role: 'USER' },
      select: { id: true, role: true },
    });

    // A unique bootstrap row makes the first successful claim the initial admin,
    // including when two registrations reach the empty database concurrently.
    try {
      await prisma.siteAdminBootstrap.create({ data: { id: 'initial', userId: user.id } });
      await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
    } catch {
      const claim = await prisma.siteAdminBootstrap.findUnique({ where: { id: 'initial' } });
      if (!claim) throw new Error('Admin-Initialisierung konnte nicht abgeschlossen werden.');
      if (claim.userId === user.id) await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
    }

    const cookie = await startSession(user.id, requestUrl);
    const response = NextResponse.json({ message: 'Konto erstellt.', userId: user.id }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    response.headers.append('Set-Cookie', cookie);
    return response;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2002') {
      return jsonError('Diese E-Mail-Adresse ist bereits registriert.', 409);
    }
    console.error('Registrierungsfehler:', error);
    return jsonError('Die Registrierung konnte gerade nicht abgeschlossen werden.', 500);
  }
}

export async function authenticateAccount(emailInput: string, password: string, requestUrl: string) {
  const email = normalizeEmail(emailInput);
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, password: true } });
  if (!user?.password || !(await bcrypt.compare(password, user.password))) return jsonError('E-Mail-Adresse oder Passwort ist falsch.', 401);
  await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
  const cookie = await startSession(user.id, requestUrl);
  const response = NextResponse.json({ message: 'Angemeldet.' }, { headers: { 'Cache-Control': 'no-store' } });
  response.headers.append('Set-Cookie', cookie);
  return response;
}

export async function endSession(cookieHeader: string | null, requestUrl: string) {
  const { readSessionToken } = await import('@/lib/sites-auth/server');
  const token = readSessionToken(cookieHeader);
  if (token) await prisma.session.deleteMany({ where: { sessionToken: token } });
  const response = NextResponse.json({ message: 'Abgemeldet.' }, { headers: { 'Cache-Control': 'no-store' } });
  response.headers.append('Set-Cookie', clearedSessionCookie(requestUrl));
  return response;
}
