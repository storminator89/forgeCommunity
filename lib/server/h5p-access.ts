import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { H5PValidationError } from './h5p-archive';
import { validH5PId } from './h5p-storage';

export interface H5PUser { id: string; role?: string | null }
const TOKEN_TTL_SECONDS = 2 * 60 * 60;
function webOrigin(value: string | undefined) {
  if (!value) return null;
  try { const parsed = new URL(value); return ['https:', 'http:'].includes(parsed.protocol) ? parsed.origin : null; } catch { return null; }
}
function localOrigins(requestOrigin?: string) {
  return [...new Set([webOrigin(process.env.NEXTAUTH_URL), webOrigin(process.env.NEXT_PUBLIC_APP_URL), webOrigin(requestOrigin)].filter((value): value is string => Boolean(value)))];
}
/** Deployment configuration takes precedence over a container's internal hostname. */
export function h5pAppOrigin(requestOrigin: string) { return localOrigins(requestOrigin)[0] || requestOrigin; }

function secret() {
  const value = process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error('NEXTAUTH_SECRET is required for private H5P assets');
  return value;
}
function signature(id: string, payload: string) { return createHmac('sha256', secret()).update(`forge:h5p:assets:v1:${id}:${payload}`).digest('base64url'); }
export function createH5PAssetToken(id: string, now = Date.now()) {
  if (!validH5PId(id)) throw new H5PValidationError('Ungültige H5P-ID.');
  const payload = `${Math.floor(now / 1_000) + TOKEN_TTL_SECONDS}.${randomBytes(12).toString('base64url')}`;
  return `${payload}.${signature(id, payload)}`;
}
export function verifyH5PAssetToken(id: string, token: string, now = Date.now()) {
  if (!validH5PId(id) || !/^\d{10,12}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const [expiration, nonce, signed] = token.split('.');
  const expiry = Number(expiration);
  const seconds = Math.floor(now / 1_000);
  if (expiry <= seconds || expiry > seconds + TOKEN_TTL_SECONDS) return false;
  const expected = Buffer.from(signature(id, `${expiration}.${nonce}`));
  const actual = Buffer.from(signed);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function authorizedH5PContent(id: string, user: H5PUser, origin?: string) {
  if (!validH5PId(id)) throw new H5PValidationError('H5P-Inhalt nicht gefunden.', 404);
  const content = await prisma.h5PContent.findUnique({ where: { id }, select: { id: true, title: true, contentType: true, userId: true, createdAt: true } });
  if (!content) throw new H5PValidationError('H5P-Inhalt nicht gefunden.', 404);
  if (content.userId === user.id || user.role === 'ADMIN') return content;
  const embedPath = `/h5p/embed/${id}`;
  const reference = await prisma.courseContent.findFirst({
    where: { type: 'H5P', content: { in: [embedPath, id, ...localOrigins(origin).map(value => `${value}${embedPath}`)] }, course: { OR: [{ instructorId: user.id }, { enrollments: { some: { userId: user.id } } }] } },
    select: { id: true },
  });
  if (!reference) throw new H5PValidationError('Kein Zugriff auf diesen H5P-Inhalt.', 403);
  return content;
}

/** Existing course references grant read access, never permission to invent a new reference. */
export async function assertCanAttachH5P(userId: string, role: string | null | undefined, source: string, origin?: string, db: Pick<Prisma.TransactionClient, 'h5PContent'> = prisma) {
  let id: string | undefined;
  if (/^[A-Za-z0-9_-]{1,80}$/.test(source)) id = source;
  else {
    let parsed: URL;
    try { parsed = new URL(source, origin || 'https://forge.invalid'); }
    catch { throw new H5PValidationError('Ungültige H5P-Quelle.'); }
    const local = source.startsWith('/') || !origin || localOrigins(origin).includes(parsed.origin);
    if (local) {
      const match = parsed.pathname.match(/^\/h5p\/embed\/([A-Za-z0-9_-]{1,80})\/?$/);
      if (!match) throw new H5PValidationError('Ungültige lokale H5P-ID.');
      id = match[1];
    }
  }
  if (!id) return; // Remote embeds retain the existing safe URL policy.
  const content = await db.h5PContent.findUnique({ where: { id }, select: { userId: true } });
  if (!content) throw new H5PValidationError('Der lokale H5P-Inhalt wurde nicht importiert.', 400);
  if (content.userId !== userId && role !== 'ADMIN') throw new H5PValidationError('Nur eigene H5P-Inhalte dürfen neu verknüpft werden.', 403);
}
