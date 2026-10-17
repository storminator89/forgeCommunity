import 'server-only';

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import prisma from '@/lib/prisma';
import { Prisma } from '@/generated/prisma/client';
import { H5PValidationError } from './h5p-archive';
import { validH5PId } from './h5p-storage';
import { assertCurrentPrerequisites, CoursePathError } from './course-prerequisites';

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
function tokenKey() { return createHash('sha256').update(secret()).digest(); }
function tokenAAD(id: string) { return Buffer.from(`forge:h5p:assets:v2:${id}`); }

/** Credential-free sandbox fetches carry an encrypted actor ID, reauthorized on each asset read. */
export function createH5PAssetToken(id: string, actorId: string, now = Date.now()) {
  if (!validH5PId(id) || !/^[A-Za-z0-9_-]{1,100}$/.test(actorId)) throw new H5PValidationError('Ungültige H5P-ID.');
  const issued = Math.floor(now / 1_000);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv);
  cipher.setAAD(tokenAAD(id));
  const data = Buffer.concat([cipher.update(JSON.stringify([actorId, issued, issued + TOKEN_TTL_SECONDS]), 'utf8'), cipher.final()]);
  return `v2.${iv.toString('base64url')}.${data.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
}

export function h5pAssetTokenActor(id: string, token: string, now = Date.now()): string | null {
  if (!validH5PId(id) || !/^v2\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{1,256}\.[A-Za-z0-9_-]{22}$/.test(token)) return null;
  try {
    const [, iv, encrypted, tag] = token.split('.');
    const decipher = createDecipheriv('aes-256-gcm', tokenKey(), Buffer.from(iv, 'base64url'));
    decipher.setAAD(tokenAAD(id));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const claim = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8')) as unknown;
    if (!Array.isArray(claim) || claim.length !== 3 || typeof claim[0] !== 'string' ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(claim[0]) || !Number.isSafeInteger(claim[1]) || !Number.isSafeInteger(claim[2])) return null;
    const seconds = Math.floor(now / 1_000);
    if (claim[1] > seconds + 60 || claim[2] <= seconds || claim[2] - claim[1] !== TOKEN_TTL_SECONDS) return null;
    return claim[0];
  } catch { return null; }
}

export function verifyH5PAssetToken(id: string, token: string, now = Date.now()) {
  return h5pAssetTokenActor(id, token, now) !== null;
}

export async function authorizedH5PContent(id: string, user: H5PUser, origin?: string) {
  if (!validH5PId(id)) throw new H5PValidationError('H5P-Inhalt nicht gefunden.', 404);
  // Check current authority and package/course ownership together before a
  // preview can read private files or issue its existing asset capability.
  return prisma.$transaction(async tx => {
    const content = await tx.h5PContent.findUnique({ where: { id }, select: { id: true, title: true, contentType: true, userId: true, createdAt: true } });
    if (!content) throw new H5PValidationError('H5P-Inhalt nicht gefunden.', 404);
    // A deleted account or stale administrator session must not retain
    // package preview rights after the role/account change commits.
    const actor = await tx.user.findUnique({ where: { id: user.id }, select: { role: true } });
    if (!actor) throw new H5PValidationError('Kein Zugriff auf diesen H5P-Inhalt.', 403);
    if (content.userId === user.id || actor.role === 'ADMIN') return content;
    const embedPath = `/h5p/embed/${id}`;
    const references = await tx.courseContent.findMany({
      where: {
        type: 'H5P', archivedAt: null,
        content: { in: [embedPath, id, ...localOrigins(origin).map(value => `${value}${embedPath}`)] },
        course: { activePublicationId: { not: null }, enrollments: { some: { userId: user.id } } },
      },
      select: { id: true, courseId: true, content: true, course: { select: { activePublicationId: true } } },
    });
    for (const reference of references) {
      const publicationId = reference.course.activePublicationId;
      if (!publicationId) continue;
      const publication = await tx.coursePublication.findUnique({ where: { id: publicationId }, select: { courseId: true, payload: true } });
      if (!publication || publication.courseId !== reference.courseId) continue;
      let published: { contents?: Array<{ id?: string; type?: string | null; content?: string }> };
      try { published = JSON.parse(publication.payload); } catch { continue; }
      const node = Array.isArray(published.contents) ? published.contents.find(row => row?.id === reference.id) : null;
      if (!node || node.type !== 'H5P' || node.content !== reference.content) continue;
      try {
        await assertCurrentPrerequisites(tx, user.id, reference.courseId, reference.id, publicationId);
        return content;
      } catch (error) {
        if (!(error instanceof CoursePathError)) throw error;
        // Another enrolled, unlocked published reference can still grant read.
      }
    }
    throw new H5PValidationError('Kein Zugriff auf diesen H5P-Inhalt.', 403);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Pure local-reference parser shared by D1 mutation fences and package access. */
export function h5pAttachmentId(source: string, origin?: string): string | undefined {
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
  return id;
}

/** Existing course references grant read access, never permission to invent a new reference. */
export async function assertCanAttachH5P(userId: string, role: string | null | undefined, source: string, origin?: string, db: Pick<Prisma.TransactionClient, 'h5PContent' | 'user'> = prisma) {
  const id = h5pAttachmentId(source, origin);
  if (!id) return; // Remote embeds retain the existing safe URL policy.
  const content = await db.h5PContent.findUnique({ where: { id }, select: { userId: true } });
  if (!content) throw new H5PValidationError('Der lokale H5P-Inhalt wurde nicht importiert.', 400);
  if (content.userId === userId) return;
  // Owning the destination course does not grant access to another owner's
  // package. Recheck this separate admin privilege in the mutation snapshot.
  const actor = role === 'ADMIN' ? await db.user.findUnique({ where: { id: userId }, select: { role: true } }) : null;
  if (actor?.role !== 'ADMIN') throw new H5PValidationError('Nur eigene H5P-Inhalte dürfen neu verknüpft werden.', 403);
}
