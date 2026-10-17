import { headers } from 'next/headers';
import prisma from '@/lib/prisma';

const COOKIE_NAME = 'forgecommunity.session';

type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: string;
  title: string | null;
};

export type SiteSession = { user: SessionUser; expires: string };
export type Session = SiteSession;

export function readSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const item of cookieHeader.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator).trim() !== COOKIE_NAME) continue;
    try { return decodeURIComponent(item.slice(separator + 1).trim()) || null; }
    catch { return null; }
  }
  return null;
}

export function sessionCookie(token: string, requestUrl: string, expires: Date): string {
  const secure = new URL(requestUrl).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secure}`;
}

export function clearedSessionCookie(requestUrl: string): string {
  const secure = new URL(requestUrl).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

/** Validates the app-owned session cookie against the database. */
export async function getServerSession(_options?: unknown): Promise<SiteSession | null> {
  const requestHeaders = await headers();
  const token = readSessionToken(requestHeaders.get('cookie'));
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { sessionToken: token },
    select: {
      expires: true,
      user: { select: { id: true, email: true, name: true, image: true, role: true, title: true } },
    },
  });
  if (!session || session.expires.getTime() <= Date.now()) {
    if (session) await prisma.session.delete({ where: { sessionToken: token } }).catch(() => undefined);
    return null;
  }
  return { user: session.user, expires: session.expires.toISOString() };
}
