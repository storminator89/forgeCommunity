import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { getQuizValidationError } from '@/app/courses/[courseId]/contents/types';
import { getAssignmentValidationError } from '@/app/courses/[courseId]/contents/assignment-content';
import { h5pAttachmentId } from '@/lib/server/h5p-access';
import { CourseAssetError, extractCourseAssetUrls, parseCourseAssetUrl } from '@/lib/server/course-assets';
import { contentQuiz, courseContentRevision, courseLeaves, isQuizLikeContent } from '@/lib/server/course-progress';
import { courseAssignmentApprovalRevision, courseQuizApprovalRevision } from '@/lib/server/rewards';
import { prepareContent } from '@/app/api/courses/[courseId]/contents/content-mutations';
import { sanitizeTextServer } from '@/lib/server/sanitize-html';
import { getSafeNavigationUrl } from '@/lib/security';
import { CoursePathError, validateCoursePath } from '@/lib/server/course-path';
import { chapterReleaseDates, isChapterReleaseDate } from '@/lib/course-release';
import { listD1AuthorDrafts, readD1AuthorDraft, type D1AuthorDraftRow } from '@/lib/server/d1-course-drafts';
import { publishD1CourseDraft, readD1AuthorHistory, readD1AuthorReferences, readD1PublicationReceipt, readD1RestorePublication, writeD1CourseDraft, type D1CourseReferences, type D1ReferenceFlags, type D1PublicationReceipt } from '@/lib/server/d1-course-authoring';
import { H5PValidationError } from '@/lib/server/h5p-archive';
import { d1RewardNodes } from '@/lib/server/d1-course-rewards';

export type Author = { id: string; role?: string | null };
export type DraftNode = { id: string; parentId: string | null; title: string; type: 'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P' | 'QUIZ' | 'ASSIGNMENT' | null; content: string; order: number; prerequisiteIds?: string[]; releaseOn?: string };
export type CoursePayload = { schemaVersion: 1; title: string; description: string; startDate: string | null; endDate: string | null; imageUrl: string | null; contents: DraftNode[] };
export type AuthorOperation =
  | { kind: 'setMetadata'; patch: Partial<Pick<CoursePayload, 'title' | 'description' | 'startDate' | 'endDate' | 'imageUrl'>> }
  | { kind: 'insertNode'; node: Pick<DraftNode, 'id' | 'title' | 'type' | 'content'>; parentId: string | null; afterId: string | null }
  | { kind: 'updateNode'; id: string; patch: Partial<Pick<DraftNode, 'title' | 'type' | 'content'>> }
  | { kind: 'moveNode'; id: string; parentId: string | null; afterId: string | null }
  | { kind: 'setPrerequisites'; id: string; prerequisiteIds: string[] }
  | { kind: 'setReleaseOn'; id: string; releaseOn: string | null }
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
        ![null, 'TEXT', 'VIDEO', 'AUDIO', 'H5P', 'QUIZ', 'ASSIGNMENT'].includes(node.type) ||
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
  try { validateCoursePath(payload.contents); }
  catch (error) { if (error instanceof CoursePathError) throw new AuthoringError(error.message, error.status); throw error; }
}

function canonical(payload: CoursePayload): CoursePayload {
  return {
    schemaVersion: 1, title: payload.title, description: payload.description,
    startDate: payload.startDate, endDate: payload.endDate, imageUrl: payload.imageUrl,
    contents: payload.contents.map(node => ({ id: node.id, parentId: node.parentId, title: node.title, type: node.type, content: node.content, order: node.order,
      ...(node.prerequisiteIds !== undefined && { prerequisiteIds: [...node.prerequisiteIds] }),
      ...(node.releaseOn !== undefined && { releaseOn: node.releaseOn }) })),
  };
}

function asPublishedNode(node: DraftNode) {
  return { ...node, courseId: '', type: node.type === 'QUIZ' ? 'TEXT' : node.type };
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
        ![null, 'TEXT', 'VIDEO', 'AUDIO', 'H5P', 'QUIZ', 'ASSIGNMENT'].includes(node.type as string | null) ||
        (op.parentId !== null && !validId(op.parentId)) || (op.afterId !== null && !validId(op.afterId))) {
      throw new AuthoringError('Ungültiger neuer Kursinhalt.');
    }
    return op as AuthorOperation;
  }
  if (op.kind === 'updateNode') {
    const patch = op.patch as Record<string, unknown> | undefined;
    if (!validId(op.id) || !patch || !Object.keys(patch).length || Object.entries(patch).some(([key, val]) =>
      !['title', 'type', 'content'].includes(key) ||
      (key === 'type' ? ![null, 'TEXT', 'VIDEO', 'AUDIO', 'H5P', 'QUIZ', 'ASSIGNMENT'].includes(val as string | null) : typeof val !== 'string'))) {
      throw new AuthoringError('Ungültige Kursinhalt-Änderung.');
    }
    return op as AuthorOperation;
  }
  if (op.kind === 'moveNode') {
    if (!validId(op.id) || (op.parentId !== null && !validId(op.parentId)) || (op.afterId !== null && !validId(op.afterId))) throw new AuthoringError('Ungültige Verschiebung.');
    return op as AuthorOperation;
  }
  if (op.kind === 'setPrerequisites') {
    if (!validId(op.id) || !Array.isArray(op.prerequisiteIds) || op.prerequisiteIds.length > 20 ||
        op.prerequisiteIds.some(id => !validId(id)) || new Set(op.prerequisiteIds).size !== op.prerequisiteIds.length) {
      throw new AuthoringError('Ungültige Lernvoraussetzungen.');
    }
    return op as AuthorOperation;
  }
  if (op.kind === 'setReleaseOn') {
    if (!validId(op.id) || (op.releaseOn !== null && !isChapterReleaseDate(op.releaseOn))) {
      throw new AuthoringError('Ungültiges Freigabedatum. Verwende JJJJ-MM-TT (00:00 UTC).');
    }
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
    // A moved chapter inherits its destination root, including an immediate
    // release. Never leave a hidden date on a non-root for a later move back.
    if (destination !== null) delete node.releaseOn;
    if (oldParent !== destination) {
      next.contents.filter(row => row.parentId === oldParent).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).forEach((row, index) => { row.order = index + 1; });
    }
  } else if (operation.kind === 'setPrerequisites') {
    const node = next.contents.find(row => row.id === operation.id);
    if (!node) throw new AuthoringError('Inhalt nicht gefunden.', 404);
    node.prerequisiteIds = [...operation.prerequisiteIds];
  } else if (operation.kind === 'setReleaseOn') {
    const node = next.contents.find(row => row.id === operation.id);
    if (!node) throw new AuthoringError('Inhalt nicht gefunden.', 404);
    if (node.parentId !== null) throw new AuthoringError('Die Freigabe wird im Kapitel der obersten Ebene festgelegt.');
    if (operation.releaseOn === null) delete node.releaseOn;
    else node.releaseOn = operation.releaseOn;
  } else {
    if (!next.contents.some(row => row.id === operation.id)) throw new AuthoringError('Inhalt nicht gefunden.', 404);
    const removed = new Set([operation.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of next.contents) if (row.parentId && removed.has(row.parentId) && !removed.has(row.id)) { removed.add(row.id); changed = true; }
    }
    const oldParent = next.contents.find(row => row.id === operation.id)!.parentId;
    const dependent = next.contents.find(row => !removed.has(row.id) && row.prerequisiteIds?.some(id => removed.has(id)));
    if (dependent) throw new AuthoringError(`„${dependent.title}“ benötigt einen zu löschenden Inhalt. Entferne zuerst diese Lernvoraussetzung.`, 409);
    next.contents = next.contents.filter(row => !removed.has(row.id));
    next.contents.filter(row => row.parentId === oldParent).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).forEach((row, index) => { row.order = index + 1; });
  }
  checkTopology(next);
  payloadJson(next);
  return next;
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
  const row = await readD1AuthorDraft(courseId, actor);
  if (!row) throw new AuthoringError('Kurs nicht gefunden.', 404);
  return d1DraftDto(row);
}

function d1DraftDto(row: D1AuthorDraftRow) {
  if (row.revision === null || row.digest === null || row.payload === null) {
    throw new AuthoringError('Kursentwurf fehlt. Bitte Einrichtung prüfen.', 409);
  }
  if (row.activePublicationId && (!row.publicationId || row.publicationCourseId !== row.id)) {
    throw new AuthoringError('Kursveröffentlichung ist beschädigt.', 409);
  }
  const activePublication = row.publicationId ? {
    id: row.publicationId, sequence: row.publicationSequence!, digest: row.publicationDigest!,
  } : null;
  return { draft: draftDto({ revision: row.revision, digest: row.digest, payload: row.payload }), activePublication };
}

export async function listAuthorCourses(actor: Author) {
  const { accountExists, rows } = await listD1AuthorDrafts(actor.id);
  if (!accountExists) throw new AuthoringError('Kein Zugriff auf Kurse.', 403);
  return { courses: rows.map(row => {
    const { draft, activePublication } = d1DraftDto(row);
    return { id: row.id, title: draft.payload.title, revision: draft.revision, activePublication,
      hasUnpublishedChanges: !activePublication || draft.digest !== activePublication.digest };
  }) };
}

async function currentD1AuthorState(courseId: string, actor: Author) {
  const state = await readD1AuthorDraft(courseId, actor);
  if (!state) throw new AuthoringError('Kurs nicht gefunden.', 404);
  d1DraftDto(state);
  return state;
}

function d1References(courseId: string, payload: CoursePayload, origin?: string, previous?: CoursePayload): D1CourseReferences {
  const oldAssets = new Set(previous ? extractCourseAssetUrls(previous) : []);
  const assetIds = extractCourseAssetUrls(payload).filter(url => !oldAssets.has(url)).map(url => {
    const asset = parseCourseAssetUrl(url)!;
    if (asset.courseId !== courseId) throw new CourseAssetError('Kursdatei gehört zu einem anderen Kurs.', 403);
    return asset.assetId;
  });
  const prior = new Map(previous?.contents.map(node => [node.id, node]));
  const h5pIds = payload.contents.flatMap(node => {
    const old = prior.get(node.id);
    if (node.type !== 'H5P' || !node.content || (old?.type === node.type && old.content === node.content)) return [];
    const id = h5pAttachmentId(node.content, origin);
    return id ? [id] : [];
  });
  return { contentIds: payload.contents.map(node => node.id), assetIds: [...new Set(assetIds)], h5pIds: [...new Set(h5pIds)] };
}

function assertD1ReferenceFlags(flags: D1ReferenceFlags) {
  if (flags.foreignContent) throw new AuthoringError('Inhalt-ID gehört zu einem anderen Kurs.', 409);
  if (flags.missingAsset) throw new CourseAssetError('Kursdatei nicht gefunden.', 404);
  if (flags.missingH5p) throw new H5PValidationError('Der lokale H5P-Inhalt wurde nicht importiert.', 400);
  if (flags.foreignH5p) throw new H5PValidationError('Nur eigene H5P-Inhalte dürfen neu verknüpft werden.', 403);
}

function draftChanged(): never {
  throw new AuthoringError('Entwurf oder Veröffentlichung wurde geändert. Bitte neu laden.', 412);
}

const noReferences: D1CourseReferences = { contentIds: [], assetIds: [], h5pIds: [] };

export async function mutateDraft(courseId: string, actor: Author, expected: unknown, operationInput: unknown, origin?: string) {
  const expectedRevision = requireRevision(expected);
  const operation = operationFromUnknown(operationInput);
  const state = await currentD1AuthorState(courseId, actor);
  if (state.revision !== expectedRevision) draftChanged();
  const current = parsePayload(state.payload!);
  const payload = applyOperation(current, operation);
  const references = d1References(courseId, payload, origin, current);
  const checked = await readD1AuthorReferences(courseId, actor, state, references);
  if (!checked) draftChanged();
  assertD1ReferenceFlags(checked);
  const updated = await writeD1CourseDraft(courseId, actor, state,
    { payload: payloadJson(payload), digest: publicationDigest(payload) }, references);
  if (!updated) draftChanged();
  return d1DraftDto(updated);
}

export async function discardDraft(courseId: string, actor: Author, expected: unknown) {
  const expectedRevision = requireRevision(expected);
  const state = await currentD1AuthorState(courseId, actor);
  if (state.revision !== expectedRevision) draftChanged();
  const reset: CoursePayload = state.activePublicationId ? parsePayload(state.publicationPayload!)
    : { schemaVersion: 1, title: '', description: '', startDate: null, endDate: null, imageUrl: null, contents: [] };
  const updated = await writeD1CourseDraft(courseId, actor, state, {
    payload: payloadJson(reset), digest: publicationDigest(reset), basePublicationId: state.activePublicationId,
  }, noReferences);
  if (!updated) draftChanged();
  return d1DraftDto(updated);
}

export async function listHistory(courseId: string, actor: Author) {
  const publications = await readD1AuthorHistory(courseId, actor);
  if (!publications) throw new AuthoringError('Kurs nicht gefunden.', 404);
  return { publications: publications.map(row => ({ ...row, recordedAt: new Date(row.recordedAt) })) };
}

export async function restoreDraft(courseId: string, actor: Author, expected: unknown, publicationId: unknown) {
  const expectedRevision = requireRevision(expected);
  if (!validId(publicationId)) throw new AuthoringError('Ungültige Veröffentlichungs-ID.');
  const state = await currentD1AuthorState(courseId, actor);
  if (state.revision !== expectedRevision) draftChanged();
  const publication = await readD1RestorePublication(courseId, actor, publicationId);
  if (!publication) throw new AuthoringError('Veröffentlichung nicht gefunden.', 404);
  const payload = parsePayload(publication.payload);
  const updated = await writeD1CourseDraft(courseId, actor, state, {
    payload: payloadJson(payload), digest: publication.digest, basePublicationId: publication.id,
  }, noReferences);
  if (!updated) draftChanged();
  return d1DraftDto(updated);
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
    if (children.has(node.id) && node.type === 'ASSIGNMENT') blockers.push(`Aufgabe darf keine Unterinhalte haben (${node.id}).`);
    if (children.has(node.id) && (node.type === 'QUIZ' || quiz || isQuizLikeContent(asPublishedNode(node)))) blockers.push(`Quiz darf keine Unterinhalte haben (${node.id}).`);
    if (!children.has(node.id)) {
      if (!node.content.trim()) blockers.push(`Ein lernbarer Inhalt ist leer (${node.id}).`);
      if (node.type === 'ASSIGNMENT') {
        if (getAssignmentValidationError(node.content)) blockers.push(`Eine Aufgabe ist noch nicht bereit (${node.id}).`);
      } else if (node.type === 'QUIZ' || isQuizLikeContent(asPublishedNode(node))) {
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
  const prerequisitesChanged = payload.contents.filter(row => {
    const before = previous.get(row.id);
    return before && JSON.stringify(before.prerequisiteIds ?? []) !== JSON.stringify(row.prerequisiteIds ?? []);
  }).map(row => row.id);
  const beforeRelease = chapterReleaseDates(oldPayload?.contents ?? []);
  const afterRelease = chapterReleaseDates(payload.contents);
  const releaseScheduleChanged = payload.contents.filter(row =>
    (beforeRelease.get(row.id) ?? null) !== (afterRelease.get(row.id) ?? null)).map(row => ({ id: row.id, title: row.title,
      before: beforeRelease.get(row.id) ?? null, after: afterRelease.get(row.id) ?? null }));
  const oldLeaves = new Set(courseLeaves((oldPayload?.contents ?? []).map(asPublishedNode)).map(row => row.id));
  const newLeaves = new Set(courseLeaves(payload.contents.map(asPublishedNode)).map(row => row.id));
  const completionMayChange = prerequisitesChanged.length > 0 || added.some(id => newLeaves.has(id)) || removed.some(id => oldLeaves.has(id)) ||
    changed.some(id => newLeaves.has(id) || oldLeaves.has(id)) ||
    [...oldLeaves].some(id => !newLeaves.has(id)) || [...newLeaves].some(id => !oldLeaves.has(id));
  const rewardsMayChange = courseQuizApprovalRevision((oldPayload?.contents ?? []).map(asPublishedNode)) !==
    courseQuizApprovalRevision(payload.contents.map(asPublishedNode)) || completionMayChange;
  return { added, removed, changed, renamedOrReordered, prerequisitesChanged, releaseScheduleChanged, enrolledLearners, completionMayChange, rewardsMayChange, issuedCertificatesStayValid: true as const };
}

function expectedActiveId(value: unknown): string | null {
  if (value === undefined) throw new AuthoringError('Aktive Veröffentlichungs-ID erforderlich.', 428);
  if (value === null) return null;
  if (!validId(value)) throw new AuthoringError('Ungültige Veröffentlichungs-ID.');
  return value;
}

async function reviewedD1(courseId: string, actor: Author, expectedRevision: number, expectedActive: string | null, origin?: string) {
  const state = await currentD1AuthorState(courseId, actor);
  if (state.revision !== expectedRevision || state.activePublicationId !== expectedActive) draftChanged();
  const payload = parsePayload(state.payload!);
  const blockers = publicationBlockers(payload);
  let references = noReferences;
  try { references = d1References(courseId, payload, origin); }
  catch (error) { blockers.push(error instanceof Error ? error.message : 'Eine Datei ist nicht verfügbar.'); }
  const checked = await readD1AuthorReferences(courseId, actor, state, references);
  if (!checked) draftChanged();
  try { assertD1ReferenceFlags(checked); }
  catch (error) { blockers.push(error instanceof Error ? error.message : 'Eine Datei ist nicht verfügbar.'); }
  const active = state.publicationId ? { id: state.publicationId, sequence: state.publicationSequence!,
    digest: state.publicationDigest!, payload: state.publicationPayload! } : null;
  const oldPayload = active ? parsePayload(active.payload) : null;
  return { state, payload, active, references, ready: blockers.length === 0, blockers,
    impact: impact(oldPayload, payload, checked.enrolledLearners), revision: state.revision!, digest: state.digest!,
    activePublicationId: state.activePublicationId };
}

export async function reviewPublication(courseId: string, actor: Author, expected: unknown, activeId: unknown, origin?: string) {
  const expectedRevision = requireRevision(expected);
  const expectedActive = expectedActiveId(activeId);
  const { ready, blockers, impact: changes, revision, digest, activePublicationId } =
    await reviewedD1(courseId, actor, expectedRevision, expectedActive, origin);
  return { ready, blockers, impact: changes, revision, digest, activePublicationId };
}

function publicationRequestDigest(actorId: string, revision: number, activeId: string | null) {
  return createHash('sha256').update(JSON.stringify([actorId, revision, activeId])).digest('hex');
}

function publicationReceiptResult(courseId: string, actor: Author, requestDigest: string, expectedActive: string | null, receipt: D1PublicationReceipt) {
  if (receipt.actorId !== actor.id || receipt.requestDigest !== requestDigest) throw new AuthoringError('Anforderungs-ID wurde anders verwendet.', 409);
  if (receipt.publicationCourseId !== courseId || receipt.sequence === null || receipt.digest === null) {
    throw new AuthoringError('Veröffentlichungsbeleg ist beschädigt.', 409);
  }
  return { publication: { id: receipt.publicationId, sequence: receipt.sequence, digest: receipt.digest },
    unchanged: receipt.publicationId === expectedActive };
}

export async function publishDraft(courseId: string, actor: Author, expected: unknown, activeId: unknown, requestId: unknown, origin?: string) {
  const expectedRevision = requireRevision(expected);
  const expectedActive = expectedActiveId(activeId);
  if (!validId(requestId)) throw new AuthoringError('Ungültige Anforderungs-ID.');
  const requestDigest = publicationRequestDigest(actor.id, expectedRevision, expectedActive);
  const replay = await readD1PublicationReceipt(courseId, actor, requestId);
  if (replay) return publicationReceiptResult(courseId, actor, requestDigest, expectedActive, replay);
  let receipt: D1PublicationReceipt | null;
  try {
    const reviewed = await reviewedD1(courseId, actor, expectedRevision, expectedActive, origin);
    if (!reviewed.ready) throw new AuthoringError(`Veröffentlichung blockiert: ${reviewed.blockers.join(' ')}`, 409);
    const previousContents = reviewed.active ? parsePayload(reviewed.active.payload).contents.map(asPublishedNode) : [];
    const currentContents = reviewed.payload.contents.map(asPublishedNode);
    const assignmentScoringChanged = courseAssignmentApprovalRevision(previousContents) !== courseAssignmentApprovalRevision(currentContents);
    receipt = await publishD1CourseDraft({ courseId, actor, state: reviewed.state, payload: reviewed.payload,
      references: reviewed.references, requestId, requestDigest, publicationId: randomUUID(),
      nodes: d1RewardNodes(currentContents), scoringChangeReason: assignmentScoringChanged ? 'LEARNING_CHANGED' : 'QUIZ_REVISED',
      unchanged: reviewed.active?.digest === reviewed.state.digest });
  } catch (error) {
    // D1 rolls back a failed batch. An ambiguous response or a concurrent
    // duplicate is recovered only through this request's exact durable receipt.
    const saved = await readD1PublicationReceipt(courseId, actor, requestId);
    if (!saved || saved.actorId !== actor.id || saved.requestDigest !== requestDigest) throw error;
    receipt = saved;
  }
  if (!receipt) draftChanged();
  return publicationReceiptResult(courseId, actor, requestDigest, expectedActive, receipt);
}
