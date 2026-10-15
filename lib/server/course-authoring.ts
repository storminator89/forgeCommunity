import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getQuizValidationError } from '@/app/courses/[courseId]/contents/types';
import { assertCanAttachH5P } from '@/lib/server/h5p-access';
import { assertCanReferenceCourseAsset, extractCourseAssetUrls } from '@/lib/server/course-assets';
import { contentQuiz, courseContentRevision, courseLeaves, isQuizLikeContent } from '@/lib/server/course-progress';
import { courseQuizApprovalRevision, reconcileCourseRewards } from '@/lib/server/rewards';
import { prepareContent } from '@/app/api/courses/[courseId]/contents/content-mutations';
import { sanitizeTextServer } from '@/lib/server/sanitize-html';
import { getSafeNavigationUrl } from '@/lib/security';

export type Author = { id: string; role?: string | null };
export type DraftNode = { id: string; parentId: string | null; title: string; type: 'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P' | 'QUIZ' | null; content: string; order: number };
export type CoursePayload = { schemaVersion: 1; title: string; description: string; startDate: string | null; endDate: string | null; imageUrl: string | null; contents: DraftNode[] };
export type AuthorOperation =
  | { kind: 'setMetadata'; patch: Partial<Pick<CoursePayload, 'title' | 'description' | 'startDate' | 'endDate' | 'imageUrl'>> }
  | { kind: 'insertNode'; node: Pick<DraftNode, 'id' | 'title' | 'type' | 'content'>; parentId: string | null; afterId: string | null }
  | { kind: 'updateNode'; id: string; patch: Partial<Pick<DraftNode, 'title' | 'type' | 'content'>> }
  | { kind: 'moveNode'; id: string; parentId: string | null; afterId: string | null }
  | { kind: 'deleteNode'; id: string };

const MAX_NODES = 500;
const MAX_PAYLOAD_BYTES = 512 * 1024;

export class AuthoringError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

/** Bind a saved payload to an immutable publication without normalizing body bytes. */
export function publicationDigest(payload: CoursePayload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function payloadJson(payload: CoursePayload) {
  const json = JSON.stringify(payload);
  if (Buffer.byteLength(json, 'utf8') > MAX_PAYLOAD_BYTES) throw new AuthoringError('Der Entwurf ist zu groß.', 413);
  return json;
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(value);
}

function validDate(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length > 35 || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && (value.length !== 10 || date.toISOString().slice(0, 10) === value);
}

function parsePayload(value: string): CoursePayload {
  let payload: CoursePayload;
  try { payload = JSON.parse(value) as CoursePayload; }
  catch { throw new AuthoringError('Der gespeicherte Entwurf ist beschädigt.', 409); }
  if (!payload || payload.schemaVersion !== 1 || !Array.isArray(payload.contents) ||
      typeof payload.title !== 'string' || typeof payload.description !== 'string' ||
      !validDate(payload.startDate) || !validDate(payload.endDate) ||
      (payload.imageUrl !== null && typeof payload.imageUrl !== 'string')) {
    throw new AuthoringError('Der gespeicherte Entwurf ist beschädigt.', 409);
  }
  return payload;
}

function checkTopology(payload: CoursePayload, strictOrder = false) {
  if (payload.contents.length > MAX_NODES) throw new AuthoringError('Zu viele Kursinhalte.', 413);
  const map = new Map<string, DraftNode>();
  for (const node of payload.contents) {
    if (!validId(node.id) || map.has(node.id) ||
        (node.parentId !== null && !validId(node.parentId)) ||
        typeof node.title !== 'string' || node.title.length > 300 ||
        typeof node.content !== 'string' || node.content.length > 100_000 ||
        ![null, 'TEXT', 'VIDEO', 'AUDIO', 'H5P', 'QUIZ'].includes(node.type) ||
        !Number.isSafeInteger(node.order) || node.order < 1) {
      throw new AuthoringError('Ungültige Kursstruktur.');
    }
    map.set(node.id, node);
  }
  const siblings = new Map<string | null, Set<number>>();
  for (const node of payload.contents) {
    if (node.parentId !== null && !map.has(node.parentId)) throw new AuthoringError('Ein übergeordneter Inhalt fehlt.');
    const ranks = siblings.get(node.parentId) ?? new Set<number>();
    if (strictOrder && ranks.has(node.order)) throw new AuthoringError('Doppelte Reihenfolge in der Kursstruktur.');
    ranks.add(node.order);
    siblings.set(node.parentId, ranks);
    const seen = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId) {
      if (seen.has(parentId)) throw new AuthoringError('Zyklische Kursstruktur.');
      seen.add(parentId);
      parentId = map.get(parentId)?.parentId ?? null;
    }
  }
}

function canonical(payload: CoursePayload): CoursePayload {
  return {
    schemaVersion: 1, title: payload.title, description: payload.description,
    startDate: payload.startDate, endDate: payload.endDate, imageUrl: payload.imageUrl,
    contents: payload.contents.map(node => ({ id: node.id, parentId: node.parentId, title: node.title, type: node.type, content: node.content, order: node.order })),
  };
}

function asPublishedNode(node: DraftNode) {
  return { ...node, courseId: '', type: node.type === 'QUIZ' ? 'TEXT' : node.type };
}

function orderNodes(contents: DraftNode[]) {
  const byParent = new Map<string | null, DraftNode[]>();
  for (const node of contents) {
    const rows = byParent.get(node.parentId) ?? [];
    rows.push(node);
    byParent.set(node.parentId, rows);
  }
  const ordered: DraftNode[] = [];
  const visit = (parentId: string | null) => {
    for (const row of (byParent.get(parentId) ?? []).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
      ordered.push(row);
      visit(row.id);
    }
  };
  visit(null);
  if (ordered.length !== contents.length) throw new AuthoringError('Ungültige Kursstruktur.');
  return ordered;
}

function insertAt(contents: DraftNode[], node: DraftNode, parentId: string | null, afterId: string | null) {
  if (parentId !== null && !contents.some(row => row.id === parentId)) throw new AuthoringError('Übergeordneter Inhalt nicht gefunden.', 404);
  const siblings = contents.filter(row => row.parentId === parentId && row.id !== node.id).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const index = afterId === null ? 0 : siblings.findIndex(row => row.id === afterId) + 1;
  if (afterId !== null && index === 0) throw new AuthoringError('Nachbarinhalt nicht gefunden.', 404);
  siblings.splice(index, 0, node);
  for (const [rank, row] of siblings.entries()) row.order = rank + 1;
  node.parentId = parentId;
}

function operationFromUnknown(value: unknown): AuthorOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthoringError('Ungültige Entwurfsänderung.');
  const op = value as Record<string, unknown>;
  if (op.kind === 'setMetadata') {
    const patch = op.patch;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new AuthoringError('Ungültige Kursdaten.');
    const entries = Object.entries(patch);
    if (!entries.length || entries.some(([key, val]) =>
      !['title', 'description', 'startDate', 'endDate', 'imageUrl'].includes(key) ||
      (['title', 'description'].includes(key) ? typeof val !== 'string' :
        ['startDate', 'endDate'].includes(key) ? !validDate(val) : val !== null && typeof val !== 'string'))) throw new AuthoringError('Ungültige Kursdaten.');
    return op as AuthorOperation;
  }
  if (op.kind === 'insertNode') {
    const node = op.node as Record<string, unknown> | undefined;
    if (!node || !validId(node.id) || typeof node.title !== 'string' || typeof node.content !== 'string' ||
        ![null, 'TEXT', 'VIDEO', 'AUDIO', 'H5P', 'QUIZ'].includes(node.type as string | null) ||
        (op.parentId !== null && !validId(op.parentId)) || (op.afterId !== null && !validId(op.afterId))) {
      throw new AuthoringError('Ungültiger neuer Kursinhalt.');
    }
    return op as AuthorOperation;
  }
  if (op.kind === 'updateNode') {
    const patch = op.patch as Record<string, unknown> | undefined;
    if (!validId(op.id) || !patch || !Object.keys(patch).length || Object.entries(patch).some(([key, val]) =>
      !['title', 'type', 'content'].includes(key) ||
      (key === 'type' ? ![null, 'TEXT', 'VIDEO', 'AUDIO', 'H5P', 'QUIZ'].includes(val as string | null) : typeof val !== 'string'))) {
      throw new AuthoringError('Ungültige Kursinhalt-Änderung.');
    }
    return op as AuthorOperation;
  }
  if (op.kind === 'moveNode') {
    if (!validId(op.id) || (op.parentId !== null && !validId(op.parentId)) || (op.afterId !== null && !validId(op.afterId))) throw new AuthoringError('Ungültige Verschiebung.');
    return op as AuthorOperation;
  }
  if (op.kind === 'deleteNode' && validId(op.id)) return op as AuthorOperation;
  throw new AuthoringError('Ungültige Entwurfsänderung.');
}

function applyOperation(payload: CoursePayload, operation: AuthorOperation): CoursePayload {
  const next = canonical(JSON.parse(JSON.stringify(payload)) as CoursePayload);
  if (operation.kind === 'setMetadata') {
    Object.assign(next, operation.patch);
    if (next.title.length > 300 || next.description.length > 10_000 ||
        (next.imageUrl !== null && next.imageUrl.length > 2000)) throw new AuthoringError('Kursdaten sind zu lang.');
    if (operation.patch.title !== undefined) next.title = sanitizeTextServer(next.title);
    if (operation.patch.description !== undefined) next.description = sanitizeTextServer(next.description);
    if (operation.patch.imageUrl !== undefined && next.imageUrl && !getSafeNavigationUrl(next.imageUrl)) {
      throw new AuthoringError('Ungültige Bildquelle.');
    }
  } else if (operation.kind === 'insertNode') {
    if (next.contents.some(row => row.id === operation.node.id)) throw new AuthoringError('Inhalt-ID existiert bereits.', 409);
    const type = operation.node.type;
    const node: DraftNode = { ...operation.node, title: sanitizeTextServer(operation.node.title),
      content: type === 'QUIZ' ? operation.node.content : prepareContent(operation.node.content, type),
      parentId: operation.parentId, order: 1 };
    next.contents.push(node);
    insertAt(next.contents, node, operation.parentId, operation.afterId);
  } else if (operation.kind === 'updateNode') {
    const node = next.contents.find(row => row.id === operation.id);
    if (!node) throw new AuthoringError('Inhalt nicht gefunden.', 404);
    if (operation.patch.title !== undefined) node.title = sanitizeTextServer(operation.patch.title);
    if (operation.patch.type !== undefined) node.type = operation.patch.type;
    if (operation.patch.content !== undefined || operation.patch.type !== undefined) {
      const source = operation.patch.content ?? node.content;
      node.content = node.type === 'QUIZ' ? source : prepareContent(source, node.type);
    }
  } else if (operation.kind === 'moveNode') {
    const node = next.contents.find(row => row.id === operation.id);
    if (!node) throw new AuthoringError('Inhalt nicht gefunden.', 404);
    const oldParent = node.parentId;
    const destination = operation.parentId;
    if (node.id === destination || node.id === operation.afterId) throw new AuthoringError('Ein Inhalt kann nicht auf sich selbst verschoben werden.');
    insertAt(next.contents, node, destination, operation.afterId);
    if (oldParent !== destination) {
      next.contents.filter(row => row.parentId === oldParent).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).forEach((row, index) => { row.order = index + 1; });
    }
  } else {
    if (!next.contents.some(row => row.id === operation.id)) throw new AuthoringError('Inhalt nicht gefunden.', 404);
    const removed = new Set([operation.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of next.contents) if (row.parentId && removed.has(row.parentId) && !removed.has(row.id)) { removed.add(row.id); changed = true; }
    }
    const oldParent = next.contents.find(row => row.id === operation.id)!.parentId;
    next.contents = next.contents.filter(row => !removed.has(row.id));
    next.contents.filter(row => row.parentId === oldParent).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).forEach((row, index) => { row.order = index + 1; });
  }
  checkTopology(next);
  payloadJson(next);
  return next;
}

export async function authoringTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 }); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
      if (attempt >= 3) throw new AuthoringError('Gleichzeitige Änderung. Bitte neu laden.', 409);
    }
  }
}

async function authorize(tx: Prisma.TransactionClient, courseId: string, actor: Author) {
  const [course, account] = await Promise.all([
    tx.course.findUnique({ where: { id: courseId }, select: { id: true, title: true, description: true, startDate: true, endDate: true, imageUrl: true, instructorId: true, activePublicationId: true } }),
    tx.user.findUnique({ where: { id: actor.id }, select: { role: true } }),
  ]);
  if (!course) throw new AuthoringError('Kurs nicht gefunden.', 404);
  if (!account || (course.instructorId !== actor.id && (actor.role !== 'ADMIN' || account.role !== 'ADMIN'))) throw new AuthoringError('Kein Zugriff auf den Kurs.', 403);
  return course;
}

async function ensureDraft(tx: Prisma.TransactionClient, course: Awaited<ReturnType<typeof authorize>>) {
  const draft = await tx.courseDraft.findUnique({ where: { courseId: course.id } });
  if (!draft) throw new AuthoringError('Kursentwurf fehlt. Bitte Einrichtung prüfen.', 409);
  return draft;
}

async function activeSummary(tx: Prisma.TransactionClient, courseId: string, id: string | null) {
  if (!id) return null;
  const row = await tx.coursePublication.findUnique({ where: { id }, select: { id: true, courseId: true, sequence: true, digest: true } });
  if (!row || row.courseId !== courseId) throw new AuthoringError('Kursveröffentlichung ist beschädigt.', 409);
  return { id: row.id, sequence: row.sequence, digest: row.digest };
}

function draftDto(draft: { revision: number; digest: string; payload: string }) {
  return { revision: draft.revision, digest: draft.digest, payload: parsePayload(draft.payload) };
}

function requireRevision(value: unknown): number {
  if (value === undefined) throw new AuthoringError('Entwurfsrevision erforderlich.', 428);
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new AuthoringError('Ungültige Entwurfsrevision.');
  return value as number;
}

export async function readAuthoring(courseId: string, actor: Author) {
  return authoringTransaction(async tx => {
    const course = await authorize(tx, courseId, actor);
    const draft = await ensureDraft(tx, course);
    return { draft: draftDto(draft), activePublication: await activeSummary(tx, courseId, course.activePublicationId) };
  });
}

export async function listAuthorCourses(actor: Author) {
  return authoringTransaction(async tx => {
    const account = await tx.user.findUnique({ where: { id: actor.id }, select: { id: true } });
    if (!account) throw new AuthoringError('Kein Zugriff auf Kurse.', 403);
    const rows = await tx.course.findMany({ where: { instructorId: actor.id }, orderBy: { updatedAt: 'desc' },
      select: { id: true, draft: { select: { revision: true, digest: true, payload: true } },
        activePublication: { select: { id: true, courseId: true, sequence: true, digest: true } } } });
    const courses = rows.map(row => {
      if (!row.draft) throw new AuthoringError('Kursentwurf fehlt. Bitte Einrichtung prüfen.', 409);
      if (row.activePublication && row.activePublication.courseId !== row.id) throw new AuthoringError('Kursveröffentlichung ist beschädigt.', 409);
      const activePublication = row.activePublication && {
        id: row.activePublication.id, sequence: row.activePublication.sequence, digest: row.activePublication.digest,
      };
      return { id: row.id, title: parsePayload(row.draft.payload).title,
        revision: row.draft.revision, activePublication,
        hasUnpublishedChanges: !activePublication || row.draft.digest !== activePublication.digest };
    });
    return { courses };
  });
}

async function checkReferences(tx: Prisma.TransactionClient, courseId: string, actor: Author, payload: CoursePayload,
  origin?: string, previous?: CoursePayload) {
  const ids = payload.contents.map(row => row.id);
  if (ids.length) {
    const rows = await tx.courseContent.findMany({ where: { id: { in: ids } }, select: { id: true, courseId: true } });
    if (rows.some(row => row.courseId !== courseId)) throw new AuthoringError('Inhalt-ID gehört zu einem anderen Kurs.', 409);
  }
  const oldAssets = new Set(previous ? extractCourseAssetUrls(previous) : []);
  for (const url of extractCourseAssetUrls(payload)) if (!oldAssets.has(url)) await assertCanReferenceCourseAsset(tx, courseId, actor.id, url);
  const oldNodes = new Map(previous?.contents.map(node => [node.id, node]));
  for (const node of payload.contents) if (node.type === 'H5P' && node.content) {
    const old = oldNodes.get(node.id);
    if (!old || old.type !== node.type || old.content !== node.content) {
      await assertCanAttachH5P(actor.id, actor.role, node.content, origin, tx);
    }
  }
}

export async function mutateDraft(courseId: string, actor: Author, expected: unknown, operationInput: unknown, origin?: string) {
  const expectedRevision = requireRevision(expected);
  const operation = operationFromUnknown(operationInput);
  return authoringTransaction(async tx => {
    const course = await authorize(tx, courseId, actor);
    const draft = await ensureDraft(tx, course);
    if (draft.revision !== expectedRevision) throw new AuthoringError('Entwurf wurde zwischenzeitlich geändert. Bitte neu laden.', 412);
    const current = parsePayload(draft.payload);
    const payload = applyOperation(current, operation);
    await checkReferences(tx, courseId, actor, payload, origin, current);
    const json = payloadJson(payload);
    const updated = await tx.courseDraft.update({ where: { courseId }, data: {
      revision: { increment: 1 }, payload: json, digest: publicationDigest(payload), lastEditorId: actor.id,
    } });
    return { draft: draftDto(updated), activePublication: await activeSummary(tx, courseId, course.activePublicationId) };
  });
}

export async function discardDraft(courseId: string, actor: Author, expected: unknown) {
  const expectedRevision = requireRevision(expected);
  return authoringTransaction(async tx => {
    const course = await authorize(tx, courseId, actor);
    const draft = await ensureDraft(tx, course);
    if (draft.revision !== expectedRevision) throw new AuthoringError('Entwurf wurde zwischenzeitlich geändert. Bitte neu laden.', 412);
    let reset: CoursePayload;
    if (course.activePublicationId) {
      const published = await tx.coursePublication.findUnique({ where: { id: course.activePublicationId } });
      if (!published || published.courseId !== courseId) throw new AuthoringError('Kursveröffentlichung ist beschädigt.', 409);
      reset = parsePayload(published.payload);
    } else {
      reset = { schemaVersion: 1, title: '', description: '', startDate: null, endDate: null, imageUrl: null, contents: [] };
    }
    const updated = await tx.courseDraft.update({ where: { courseId }, data: {
      revision: { increment: 1 }, payload: payloadJson(reset), digest: publicationDigest(reset),
      basePublicationId: course.activePublicationId, lastEditorId: actor.id,
    } });
    return { draft: draftDto(updated), activePublication: await activeSummary(tx, courseId, course.activePublicationId) };
  });
}

export async function listHistory(courseId: string, actor: Author) {
  return authoringTransaction(async tx => {
    await authorize(tx, courseId, actor);
    const publications = await tx.coursePublication.findMany({ where: { courseId }, orderBy: { sequence: 'desc' },
      select: { id: true, sequence: true, source: true, recordedAt: true, digest: true } });
    return { publications };
  });
}

export async function restoreDraft(courseId: string, actor: Author, expected: unknown, publicationId: unknown) {
  const expectedRevision = requireRevision(expected);
  if (!validId(publicationId)) throw new AuthoringError('Ungültige Veröffentlichungs-ID.');
  return authoringTransaction(async tx => {
    const course = await authorize(tx, courseId, actor);
    const draft = await ensureDraft(tx, course);
    if (draft.revision !== expectedRevision) throw new AuthoringError('Entwurf wurde zwischenzeitlich geändert. Bitte neu laden.', 412);
    const publication = await tx.coursePublication.findUnique({ where: { id: publicationId } });
    if (!publication || publication.courseId !== courseId) throw new AuthoringError('Veröffentlichung nicht gefunden.', 404);
    const payload = parsePayload(publication.payload);
    const updated = await tx.courseDraft.update({ where: { courseId }, data: {
      revision: { increment: 1 }, payload: payloadJson(payload), digest: publication.digest,
      basePublicationId: publication.id, lastEditorId: actor.id,
    } });
    return { draft: draftDto(updated), activePublication: await activeSummary(tx, courseId, course.activePublicationId) };
  });
}

function publicationBlockers(payload: CoursePayload) {
  const blockers: string[] = [];
  try { checkTopology(payload, true); } catch (error) { blockers.push(error instanceof Error ? error.message : 'Ungültige Kursstruktur.'); return blockers; }
  if (!sanitizeTextServer(payload.title)) blockers.push('Kurstitel fehlt.');
  if (!sanitizeTextServer(payload.description)) blockers.push('Kursbeschreibung fehlt.');
  if (payload.imageUrl && !getSafeNavigationUrl(payload.imageUrl)) blockers.push('Ungültige Bildquelle.');
  if (payload.startDate && payload.endDate && new Date(payload.endDate) < new Date(payload.startDate)) blockers.push('Das Enddatum liegt vor dem Startdatum.');
  const children = new Set(payload.contents.map(row => row.parentId).filter((id): id is string => id !== null));
  const leaves = payload.contents.filter(row => !children.has(row.id));
  if (!leaves.length) blockers.push('Der Kurs braucht mindestens einen lernbaren Inhalt.');
  for (const node of payload.contents) {
    if (!sanitizeTextServer(node.title)) blockers.push(`Ein Inhalt ohne Titel ist vorhanden (${node.id}).`);
    const quiz = contentQuiz(asPublishedNode(node));
    if (children.has(node.id) && (node.type === 'QUIZ' || quiz || isQuizLikeContent(asPublishedNode(node)))) blockers.push(`Quiz darf keine Unterinhalte haben (${node.id}).`);
    if (!children.has(node.id)) {
      if (!node.content.trim()) blockers.push(`Ein lernbarer Inhalt ist leer (${node.id}).`);
      if (node.type === 'QUIZ' || isQuizLikeContent(asPublishedNode(node))) {
        if (!quiz || getQuizValidationError(quiz)) blockers.push(`Ein Quiz ist noch nicht bereit (${node.id}).`);
      } else if (node.content.trim()) {
        try { prepareContent(node.content, node.type); }
        catch { blockers.push(`Eine Medienquelle ist ungültig (${node.id}).`); }
      }
    }
  }
  return [...new Set(blockers)];
}

function impact(oldPayload: CoursePayload | null, payload: CoursePayload, enrolledLearners: number) {
  const previous = new Map((oldPayload?.contents ?? []).map(row => [row.id, row]));
  const next = new Map(payload.contents.map(row => [row.id, row]));
  const added = payload.contents.filter(row => !previous.has(row.id)).map(row => row.id);
  const removed = (oldPayload?.contents ?? []).filter(row => !next.has(row.id)).map(row => row.id);
  const changed = payload.contents.filter(row => {
    const before = previous.get(row.id);
    return before && courseContentRevision(asPublishedNode(before)) !== courseContentRevision(asPublishedNode(row));
  }).map(row => row.id);
  const renamedOrReordered = payload.contents.filter(row => {
    const before = previous.get(row.id);
    return before && (before.title !== row.title || before.parentId !== row.parentId || before.order !== row.order) && !changed.includes(row.id);
  }).map(row => row.id);
  const oldLeaves = new Set(courseLeaves((oldPayload?.contents ?? []).map(asPublishedNode)).map(row => row.id));
  const newLeaves = new Set(courseLeaves(payload.contents.map(asPublishedNode)).map(row => row.id));
  const completionMayChange = added.some(id => newLeaves.has(id)) || removed.some(id => oldLeaves.has(id)) ||
    changed.some(id => newLeaves.has(id) || oldLeaves.has(id)) ||
    [...oldLeaves].some(id => !newLeaves.has(id)) || [...newLeaves].some(id => !oldLeaves.has(id));
  const rewardsMayChange = courseQuizApprovalRevision((oldPayload?.contents ?? []).map(asPublishedNode)) !==
    courseQuizApprovalRevision(payload.contents.map(asPublishedNode)) || completionMayChange;
  return { added, removed, changed, renamedOrReordered, enrolledLearners, completionMayChange, rewardsMayChange, issuedCertificatesStayValid: true as const };
}

async function reviewed(tx: Prisma.TransactionClient, courseId: string, actor: Author, expectedRevision: number, expectedActive: string | null, origin?: string) {
  const course = await authorize(tx, courseId, actor);
  const draft = await ensureDraft(tx, course);
  if (draft.revision !== expectedRevision || course.activePublicationId !== expectedActive) throw new AuthoringError('Entwurf oder Veröffentlichung wurde geändert. Bitte neu laden.', 412);
  const payload = parsePayload(draft.payload);
  const blockers = publicationBlockers(payload);
  try { await checkReferences(tx, courseId, actor, payload, origin); }
  catch (error) { blockers.push(error instanceof Error ? error.message : 'Eine Datei ist nicht verfügbar.'); }
  const active = course.activePublicationId ? await tx.coursePublication.findUnique({ where: { id: course.activePublicationId } }) : null;
  if (course.activePublicationId && (!active || active.courseId !== courseId)) throw new AuthoringError('Kursveröffentlichung ist beschädigt.', 409);
  const oldPayload = active ? parsePayload(active.payload) : null;
  const enrolledLearners = await tx.enrollment.count({ where: { courseId } });
  return { course, draft, payload, active, ready: blockers.length === 0, blockers,
    impact: impact(oldPayload, payload, enrolledLearners), revision: draft.revision, digest: draft.digest,
    activePublicationId: course.activePublicationId };
}

function expectedActiveId(value: unknown): string | null {
  if (value === undefined) throw new AuthoringError('Aktive Veröffentlichungs-ID erforderlich.', 428);
  if (value === null) return null;
  if (!validId(value)) throw new AuthoringError('Ungültige Veröffentlichungs-ID.');
  return value;
}

export async function reviewPublication(courseId: string, actor: Author, expected: unknown, activeId: unknown, origin?: string) {
  const expectedRevision = requireRevision(expected);
  const expectedActive = expectedActiveId(activeId);
  return authoringTransaction(async tx => {
    const { ready, blockers, impact: changes, revision, digest, activePublicationId } = await reviewed(tx, courseId, actor, expectedRevision, expectedActive, origin);
    return { ready, blockers, impact: changes, revision, digest, activePublicationId };
  });
}

function publicationRequestDigest(actorId: string, revision: number, activeId: string | null) {
  return createHash('sha256').update(JSON.stringify([actorId, revision, activeId])).digest('hex');
}

async function materialize(tx: Prisma.TransactionClient, courseId: string, payload: CoursePayload) {
  const rows = await tx.courseContent.findMany({ where: { courseId }, select: {
    id: true, title: true, type: true, content: true, order: true, parentId: true, archivedAt: true,
  } });
  const prior = new Map(rows.map(row => [row.id, row]));
  const active = new Set(payload.contents.map(row => row.id));
  // Removed rows retain FK-backed learning evidence, but have no active edges.
  for (const row of rows) if (!active.has(row.id) && (!row.archivedAt || row.parentId !== null)) {
    await tx.courseContent.update({ where: { id: row.id }, data: { archivedAt: row.archivedAt ?? new Date(), parentId: null } });
  }
  for (const node of orderNodes(payload.contents)) {
    const storedType = node.type === 'QUIZ' ? 'TEXT' : node.type;
    const before = prior.get(node.id);
    if (!before) {
      await tx.courseContent.create({ data: { id: node.id, courseId, title: node.title, type: storedType,
        content: node.content, parentId: node.parentId, order: node.order } });
    } else {
      const data = {
        ...(before.title !== node.title && { title: node.title }),
        ...(before.type !== storedType && { type: storedType }),
        ...(before.content !== node.content && { content: node.content }),
        ...(before.parentId !== node.parentId && { parentId: node.parentId }),
        ...(before.order !== node.order && { order: node.order }),
        ...(before.archivedAt && { archivedAt: null }),
      };
      if (Object.keys(data).length) await tx.courseContent.update({ where: { id: node.id }, data });
    }
  }
  await tx.course.update({ where: { id: courseId }, data: {
    title: payload.title, description: payload.description, startDate: payload.startDate ? new Date(payload.startDate) : null,
    endDate: payload.endDate ? new Date(payload.endDate) : null, imageUrl: payload.imageUrl,
  } });
}

export async function publishDraft(courseId: string, actor: Author, expected: unknown, activeId: unknown, requestId: unknown, origin?: string) {
  const expectedRevision = requireRevision(expected);
  const expectedActive = expectedActiveId(activeId);
  if (!validId(requestId)) throw new AuthoringError('Ungültige Anforderungs-ID.');
  const requestDigest = publicationRequestDigest(actor.id, expectedRevision, expectedActive);
  const action = () => authoringTransaction(async tx => {
    // A retry of a committed request must survive a later, unrelated publication.
    await authorize(tx, courseId, actor);
    const existingReceipt = await tx.publicationRequest.findUnique({ where: { courseId_requestId: { courseId, requestId } } });
    if (existingReceipt) {
      if (existingReceipt.actorId !== actor.id || existingReceipt.requestDigest !== requestDigest) throw new AuthoringError('Anforderungs-ID wurde anders verwendet.', 409);
      const publication = await tx.coursePublication.findUnique({ where: { id: existingReceipt.publicationId }, select: { id: true, sequence: true, digest: true, courseId: true } });
      if (!publication || publication.courseId !== courseId) throw new AuthoringError('Veröffentlichungsbeleg ist beschädigt.', 409);
      return { publication: { id: publication.id, sequence: publication.sequence, digest: publication.digest },
        unchanged: publication.id === expectedActive };
    }
    const state = await reviewed(tx, courseId, actor, expectedRevision, expectedActive, origin);
    if (!state.ready) throw new AuthoringError(`Veröffentlichung blockiert: ${state.blockers.join(' ')}`, 409);
    if (state.active?.digest === state.draft.digest) {
      await tx.publicationRequest.create({ data: { courseId, requestId, actorId: actor.id,
        requestDigest, publicationId: state.active.id } });
      return { publication: { id: state.active.id, sequence: state.active.sequence, digest: state.active.digest }, unchanged: true };
    }
    const publication = await tx.coursePublication.create({ data: {
      id: randomUUID(), courseId, sequence: (state.active?.sequence ?? 0) + 1,
      previousPublicationId: state.active?.id ?? null, actorId: actor.id,
      source: state.draft.basePublicationId && state.draft.basePublicationId !== state.active?.id ? 'RESTORE' : 'AUTHOR',
      payload: state.draft.payload, digest: state.draft.digest, contentCount: state.payload.contents.length,
    } });
    await materialize(tx, courseId, state.payload);
    await tx.course.update({ where: { id: courseId }, data: { activePublicationId: publication.id } });
    await reconcileCourseRewards(tx, courseId);
    await tx.courseDraft.update({ where: { courseId }, data: { basePublicationId: publication.id } });
    await tx.publicationRequest.create({ data: { courseId, requestId, actorId: actor.id,
      requestDigest, publicationId: publication.id } });
    return { publication: { id: publication.id, sequence: publication.sequence, digest: publication.digest }, unchanged: false };
  });
  try { return await action(); }
  catch (error) {
    // A concurrent duplicate can lose at the receipt's compound unique key.
    // Only recover that exact receipt, never an unrelated uniqueness failure.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    return authoringTransaction(async tx => {
      await authorize(tx, courseId, actor);
      const receipt = await tx.publicationRequest.findUnique({ where: { courseId_requestId: { courseId, requestId } } });
      if (!receipt || receipt.actorId !== actor.id || receipt.requestDigest !== requestDigest) throw error;
      const publication = await tx.coursePublication.findUnique({ where: { id: receipt.publicationId },
        select: { id: true, sequence: true, digest: true, courseId: true } });
      if (!publication || publication.courseId !== courseId) throw error;
      return { publication: { id: publication.id, sequence: publication.sequence, digest: publication.digest },
        unchanged: publication.id === expectedActive };
    });
  }
}
