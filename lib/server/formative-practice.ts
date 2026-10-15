import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { parseQuizContent } from '@/app/courses/[courseId]/contents/types';

export type PracticeActor = { id: string; role?: string | null };
export type PracticeChoice = { schemaVersion: 1; type: 'SINGLE_CHOICE'; prompt: string; options: string[]; correctIndex: number; explanation: string };
export type PracticeRef = { objectiveId: string; objectiveRevision: number; itemId: string; itemRevision: number };
type PracticeDraftPayload = { schemaVersion: 1; items: PracticeRef[] };
type PracticeSnapshotItem = PracticeRef & { objectiveTitle: string; objectiveDescription: string } & PracticeChoice;
type PracticeSnapshotPayload = { schemaVersion: 1; coursePublicationId: string; items: PracticeSnapshotItem[] };

export class PracticeError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

const privateId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(value);
const revision = (value: unknown, allowZero = false): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const emptyDraft: PracticeDraftPayload = { schemaVersion: 1, items: [] };
const MAX_ITEMS = 100;

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

async function getOrCreateDraft(tx: Prisma.TransactionClient, courseId: string) {
  const json = JSON.stringify(emptyDraft);
  return tx.coursePracticeDraft.upsert({ where: { courseId }, create: { courseId, revision: 0, payload: json, digest: hash(json) }, update: {} });
}

async function activeSnapshot(tx: Prisma.TransactionClient, courseId: string, publicationId: string | null) {
  if (!publicationId) return null;
  return tx.practiceSnapshot.findFirst({ where: { courseId, coursePublicationId: publicationId }, orderBy: { sequence: 'desc' },
    select: { id: true, coursePublicationId: true, sequence: true, digest: true, recordedAt: true, itemCount: true } });
}

export async function listPracticeObjectives(actor: PracticeActor) {
  return transaction(async tx => {
    await assertAuthor(tx, actor);
    const objectives = await tx.practiceObjective.findMany({ where: { ownerId: actor.id }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 100,
      select: { id: true, title: true, description: true, revision: true, updatedAt: true } });
    return { objectives };
  });
}

export async function createPracticeObjective(actor: PracticeActor, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PracticeError('Ungültiges Lernziel.');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(key => !['title', 'description'].includes(key))) throw new PracticeError('Ungültiges Lernziel.');
  const title = boundedText(body.title, 300, 'Lernziel');
  const description = boundedText(body.description ?? '', 3000, 'Beschreibung', false);
  return transaction(async tx => {
    await assertAuthor(tx, actor);
    return tx.practiceObjective.create({ data: { ownerId: actor.id, title, description }, select: { id: true, title: true, description: true, revision: true } });
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
  return transaction(async tx => {
    await assertAuthor(tx, actor);
    const current = await tx.practiceObjective.findFirst({ where: { id: objectiveId, ownerId: actor.id }, select: { revision: true } });
    if (!current) throw new PracticeError('Lernziel nicht gefunden.', 404);
    if (current.revision !== expectedRevision) throw new PracticeError('Lernziel wurde geändert. Bitte neu laden.', 412);
    const result = await tx.practiceObjective.updateMany({ where: { id: objectiveId, ownerId: actor.id, revision: expectedRevision },
      data: { ...(title !== undefined && { title }), ...(description !== undefined && { description }), revision: { increment: 1 } } });
    if (result.count !== 1) throw new PracticeError('Lernziel wurde geändert. Bitte neu laden.', 412);
    return tx.practiceObjective.findUniqueOrThrow({ where: { id: objectiveId }, select: { id: true, title: true, description: true, revision: true } });
  });
}

export async function listPracticeItems(actor: PracticeActor, objectiveId: string) {
  if (!privateId(objectiveId)) throw new PracticeError('Lernziel nicht gefunden.', 404);
  return transaction(async tx => {
    await assertAuthor(tx, actor);
    const objective = await tx.practiceObjective.findFirst({ where: { id: objectiveId, ownerId: actor.id }, select: { id: true } });
    if (!objective) throw new PracticeError('Lernziel nicht gefunden.', 404);
    const items = await tx.practiceItem.findMany({ where: { ownerId: actor.id, objectiveId }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 100,
      select: { id: true, objectiveId: true, latestRevision: true, updatedAt: true,
        revisions: { orderBy: { revision: 'desc' }, take: 1, select: { payload: true } } } });
    return { items: items.map(item => ({ id: item.id, objectiveId: item.objectiveId, latestRevision: item.latestRevision,
      updatedAt: item.updatedAt, prompt: parseChoice(item.revisions[0].payload).prompt })) };
  });
}

export async function createPracticeItem(actor: PracticeActor, objectiveId: string, input: unknown) {
  if (!privateId(objectiveId)) throw new PracticeError('Lernziel nicht gefunden.', 404);
  const choice = practiceChoiceFromInput(input);
  return transaction(async tx => {
    await assertAuthor(tx, actor);
    const objective = await tx.practiceObjective.findFirst({ where: { id: objectiveId, ownerId: actor.id }, select: { id: true } });
    if (!objective) throw new PracticeError('Lernziel nicht gefunden.', 404);
    return tx.practiceItem.create({ data: { ownerId: actor.id, objectiveId, latestRevision: 1,
      revisions: { create: { revision: 1, payload: JSON.stringify(choice) } } },
    select: { id: true, objectiveId: true, latestRevision: true } });
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
  return transaction(async tx => {
    await assertAuthor(tx, actor);
    const item = await tx.practiceItem.findFirst({ where: { id: itemId, ownerId: actor.id }, select: { latestRevision: true, objectiveId: true } });
    if (!item) throw new PracticeError('Übungsfrage nicht gefunden.', 404);
    if (item.latestRevision !== expectedRevision) throw new PracticeError('Übungsfrage wurde geändert. Bitte neu laden.', 412);
    const updated = await tx.practiceItem.updateMany({ where: { id: itemId, ownerId: actor.id, latestRevision: expectedRevision },
      data: { latestRevision: { increment: 1 } } });
    if (updated.count !== 1) throw new PracticeError('Übungsfrage wurde geändert. Bitte neu laden.', 412);
    const nextRevision = expectedRevision + 1;
    await tx.practiceItemRevision.create({ data: { itemId, revision: nextRevision, payload: JSON.stringify(choice) } });
    return { id: itemId, objectiveId: item.objectiveId, latestRevision: nextRevision };
  });
}

export async function readPracticeDraft(courseId: string, actor: PracticeActor) {
  return transaction(async tx => {
    const course = await assertCourseAuthor(tx, courseId, actor);
    const draft = await getOrCreateDraft(tx, courseId);
    return { draft: { revision: draft.revision, payload: parseDraft(draft.payload), digest: draft.digest },
      activeCoursePublicationId: course.activePublicationId, activeSnapshot: await activeSnapshot(tx, courseId, course.activePublicationId) };
  });
}

export async function savePracticeDraft(courseId: string, actor: PracticeActor, expectedRevision: unknown, items: unknown) {
  if (!revision(expectedRevision, true)) throw new PracticeError('Entwurfsrevision erforderlich.', 428);
  const payload: PracticeDraftPayload = { schemaVersion: 1, items: practiceRefs(items) };
  const json = JSON.stringify(payload);
  if (Buffer.byteLength(json, 'utf8') > 32 * 1024) throw new PracticeError('Übungsentwurf ist zu groß.', 413);
  return transaction(async tx => {
    const course = await assertCourseAuthor(tx, courseId, actor);
    const draft = await getOrCreateDraft(tx, courseId);
    if (draft.revision !== expectedRevision) throw new PracticeError('Übungsentwurf wurde geändert. Bitte neu laden.', 412);
    await resolveRefs(tx, actor.id, payload.items);
    const updated = await tx.coursePracticeDraft.updateMany({ where: { courseId, revision: expectedRevision }, data: {
      revision: { increment: 1 }, payload: json, digest: hash(json), lastEditorId: actor.id,
    } });
    if (updated.count !== 1) throw new PracticeError('Übungsentwurf wurde geändert. Bitte neu laden.', 412);
    return { draft: { revision: expectedRevision + 1, payload, digest: hash(json) },
      activeCoursePublicationId: course.activePublicationId, activeSnapshot: await activeSnapshot(tx, courseId, course.activePublicationId) };
  });
}

async function resolveRefs(tx: Prisma.TransactionClient, ownerId: string, refs: PracticeRef[]): Promise<PracticeSnapshotItem[]> {
  const items: PracticeSnapshotItem[] = [];
  for (const ref of refs) {
    const row = await tx.practiceItemRevision.findFirst({ where: { itemId: ref.itemId, revision: ref.itemRevision,
      item: { ownerId, objectiveId: ref.objectiveId, objective: { ownerId } } }, select: { payload: true,
      item: { select: { objective: { select: { title: true, description: true, revision: true } } } } } });
    if (!row) throw new PracticeError('Eine Übungsreferenz fehlt oder gehört einem anderen Autor.', 409);
    if (row.item.objective.revision !== ref.objectiveRevision) throw new PracticeError('Lernziel wurde geändert. Übungsentwurf bitte neu speichern.', 412);
    items.push({ ...ref, objectiveTitle: row.item.objective.title, objectiveDescription: row.item.objective.description,
      ...parseChoice(row.payload) });
  }
  return items;
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

function snapshotDto(row: { id: string; coursePublicationId: string; sequence: number; digest: string; itemCount: number }) {
  return { id: row.id, coursePublicationId: row.coursePublicationId, sequence: row.sequence, digest: row.digest, itemCount: row.itemCount };
}

export async function publishPracticeDraft(courseId: string, actor: PracticeActor, expectedRevision: unknown, expectedActivePublicationId: unknown, requestId: unknown) {
  if (!revision(expectedRevision, true)) throw new PracticeError('Entwurfsrevision erforderlich.', 428);
  if (!privateId(expectedActivePublicationId)) throw new PracticeError('Aktive Kursveröffentlichung erforderlich.', 428);
  if (!privateId(requestId)) throw new PracticeError('Ungültige Anforderungs-ID.');
  const requestDigest = hash(JSON.stringify([actor.id, expectedRevision, expectedActivePublicationId]));
  const action = () => transaction(async tx => {
    const course = await assertCourseAuthor(tx, courseId, actor);
    const receipt = await tx.practicePublicationRequest.findUnique({ where: { courseId_requestId: { courseId, requestId } },
      select: { actorId: true, requestDigest: true, snapshot: { select: { id: true, courseId: true, coursePublicationId: true, sequence: true, digest: true, itemCount: true } } } });
    if (receipt) {
      if (receipt.actorId !== actor.id || receipt.requestDigest !== requestDigest || receipt.snapshot.courseId !== courseId) throw new PracticeError('Anforderungs-ID wurde anders verwendet.', 409);
      return { snapshot: snapshotDto(receipt.snapshot), unchanged: true, replay: true };
    }
    const draft = await getOrCreateDraft(tx, courseId);
    if (draft.revision !== expectedRevision || course.activePublicationId !== expectedActivePublicationId) throw new PracticeError('Übungsentwurf oder Kursveröffentlichung wurde geändert. Bitte neu laden.', 412);
    const refs = parseDraft(draft.payload).items;
    if (!refs.length) throw new PracticeError('Mindestens eine Übungsfrage ist erforderlich.', 409);
    const publication = await tx.coursePublication.findFirst({ where: { id: expectedActivePublicationId, courseId }, select: { payload: true } });
    if (!publication) throw new PracticeError('Kursveröffentlichung ist beschädigt.', 409);
    const items = await resolveRefs(tx, actor.id, refs);
    assertNoCredentialDuplicates(publication.payload, items);
    const payload: PracticeSnapshotPayload = { schemaVersion: 1, coursePublicationId: expectedActivePublicationId, items };
    const json = JSON.stringify(payload);
    if (Buffer.byteLength(json, 'utf8') > 1024 * 1024) throw new PracticeError('Übung ist zu groß.', 413);
    const digest = hash(json);
    const current = await activeSnapshot(tx, courseId, expectedActivePublicationId);
    if (current?.digest === digest) {
      await tx.practicePublicationRequest.create({ data: { courseId, requestId, actorId: actor.id, requestDigest, snapshotId: current.id } });
      return { snapshot: snapshotDto(current), unchanged: true, replay: false };
    }
    const latest = await tx.practiceSnapshot.findFirst({ where: { courseId }, orderBy: { sequence: 'desc' }, select: { sequence: true } });
    const snapshot = await tx.practiceSnapshot.create({ data: { id: randomUUID(), courseId, coursePublicationId: expectedActivePublicationId,
      sequence: (latest?.sequence ?? 0) + 1, draftRevision: expectedRevision, payload: json, digest, itemCount: items.length, actorId: actor.id },
      select: { id: true, coursePublicationId: true, sequence: true, digest: true, itemCount: true } });
    await tx.practicePublicationRequest.create({ data: { courseId, requestId, actorId: actor.id, requestDigest, snapshotId: snapshot.id } });
    return { snapshot: snapshotDto(snapshot), unchanged: false, replay: false };
  });
  // A simultaneous publish may collide on the receipt or next course sequence.
  // Re-read committed state in a new transaction before deciding to reuse it.
  for (let attempt = 0; ; attempt++) {
    try { return await action(); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      if (attempt >= 2) throw new PracticeError('Gleichzeitige Veröffentlichung. Bitte neu laden.', 409);
    }
  }
}

export async function listPracticeHistory(courseId: string, actor: PracticeActor) {
  return transaction(async tx => {
    const course = await assertCourseAuthor(tx, courseId, actor);
    const snapshots = await tx.practiceSnapshot.findMany({ where: { courseId }, orderBy: { sequence: 'desc' }, take: 100,
      select: { id: true, coursePublicationId: true, sequence: true, digest: true, itemCount: true, recordedAt: true } });
    return { activeCoursePublicationId: course.activePublicationId, snapshots };
  });
}
