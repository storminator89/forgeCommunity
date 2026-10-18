import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import prisma from '@/lib/prisma';
import { parseQuizContent } from '@/app/courses/[courseId]/contents/types';
import { createObjectiveNative, reviseObjectiveNative, createItemNative, reviseItemNative, readDraftNative, saveDraftNative, publishDraftNative } from '@/lib/server/d1-formative-practice-authoring-mutations';

export type PracticeActor = { id: string; role?: string | null };
export type PracticeChoice = { schemaVersion: 1; type: 'SINGLE_CHOICE'; prompt: string; options: string[]; correctIndex: number; explanation: string };
export type PracticeRef = { objectiveId: string; objectiveRevision: number; itemId: string; itemRevision: number };
type PracticeDraftPayload = { schemaVersion: 1; items: PracticeRef[] };
type PracticeSnapshotItem = PracticeRef & { objectiveTitle: string; objectiveDescription: string } & PracticeChoice;

export class PracticeError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

const privateId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(value);
const revision = (value: unknown, allowZero = false): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1);
const MAX_ITEMS = 100;
const POOL_PAGE_SIZE = 100;
type PoolCursor = { updatedAt: Date; id: string };

function decodePoolCursor(value: string | null): PoolCursor | null {
  if (value === null) return null;
  if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new PracticeError('Ungültiger Seitencursor.');
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); }
  catch { throw new PracticeError('Ungültiger Seitencursor.'); }
  if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(parsed[0]) ||
      !Number.isFinite(Date.parse(parsed[0])) || !privateId(parsed[1])) throw new PracticeError('Ungültiger Seitencursor.');
  return { updatedAt: new Date(parsed[0]), id: parsed[1] };
}

function encodePoolCursor(row: PoolCursor) {
  return Buffer.from(JSON.stringify([row.updatedAt.toISOString(), row.id])).toString('base64url');
}

function olderThan(cursor: PoolCursor | null) {
  return cursor ? { OR: [{ updatedAt: { lt: cursor.updatedAt } },
    { updatedAt: cursor.updatedAt, id: { lt: cursor.id } }] } : {};
}

function boundedText(value: unknown, max: number, field: string, required = true): string {
  if (typeof value !== 'string' || value.length > max) throw new PracticeError(`${field} ist ungültig.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new PracticeError(`${field} fehlt.`);
  return trimmed;
}

/** Only a plain-text, single-choice contract is accepted; ignore no extra data. */
export function practiceChoiceFromInput(value: unknown): PracticeChoice {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PracticeError('Ungültige Übungsfrage.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['type', 'prompt', 'options', 'correctIndex', 'explanation'].includes(key)) ||
      input.type !== 'SINGLE_CHOICE' || !Array.isArray(input.options) ||
      input.options.length < 2 || input.options.length > 8 || !revision(input.correctIndex, true) ||
      input.correctIndex >= input.options.length) throw new PracticeError('Ungültige Single-Choice-Übungsfrage.');
  const prompt = boundedText(input.prompt, 3000, 'Fragetext');
  const options = input.options.map(option => boundedText(option, 1000, 'Antwortmöglichkeit'));
  if (new Set(options.map(normalizeOverlapText)).size !== options.length) throw new PracticeError('Antwortmöglichkeiten müssen verschieden sein.');
  const explanation = boundedText(input.explanation ?? '', 3000, 'Erklärung', false);
  const choice: PracticeChoice = { schemaVersion: 1, type: 'SINGLE_CHOICE', prompt, options, correctIndex: input.correctIndex, explanation };
  if (Buffer.byteLength(JSON.stringify(choice), 'utf8') > 16 * 1024) throw new PracticeError('Übungsfrage ist zu groß.', 413);
  return choice;
}

function parseChoice(value: string): PracticeChoice {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new PracticeError('Übungsrevision ist beschädigt.', 409); }
  if (!parsed || typeof parsed !== 'object' || (parsed as { schemaVersion?: unknown }).schemaVersion !== 1) throw new PracticeError('Übungsrevision ist beschädigt.', 409);
  const { schemaVersion: _schemaVersion, ...input } = parsed as Record<string, unknown>;
  try { return practiceChoiceFromInput(input); } catch { throw new PracticeError('Übungsrevision ist beschädigt.', 409); }
}

function parseDraft(value: string): PracticeDraftPayload {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new PracticeError('Übungsentwurf ist beschädigt.', 409); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      (parsed as { schemaVersion?: unknown }).schemaVersion !== 1 ||
      !Array.isArray((parsed as { items?: unknown }).items)) throw new PracticeError('Übungsentwurf ist beschädigt.', 409);
  return { schemaVersion: 1, items: practiceRefs((parsed as PracticeDraftPayload).items) };
}

function practiceRefs(value: unknown): PracticeRef[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new PracticeError('Zu viele oder ungültige Übungsreferenzen.');
  const refs: PracticeRef[] = value.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new PracticeError('Ungültige Übungsreferenz.');
    const ref = entry as Record<string, unknown>;
    if (Object.keys(ref).sort().join(',') !== 'itemId,itemRevision,objectiveId,objectiveRevision' ||
        !privateId(ref.objectiveId) || !revision(ref.objectiveRevision) ||
        !privateId(ref.itemId) || !revision(ref.itemRevision)) throw new PracticeError('Ungültige Übungsreferenz.');
    return { objectiveId: ref.objectiveId, objectiveRevision: ref.objectiveRevision,
      itemId: ref.itemId, itemRevision: ref.itemRevision };
  });
  if (new Set(refs.map(ref => ref.itemId)).size !== refs.length) throw new PracticeError('Übungsfragen dürfen nicht doppelt vorkommen.');
  return refs;
}

async function transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 }); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
      if (attempt >= 3) throw new PracticeError('Gleichzeitige Änderung. Bitte neu laden.', 409);
    }
  }
}

async function assertAuthor(tx: Prisma.TransactionClient, actor: PracticeActor) {
  const user = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true } });
  if (!user || (user.role !== 'INSTRUCTOR' && user.role !== 'ADMIN')) throw new PracticeError('Kein Zugriff auf Übungsautorenschaft.', 403);
  return user;
}

async function assertCourseAuthor(tx: Prisma.TransactionClient, courseId: string, actor: PracticeActor) {
  if (!privateId(courseId)) throw new PracticeError('Kurs nicht gefunden.', 404);
  const [user, course] = await Promise.all([
    assertAuthor(tx, actor),
    tx.course.findUnique({ where: { id: courseId }, select: { id: true, instructorId: true, activePublicationId: true } }),
  ]);
  if (!course) throw new PracticeError('Kurs nicht gefunden.', 404);
  if (course.instructorId !== actor.id && user.role !== 'ADMIN') throw new PracticeError('Kein Zugriff auf den Kurs.', 403);
  return course;
}

export async function listPracticeObjectives(actor: PracticeActor, cursorValue: string | null = null) {
  const cursor = decodePoolCursor(cursorValue);
  return transaction(async tx => {
    await assertAuthor(tx, actor);
    const rows = await tx.practiceObjective.findMany({ where: { ownerId: actor.id, ...olderThan(cursor) }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: POOL_PAGE_SIZE + 1,
      select: { id: true, title: true, description: true, revision: true, updatedAt: true } });
    const objectives = rows.slice(0, POOL_PAGE_SIZE);
    return { objectives, nextCursor: rows.length > POOL_PAGE_SIZE ? encodePoolCursor(objectives[objectives.length - 1]) : null };
  });
}

export async function createPracticeObjective(actor: PracticeActor, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PracticeError('Ungültiges Lernziel.');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(key => !['title', 'description'].includes(key))) throw new PracticeError('Ungültiges Lernziel.');
  const title = boundedText(body.title, 300, 'Lernziel');
  const description = boundedText(body.description ?? '', 3000, 'Beschreibung', false);
  return createObjectiveNative(actor, title, description);
}

export async function getPracticeObjective(actor: PracticeActor, objectiveId: string) {
  if (!privateId(objectiveId)) throw new PracticeError('Lernziel nicht gefunden.', 404);
  return transaction(async tx => {
    await assertAuthor(tx, actor);
    const row = await tx.practiceObjective.findFirst({ where: { id: objectiveId, ownerId: actor.id },
      select: { id: true, title: true, description: true, revision: true, updatedAt: true } });
    if (!row) throw new PracticeError('Lernziel nicht gefunden.', 404);
    return row;
  });
}

export async function revisePracticeObjective(actor: PracticeActor, objectiveId: string, expectedRevision: unknown, input: unknown) {
  if (!privateId(objectiveId)) throw new PracticeError('Lernziel nicht gefunden.', 404);
  if (!revision(expectedRevision)) throw new PracticeError('Lernzielrevision erforderlich.', 428);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PracticeError('Ungültiges Lernziel.');
  const body = input as Record<string, unknown>;
  if (!Object.keys(body).length || Object.keys(body).some(key => !['title', 'description'].includes(key))) throw new PracticeError('Ungültiges Lernziel.');
  const title = body.title === undefined ? undefined : boundedText(body.title, 300, 'Lernziel');
  const description = body.description === undefined ? undefined : boundedText(body.description, 3000, 'Beschreibung', false);
  return reviseObjectiveNative(actor, objectiveId, expectedRevision, title, description);
}

export async function listPracticeItems(actor: PracticeActor, objectiveId: string, cursorValue: string | null = null) {
  if (!privateId(objectiveId)) throw new PracticeError('Lernziel nicht gefunden.', 404);
  const cursor = decodePoolCursor(cursorValue);
  return transaction(async tx => {
    await assertAuthor(tx, actor);
    const objective = await tx.practiceObjective.findFirst({ where: { id: objectiveId, ownerId: actor.id }, select: { id: true } });
    if (!objective) throw new PracticeError('Lernziel nicht gefunden.', 404);
    const rows = await tx.practiceItem.findMany({ where: { ownerId: actor.id, objectiveId, ...olderThan(cursor) }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: POOL_PAGE_SIZE + 1,
      select: { id: true, objectiveId: true, latestRevision: true, updatedAt: true,
        revisions: { orderBy: { revision: 'desc' }, take: 1, select: { payload: true } } } });
    const items = rows.slice(0, POOL_PAGE_SIZE);
    return { items: items.map(item => ({ id: item.id, objectiveId: item.objectiveId, latestRevision: item.latestRevision,
      updatedAt: item.updatedAt, prompt: parseChoice(item.revisions[0].payload).prompt })),
      nextCursor: rows.length > POOL_PAGE_SIZE ? encodePoolCursor(items[items.length - 1]) : null };
  });
}

export async function createPracticeItem(actor: PracticeActor, objectiveId: string, input: unknown) {
  if (!privateId(objectiveId)) throw new PracticeError('Lernziel nicht gefunden.', 404);
  const choice = practiceChoiceFromInput(input);
  return createItemNative(actor, objectiveId, choice);
}

export async function getPracticeItem(actor: PracticeActor, itemId: string) {
  if (!privateId(itemId)) throw new PracticeError('Übungsfrage nicht gefunden.', 404);
  return transaction(async tx => {
    await assertAuthor(tx, actor);
    const row = await tx.practiceItem.findFirst({ where: { id: itemId, ownerId: actor.id }, select: {
      id: true, objectiveId: true, latestRevision: true, updatedAt: true,
      revisions: { orderBy: { revision: 'desc' }, take: 1, select: { payload: true } },
    } });
    if (!row) throw new PracticeError('Übungsfrage nicht gefunden.', 404);
    return { id: row.id, objectiveId: row.objectiveId, latestRevision: row.latestRevision,
      updatedAt: row.updatedAt, prompt: parseChoice(row.revisions[0].payload).prompt };
  });
}

export async function getPracticeItemRevision(actor: PracticeActor, itemId: string, itemRevision: number) {
  if (!privateId(itemId) || !revision(itemRevision)) throw new PracticeError('Übungsfrage nicht gefunden.', 404);
  return transaction(async tx => {
    await assertAuthor(tx, actor);
    const row = await tx.practiceItemRevision.findFirst({ where: { itemId, revision: itemRevision, item: { ownerId: actor.id } },
      select: { itemId: true, revision: true, payload: true, createdAt: true } });
    if (!row) throw new PracticeError('Übungsfrage nicht gefunden.', 404);
    return { itemId: row.itemId, revision: row.revision, choice: parseChoice(row.payload), createdAt: row.createdAt };
  });
}

export async function revisePracticeItem(actor: PracticeActor, itemId: string, expectedRevision: unknown, input: unknown) {
  if (!privateId(itemId)) throw new PracticeError('Übungsfrage nicht gefunden.', 404);
  if (!revision(expectedRevision)) throw new PracticeError('Übungsrevision erforderlich.', 428);
  const choice = practiceChoiceFromInput(input);
  return reviseItemNative(actor, itemId, expectedRevision, choice);
}

export async function readPracticeDraft(courseId: string, actor: PracticeActor) {
  return readDraftNative(courseId, actor, parseDraft);
}

export async function savePracticeDraft(courseId: string, actor: PracticeActor, expectedRevision: unknown, items: unknown) {
  if (!revision(expectedRevision, true)) throw new PracticeError('Entwurfsrevision erforderlich.', 428);
  const payload: PracticeDraftPayload = { schemaVersion: 1, items: practiceRefs(items) };
  const json = JSON.stringify(payload);
  if (Buffer.byteLength(json, 'utf8') > 32 * 1024) throw new PracticeError('Übungsentwurf ist zu groß.', 413);
  return saveDraftNative(courseId, actor, expectedRevision, payload, json, parseChoice);
}

async function resolveRefs(tx: Prisma.TransactionClient, ownerId: string, refs: PracticeRef[]): Promise<PracticeSnapshotItem[]> {
  if (!refs.length) return [];
  const rows = await tx.practiceItemRevision.findMany({ where: {
    OR: refs.map(ref => ({ itemId: ref.itemId, revision: ref.itemRevision })),
    item: { ownerId, objective: { ownerId } },
  }, select: { itemId: true, revision: true, payload: true,
    item: { select: { objectiveId: true, objective: { select: { title: true, description: true, revision: true } } } } } });
  const byItem = new Map(rows.map(row => [row.itemId, row]));
  return refs.map(ref => {
    const row = byItem.get(ref.itemId);
    if (!row || row.revision !== ref.itemRevision || row.item.objectiveId !== ref.objectiveId)
      throw new PracticeError('Eine Übungsreferenz fehlt oder gehört einem anderen Autor.', 409);
    if (row.item.objective.revision !== ref.objectiveRevision) throw new PracticeError('Lernziel wurde geändert. Übungsentwurf bitte neu speichern.', 412);
    return { ...ref, objectiveTitle: row.item.objective.title, objectiveDescription: row.item.objective.description,
      ...parseChoice(row.payload) };
  });
}

/** Resolve unsaved or saved pins without relying on the visible pool pages. */
export async function previewPracticeRefs(courseId: string, actor: PracticeActor, input: unknown) {
  const refs = practiceRefs(input);
  return transaction(async tx => {
    await assertCourseAuthor(tx, courseId, actor);
    return { items: await resolveRefs(tx, actor.id, refs) };
  });
}

/** NFKC, Unicode whitespace folding and lowercasing of stem plus sorted options only.
 * This catches exact normalized duplicates, never paraphrases or semantic overlap. */
export function normalizeOverlapText(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
export function credentialOverlapKey(prompt: string, options: string[]) {
  return JSON.stringify([normalizeOverlapText(prompt), options.map(normalizeOverlapText).sort()]);
}

function assertNoCredentialDuplicates(publicationPayload: string, items: PracticeSnapshotItem[]) {
  let payload: unknown;
  try { payload = JSON.parse(publicationPayload); } catch { throw new PracticeError('Kursveröffentlichung ist beschädigt.', 409); }
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { contents?: unknown }).contents)) throw new PracticeError('Kursveröffentlichung ist beschädigt.', 409);
  const keys = new Set<string>();
  for (const content of (payload as { contents: Array<{ type?: unknown; content?: unknown }> }).contents) {
    const quiz = parseQuizContent(content.content);
    if (content.type === 'QUIZ' && !quiz) throw new PracticeError('Kursquiz kann nicht geprüft werden.', 409);
    for (const question of quiz?.questions ?? []) {
      if (question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE' || question.type === 'TRUE_FALSE') {
        keys.add(credentialOverlapKey(question.question, question.options));
      }
    }
  }
  if (items.some(item => keys.has(credentialOverlapKey(item.prompt, item.options)))) {
    throw new PracticeError('Übungsfrage dupliziert eine aktuelle bewertete Kursfrage.', 409);
  }
}

export async function publishPracticeDraft(courseId: string, actor: PracticeActor, expectedRevision: unknown, expectedActivePublicationId: unknown, requestId: unknown) {
  if (!revision(expectedRevision, true)) throw new PracticeError('Entwurfsrevision erforderlich.', 428);
  if (!privateId(expectedActivePublicationId)) throw new PracticeError('Aktive Kursveröffentlichung erforderlich.', 428);
  if (!privateId(requestId)) throw new PracticeError('Ungültige Anforderungs-ID.');
  return publishDraftNative(courseId, actor, expectedRevision, expectedActivePublicationId, requestId, parseDraft, parseChoice, assertNoCredentialDuplicates);
}

export async function listPracticeHistory(courseId: string, actor: PracticeActor, cursorValue: string | null = null) {
  const cursor = cursorValue === null ? null : Number(cursorValue);
  if (cursorValue !== null && (!/^[1-9]\d*$/.test(cursorValue) || !Number.isSafeInteger(cursor)))
    throw new PracticeError('Ungültiger Verlaufscursor.');
  return transaction(async tx => {
    const course = await assertCourseAuthor(tx, courseId, actor);
    const rows = await tx.practiceSnapshot.findMany({ where: { courseId, ...(cursor !== null && { sequence: { lt: cursor } }) },
      orderBy: { sequence: 'desc' }, take: POOL_PAGE_SIZE + 1,
      select: { id: true, coursePublicationId: true, sequence: true, digest: true, itemCount: true, recordedAt: true } });
    const snapshots = rows.slice(0, POOL_PAGE_SIZE);
    return { activeCoursePublicationId: course.activePublicationId, snapshots,
      nextCursor: rows.length > POOL_PAGE_SIZE ? String(snapshots[snapshots.length - 1].sequence) : null };
  });
}
