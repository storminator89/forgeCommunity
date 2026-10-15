import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { Prisma, QuizConfidence } from '@prisma/client';
import prisma from '@/lib/prisma';
import { PracticeError } from '@/lib/server/formative-practice';

type Tx = Prisma.TransactionClient;
type SnapshotItem = {
  itemId: string; itemRevision: number; objectiveTitle: string;
  prompt: string; options: string[]; correctIndex: number; explanation: string;
};
type Snapshot = { id: string; coursePublicationId: string; payload: string; itemCount: number };
type LearnerSession = Awaited<ReturnType<Tx['practiceLearnerSession']['findFirst']>>;
const MAX_SESSION_ITEMS = 10;
const RETENTION_HEARTBEAT_MAX_AGE_MS = 45 * 60_000;
const ID = /^[A-Za-z0-9_-]{8,100}$/;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const requireId = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !ID.test(value)) throw new PracticeError(`${name} ist ungültig.`);
  return value;
};

/** A course publication and its separately published practice pool must match exactly. */
async function access(tx: Tx, courseId: string, userId: string) {
  requireId(courseId, 'Kurs-ID');
  const course = await tx.course.findUnique({ where: { id: courseId }, select: { id: true, activePublicationId: true } });
  if (!course) throw new PracticeError('Kurs nicht gefunden.', 404);
  const learner = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!learner || !await tx.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } }, select: { id: true } })) {
    throw new PracticeError('Keine Kursteilnahme.', 403);
  }
  const snapshot = course.activePublicationId ? await tx.practiceSnapshot.findFirst({
    where: { courseId, coursePublicationId: course.activePublicationId }, orderBy: { sequence: 'desc' },
    select: { id: true, coursePublicationId: true, payload: true, itemCount: true },
  }) : null;
  const setting = await tx.practiceLearnerSetting.findUnique({ where: { userId_courseId: { userId, courseId } } });
  return { course, snapshot, setting };
}

async function assertRetentionHealthy(tx: Tx) {
  const state = await tx.practiceRetentionHealth.findUnique({ where: { id: 'learner' }, select: { lastSuccessAt: true } });
  const latest = state?.lastSuccessAt?.getTime();
  const now = Date.now();
  if (latest === undefined || latest < now - RETENTION_HEARTBEAT_MAX_AGE_MS || latest > now + 5 * 60_000) {
    throw new PracticeError('Privates Üben ist vorübergehend nicht verfügbar. Bitte später erneut versuchen.', 503);
  }
}

function itemsOf(snapshot: Snapshot): SnapshotItem[] {
  let payload: unknown;
  try { payload = JSON.parse(snapshot.payload); } catch { throw new PracticeError('Übungspool ist beschädigt.', 409); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new PracticeError('Übungspool ist beschädigt.', 409);
  const parsed = payload as { schemaVersion?: unknown; coursePublicationId?: unknown; items?: unknown };
  if (parsed.schemaVersion !== 1 || parsed.coursePublicationId !== snapshot.coursePublicationId ||
      !Array.isArray(parsed.items) || parsed.items.length !== snapshot.itemCount || parsed.items.length < 1 || parsed.items.length > 100) {
    throw new PracticeError('Übungspool ist beschädigt.', 409);
  }
  const seen = new Set<string>();
  return parsed.items.map(value => {
    const item = value as SnapshotItem;
    if (!item || typeof item !== 'object' || !ID.test(item.itemId) ||
        !Number.isSafeInteger(item.itemRevision) || item.itemRevision < 1 ||
        !Array.isArray(item.options) || item.options.length < 2 || item.options.length > 8 ||
        typeof item.prompt !== 'string' || typeof item.objectiveTitle !== 'string' ||
        typeof item.explanation !== 'string' || item.options.some(option => typeof option !== 'string') ||
        !Number.isSafeInteger(item.correctIndex) || item.correctIndex < 0 || item.correctIndex >= item.options.length ||
        seen.has(item.itemId)) throw new PracticeError('Übungspool ist beschädigt.', 409);
    seen.add(item.itemId);
    return item;
  });
}

function publicItem(item: SnapshotItem) {
  return { itemId: item.itemId, itemRevision: item.itemRevision, objectiveTitle: item.objectiveTitle,
    prompt: item.prompt, options: item.options };
}

async function assertPinnedRevision(tx: Tx, item: SnapshotItem) {
  const revision = await tx.practiceItemRevision.findUnique({ where: { itemId_revision: { itemId: item.itemId, revision: item.itemRevision } }, select: { payload: true } });
  if (!revision) throw new PracticeError('Veröffentlichte Übungsrevision fehlt.', 409);
  let source: unknown;
  try { source = JSON.parse(revision.payload); } catch { throw new PracticeError('Veröffentlichte Übungsrevision ist beschädigt.', 409); }
  const choice = source as SnapshotItem;
  if (!choice || choice.prompt !== item.prompt || JSON.stringify(choice.options) !== JSON.stringify(item.options) ||
      choice.correctIndex !== item.correctIndex || choice.explanation !== item.explanation) {
    throw new PracticeError('Veröffentlichte Übungsrevision stimmt nicht überein.', 409);
  }
}

async function activeSession(tx: Tx, userId: string, courseId: string) {
  return tx.practiceLearnerSession.findFirst({ where: { userId, courseId, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } });
}

async function pendingDto(tx: Tx, session: NonNullable<LearnerSession>, items: SnapshotItem[]) {
  if (!session.pendingReservationId) return undefined;
  const reservation = await tx.practiceLearnerReservation.findUnique({ where: { id: session.pendingReservationId } });
  if (!reservation || reservation.sessionId !== session.id) throw new PracticeError('Sitzungsreservierung ist beschädigt.', 409);
  const item = items.find(candidate => candidate.itemId === reservation.itemId && candidate.itemRevision === reservation.itemRevision);
  if (!item) throw new PracticeError('Übungsrevision ist nicht mehr in der Veröffentlichung.', 409);
  return { reservationId: reservation.id, ordinal: reservation.ordinal, item: publicItem(item) };
}

async function dueItems(tx: Tx, userId: string, courseId: string, snapshot: Snapshot, session: LearnerSession, now: Date) {
  const items = itemsOf(snapshot);
  const states = await tx.practiceLearnerSchedule.findMany({ where: { userId, courseId, snapshotId: snapshot.id } });
  const stateByItem = new Map(states.map(state => [state.itemId, state]));
  // Exclusions are bounded and deterministic. The 24-hour horizon lets small
  // published pools be practiced again in a later session after their due date.
  const recent = await tx.practiceLearnerReservation.findMany({
    where: { session: { userId, courseId, snapshotId: snapshot.id }, shownAt: { gte: new Date(now.getTime() - 24 * 3600_000) } },
    orderBy: [{ shownAt: 'desc' }, { id: 'desc' }], take: 2, select: { itemId: true },
  });
  const excluded = new Set(recent.map(row => row.itemId));
  if (session) {
    const sessionItems = await tx.practiceLearnerReservation.findMany({ where: { sessionId: session.id }, select: { itemId: true } });
    for (const row of sessionItems) excluded.add(row.itemId);
  }
  return items.filter(item => {
    const state = stateByItem.get(item.itemId);
    return !excluded.has(item.itemId) && (!state || (state.itemRevision === item.itemRevision && state.dueAt <= now));
  }).sort((a, b) => {
    const aDue = stateByItem.get(a.itemId)?.dueAt.getTime() ?? 0;
    const bDue = stateByItem.get(b.itemId)?.dueAt.getTime() ?? 0;
    return aDue - bDue || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0);
  });
}

async function txRun<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try { return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2002') && attempt < 3) continue;
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2002')) {
        throw new PracticeError('Gleichzeitige Übungsänderung. Bitte erneut versuchen.', 409);
      }
      throw error;
    }
  }
  throw new PracticeError('Gleichzeitige Übungsänderung. Bitte erneut versuchen.', 409);
}

export async function readLearnerPractice(courseId: string, userId: string) {
  return txRun(async tx => {
    const { course, snapshot, setting } = await access(tx, courseId, userId);
    if (!course.activePublicationId) return { status: 'unpublished', dueCount: 0 };
    if (!snapshot) {
      const everPublished = await tx.practiceSnapshot.count({ where: { courseId } });
      return { status: everPublished ? 'archived' : 'off', dueCount: 0 };
    }
    const base = { publicationId: course.activePublicationId, snapshotId: snapshot.id };
    if (!setting?.optedIn) return { ...base, status: 'available', dueCount: 0 };
    if (setting.paused) return { ...base, status: 'paused', dueCount: 0 };
    const session = await activeSession(tx, userId, courseId);
    const items = itemsOf(snapshot);
    if (session?.snapshotId === snapshot.id) {
      const pending = await pendingDto(tx, session, items);
      const dueCount = session.answeredCount >= MAX_SESSION_ITEMS ? 0 : (await dueItems(tx, userId, courseId, snapshot, session, new Date())).length;
      return { ...base, status: 'active', dueCount, session: { id: session.id, answeredCount: session.answeredCount, ...(pending && { pending }) } };
    }
    const dueCount = (await dueItems(tx, userId, courseId, snapshot, null, new Date())).length;
    return { ...base, status: dueCount ? 'ready' : 'complete', dueCount };
  });
}

export async function optInLearnerPractice(courseId: string, userId: string) {
  return txRun(async tx => {
    const { snapshot } = await access(tx, courseId, userId);
    if (!snapshot) throw new PracticeError('Keine aktive Übungsveröffentlichung.', 409);
    await assertRetentionHealthy(tx);
    await tx.practiceLearnerSetting.upsert({ where: { userId_courseId: { userId, courseId } },
      create: { userId, courseId, optedIn: true, paused: false },
      update: { optedIn: true, paused: false, lastActivityAt: new Date() } });
    return { optedIn: true, paused: false };
  });
}

export async function pauseLearnerPractice(courseId: string, userId: string) {
  return txRun(async tx => {
    const { setting } = await access(tx, courseId, userId);
    if (!setting?.optedIn) throw new PracticeError('Übung ist nicht aktiviert.', 409);
    await tx.practiceLearnerSetting.update({ where: { userId_courseId: { userId, courseId } }, data: { paused: true, lastActivityAt: new Date() } });
    return { optedIn: true, paused: true };
  });
}

export async function optOutLearnerPractice(courseId: string, userId: string) {
  return txRun(async tx => {
    const { setting } = await access(tx, courseId, userId);
    if (setting) await tx.practiceLearnerSetting.update({ where: { userId_courseId: { userId, courseId } },
      data: { optedIn: false, paused: false, lastActivityAt: new Date() } });
    return { optedIn: false, paused: false };
  });
}

async function requireReady(tx: Tx, courseId: string, userId: string) {
  const state = await access(tx, courseId, userId);
  if (!state.setting?.optedIn) throw new PracticeError('Übung muss zuerst aktiviert werden.', 409);
  if (state.setting.paused) throw new PracticeError('Übung ist pausiert.', 409);
  if (!state.snapshot) throw new PracticeError('Keine aktive Übungsveröffentlichung.', 409);
  await assertRetentionHealthy(tx);
  return state.snapshot;
}

async function reserve(tx: Tx, courseId: string, userId: string, snapshot: Snapshot, session: NonNullable<LearnerSession>) {
  const items = itemsOf(snapshot);
  if (session.pendingReservationId) {
    const pending = await pendingDto(tx, session, items);
    return { sessionId: session.id, answeredCount: session.answeredCount, pending, complete: false };
  }
  if (session.answeredCount >= MAX_SESSION_ITEMS) {
    await tx.practiceLearnerSession.update({ where: { id: session.id }, data: { status: 'COMPLETE', version: { increment: 1 } } });
    return { sessionId: session.id, answeredCount: session.answeredCount, complete: true };
  }
  const candidates = await dueItems(tx, userId, courseId, snapshot, session, new Date());
  if (!candidates.length) {
    await tx.practiceLearnerSession.update({ where: { id: session.id }, data: { status: 'COMPLETE', version: { increment: 1 } } });
    return { sessionId: session.id, answeredCount: session.answeredCount, complete: true };
  }
  const item = candidates[0];
  await assertPinnedRevision(tx, item);
  const ordinal = session.answeredCount + 1;
  const reservation = await tx.practiceLearnerReservation.create({ data: { id: randomUUID(), sessionId: session.id,
    ordinal, itemId: item.itemId, itemRevision: item.itemRevision } });
  const changed = await tx.practiceLearnerSession.updateMany({ where: { id: session.id, version: session.version, pendingReservationId: null, status: 'ACTIVE' },
    data: { pendingReservationId: reservation.id, version: { increment: 1 } } });
  if (changed.count !== 1) throw new PracticeError('Sitzung wurde gleichzeitig geändert. Bitte erneut versuchen.', 409);
  await tx.practiceLearnerSetting.update({ where: { userId_courseId: { userId, courseId } }, data: { lastActivityAt: new Date() } });
  return { sessionId: session.id, answeredCount: session.answeredCount,
    pending: { reservationId: reservation.id, ordinal, item: publicItem(item) }, complete: false };
}

export async function startLearnerPractice(courseId: string, userId: string) {
  return txRun(async tx => {
    const snapshot = await requireReady(tx, courseId, userId);
    let session = await activeSession(tx, userId, courseId);
    if (session && session.snapshotId !== snapshot.id) {
      await tx.practiceLearnerSession.update({ where: { id: session.id }, data: { status: 'SUPERSEDED', pendingReservationId: null, version: { increment: 1 } } });
      session = null;
    }
    if (!session) session = await tx.practiceLearnerSession.create({ data: { id: randomUUID(), userId, courseId, snapshotId: snapshot.id } });
    return reserve(tx, courseId, userId, snapshot, session);
  });
}

export async function nextLearnerPractice(courseId: string, userId: string, sessionIdInput: unknown) {
  const sessionId = requireId(sessionIdInput, 'Sitzungs-ID');
  return txRun(async tx => {
    const snapshot = await requireReady(tx, courseId, userId);
    const session = await tx.practiceLearnerSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId || session.courseId !== courseId) throw new PracticeError('Sitzung nicht gefunden.', 404);
    if (session.status !== 'ACTIVE' || session.snapshotId !== snapshot.id) throw new PracticeError('Sitzung ist veraltet.', 409);
    return reserve(tx, courseId, userId, snapshot, session);
  });
}

export async function answerLearnerPractice(courseId: string, userId: string, body: Record<string, unknown>) {
  const sessionId = requireId(body.sessionId, 'Sitzungs-ID');
  const reservationId = requireId(body.reservationId, 'Reservierungs-ID');
  const submissionId = requireId(body.submissionId, 'Übermittlungs-ID');
  const optionIndex = body.optionIndex;
  if (!Number.isSafeInteger(optionIndex) || (optionIndex as number) < 0) throw new PracticeError('Antwortindex ist ungültig.');
  const confidence = body.confidence === null || body.confidence === undefined ? null : body.confidence;
  if (confidence !== null && !Object.values(QuizConfidence).includes(confidence as QuizConfidence)) throw new PracticeError('Sicherheitseinschätzung ist ungültig.');
  const digest = hash(JSON.stringify([sessionId, reservationId, optionIndex, confidence]));
  return txRun(async tx => {
    await access(tx, courseId, userId);
    // A matching receipt is replayable even after a course republish or pause.
    const receipt = await tx.practiceLearnerSubmissionReceipt.findUnique({ where: { sessionId_submissionId: { sessionId, submissionId } },
      include: { answer: { include: { reservation: { include: { session: true } } } } } });
    if (receipt) {
      const stored = receipt.answer;
      if (receipt.requestDigest !== digest || stored.reservationId !== reservationId ||
          stored.reservation.session.userId !== userId || stored.reservation.session.courseId !== courseId) {
        throw new PracticeError('Übermittlungs-ID wurde anders verwendet.', 409);
      }
      const snap = await tx.practiceSnapshot.findUnique({ where: { id: stored.reservation.session.snapshotId },
        select: { id: true, coursePublicationId: true, payload: true, itemCount: true } });
      if (!snap) throw new PracticeError('Übungsveröffentlichung fehlt.', 409);
      const item = itemsOf(snap).find(value => value.itemId === stored.reservation.itemId && value.itemRevision === stored.reservation.itemRevision);
      if (!item) throw new PracticeError('Übungsrevision fehlt.', 409);
      return { correct: stored.correct, correctIndex: item.correctIndex, explanation: item.explanation,
        nextDueAt: stored.nextDueAt, canContinue: stored.canContinue,
        answeredCount: stored.reservation.ordinal, replay: true };
    }
    const snapshot = await requireReady(tx, courseId, userId);
    const session = await tx.practiceLearnerSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId || session.courseId !== courseId) throw new PracticeError('Sitzung nicht gefunden.', 404);
    if (session.status !== 'ACTIVE' || session.snapshotId !== snapshot.id) throw new PracticeError('Sitzung ist veraltet.', 409);
    if (session.pendingReservationId !== reservationId) throw new PracticeError('Reservierung ist nicht mehr aktuell.', 409);
    const reservation = await tx.practiceLearnerReservation.findUnique({ where: { id: reservationId }, include: { answer: true } });
    if (!reservation || reservation.sessionId !== session.id || reservation.answer) throw new PracticeError('Frage wurde bereits beantwortet.', 409);
    const item = itemsOf(snapshot).find(candidate => candidate.itemId === reservation.itemId && candidate.itemRevision === reservation.itemRevision);
    if (!item) throw new PracticeError('Übungsrevision fehlt.', 409);
    if ((optionIndex as number) >= item.options.length) throw new PracticeError('Antwortindex ist ungültig.');
    await assertPinnedRevision(tx, item);
    const correct = optionIndex === item.correctIndex;
    const now = new Date();
    const prior = await tx.practiceLearnerSchedule.findUnique({ where: { userId_courseId_snapshotId_itemId:
      { userId, courseId, snapshotId: snapshot.id, itemId: item.itemId } } });
    const streak = correct ? Math.min((prior?.streak ?? 0) + 1, 6) : 0;
    const baseDays = correct ? Math.min(1 << (streak - 1), 30) : 0;
    // Confidence adjusts only private review timing, never a grade or reward.
    const reviewMs = !correct ? (confidence === 'SURE' ? 5 : 10) * 60_000
      : confidence === 'UNSURE' || confidence === 'GUESSED' ? 6 * 3600_000
      : confidence === 'SURE' ? Math.min(baseDays * 2, 30) * 86400_000
      : baseDays * 86400_000;
    const intervalDays = Math.floor(reviewMs / 86400_000);
    const dueAt = new Date(now.getTime() + reviewMs);
    const changed = await tx.practiceLearnerSession.updateMany({ where: { id: session.id, version: session.version, pendingReservationId: reservationId, status: 'ACTIVE' },
      data: { pendingReservationId: null, answeredCount: { increment: 1 }, version: { increment: 1 } } });
    if (changed.count !== 1) throw new PracticeError('Sitzung wurde gleichzeitig geändert. Bitte erneut versuchen.', 409);
    await tx.practiceLearnerSchedule.upsert({ where: { userId_courseId_snapshotId_itemId: { userId, courseId, snapshotId: snapshot.id, itemId: item.itemId } },
      create: { userId, courseId, snapshotId: snapshot.id, itemId: item.itemId, itemRevision: item.itemRevision, dueAt, intervalDays, streak, lastAnsweredAt: now },
      update: { itemRevision: item.itemRevision, dueAt, intervalDays, streak, lastAnsweredAt: now } });
    // Close an exhausted session in the same transaction as its last answer.
    // Otherwise the session-only exclusion hides newly due items forever when
    // the learner leaves before pressing Next (or reaches the ten-item cap).
    const canContinue = session.answeredCount + 1 < MAX_SESSION_ITEMS &&
      (await dueItems(tx, userId, courseId, snapshot, session, now)).length > 0;
    if (!canContinue) await tx.practiceLearnerSession.update({ where: { id: session.id }, data: { status: 'COMPLETE', version: { increment: 1 } } });
    const answer = await tx.practiceLearnerAnswer.create({ data: { id: randomUUID(), reservationId, optionIndex: optionIndex as number,
      correct, confidence: confidence as QuizConfidence | null, nextDueAt: dueAt, answeredAt: now, canContinue } });
    await tx.practiceLearnerSubmissionReceipt.create({ data: { sessionId, submissionId, answerId: answer.id, requestDigest: digest, createdAt: now } });
    await tx.practiceLearnerSetting.update({ where: { userId_courseId: { userId, courseId } }, data: { lastActivityAt: now } });
    return { correct, correctIndex: item.correctIndex, explanation: item.explanation, nextDueAt: dueAt,
      canContinue, answeredCount: session.answeredCount + 1, replay: false };
  });
}

export async function prepareLearnerPracticeReset(courseId: string, userId: string) {
  return txRun(async tx => {
    const { setting } = await access(tx, courseId, userId);
    if (!setting) throw new PracticeError('Keine Übungsdaten zum Zurücksetzen.', 409);
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await tx.practiceLearnerSetting.update({ where: { userId_courseId: { userId, courseId } },
      data: { resetTokenHash: hash(token), resetTokenExpiresAt: expiresAt } });
    return { token, expiresAt, confirmation: 'RESET_MY_PRACTICE' };
  });
}

export async function resetLearnerPractice(courseId: string, userId: string, tokenInput: unknown, confirmation: unknown) {
  const token = requireId(tokenInput, 'Zurücksetzen-Token');
  if (confirmation !== 'RESET_MY_PRACTICE') throw new PracticeError('Explizite Bestätigung zum Zurücksetzen erforderlich.', 428);
  return txRun(async tx => {
    const { setting } = await access(tx, courseId, userId);
    if (!setting || setting.resetTokenHash !== hash(token) || !setting.resetTokenExpiresAt || setting.resetTokenExpiresAt <= new Date()) {
      throw new PracticeError('Zurücksetzen-Token ist ungültig oder abgelaufen.', 409);
    }
    const deleted = await tx.practiceLearnerSetting.deleteMany({ where: { userId, courseId, resetTokenHash: hash(token), resetTokenExpiresAt: { gt: new Date() } } });
    if (deleted.count !== 1) throw new PracticeError('Zurücksetzen wurde gleichzeitig geändert.', 409);
    return { reset: true, optedIn: false };
  });
}
