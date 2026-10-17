import 'server-only';

import { randomUUID } from 'node:crypto';
import { Prisma } from '@/generated/prisma/client';
import prisma from '@/lib/prisma';
import { containsInsensitive } from '@/lib/server/database-query';
import { sanitizeTextServer } from '@/lib/server/sanitize-html';
import type { CourseQaLessonContext, CourseQaLessonContextPair } from '@/lib/course-qa-context-contract';
import { courseQaContextProjection } from '@/lib/server/course-qa-context';
import { CoursePathError } from '@/lib/server/course-path';

export class CourseQAError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

type Actor = { id: string; role?: string | null };
type Db = Prisma.TransactionClient;
type Access = { canModerate: boolean; canAsk: boolean; canReply: boolean; published: boolean; activePublicationId: string | null };
const PAGE_SIZE = 20;
const MAX_ANSWERS = 100;
const MAX_DAILY_QUESTIONS = 10;
const MAX_DAILY_ANSWERS = 10;
const VISIBILITY_BATCH_SIZE = 200;
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
const requestPattern = /^[A-Za-z0-9_-]{8,100}$/;
const retryable = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError &&
  (error.code === 'P2034' || error.code === 'P2002');

export async function courseQATransaction<T>(work: (tx: Db) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!retryable(error)) throw error;
      if (attempt === 3) throw new CourseQAError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
    }
  }
  throw new CourseQAError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
}

async function authorize(tx: Db, courseId: string, actor: Actor, write = false): Promise<Access> {
  if (!idPattern.test(courseId)) throw new CourseQAError('Kurs nicht gefunden.', 404);
  const [account, course] = await Promise.all([
    tx.user.findUnique({ where: { id: actor.id }, select: { id: true, role: true } }),
    tx.course.findUnique({ where: { id: courseId }, select: { instructorId: true, activePublicationId: true } }),
  ]);
  if (!account) throw new CourseQAError('Nicht authentifiziert.', 401);
  if (!course) throw new CourseQAError('Kurs nicht gefunden.', 404);
  const canModerate = course.instructorId === actor.id || (actor.role === 'ADMIN' && account.role === 'ADMIN');
  if (!course.activePublicationId && (!canModerate || write)) throw new CourseQAError('Kurs nicht gefunden.', 404);
  const enrolled = !canModerate && course.activePublicationId ? Boolean(await tx.enrollment.findUnique({
    where: { userId_courseId: { userId: actor.id, courseId } }, select: { id: true },
  })) : false;
  if (!canModerate && !enrolled) throw new CourseQAError('Kein Zugriff auf diesen Kurs.', 403);
  return { canModerate, canAsk: enrolled, canReply: canModerate || enrolled, published: Boolean(course.activePublicationId), activePublicationId: course.activePublicationId };
}

function validatedId(id: string, kind: string) {
  if (!idPattern.test(id)) throw new CourseQAError(`${kind} nicht gefunden.`, 404);
}

function validatedRequestId(value: unknown) {
  if (typeof value !== 'string' || !requestPattern.test(value)) throw new CourseQAError('Ungültige Anfragekennung.', 400);
  return value;
}

function validatedText(value: unknown, min: number, max: number, label: string) {
  if (typeof value !== 'string' || value.length > max * 2) throw new CourseQAError(`${label} ist ungültig.`, 400);
  const result = sanitizeTextServer(value);
  if (result.length < min || result.length > max) throw new CourseQAError(`${label} muss ${min}–${max} Zeichen haben.`, 400);
  return result;
}

function validatedLessonContext(value: unknown): CourseQaLessonContextPair | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, 'publicationId') || !Object.hasOwn(value, 'contentId')) {
    throw new CourseQAError('Ungültiger Lektionskontext.', 400);
  }
  const { publicationId, contentId } = value as Record<string, unknown>;
  if (typeof publicationId !== 'string' || !idPattern.test(publicationId) ||
      typeof contentId !== 'string' || !idPattern.test(contentId)) throw new CourseQAError('Ungültiger Lektionskontext.', 400);
  return { publicationId, contentId };
}
function samePair(a: CourseQaLessonContextPair | null, b: CourseQaLessonContextPair | null) {
  return a?.publicationId === b?.publicationId && a?.contentId === b?.contentId;
}
function storedPair(row: { contextPublicationId: string | null; contextContentId: string | null }): CourseQaLessonContextPair | null {
  // A damaged half-pair must not gain a label. The DB CHECK prevents new half-pairs.
  return row.contextPublicationId === null && row.contextContentId === null ? null :
    { publicationId: row.contextPublicationId ?? '', contentId: row.contextContentId ?? '' };
}
function validatedSearch(value: unknown) {
  if (value !== undefined && typeof value !== 'string') throw new CourseQAError('Ungültige Suche.', 400);
  const q = (value as string | undefined ?? '').trim();
  if (q.length > 64 || /[\u0000-\u001f\u007f]/.test(q)) throw new CourseQAError('Ungültige Suche.', 400);
  return q;
}
function scopeWhere(pair: CourseQaLessonContextPair | null) {
  return pair ? { contextPublicationId: pair.publicationId, contextContentId: pair.contentId } : {};
}
function searchWhere(q: string) { return q ? { OR: [{ title: containsInsensitive(q) }, { body: containsInsensitive(q) }] } : {}; }

type Cursor = { createdAt: Date; id: string };
function decodeCursor(raw: string | null, courseId: string, filter: string, q: string, pair: CourseQaLessonContextPair | null): Cursor | null {
  if (raw === null) return null;
  if (!raw || raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new CourseQAError('Ungültiger Seitenzeiger.', 400);
  try {
    const data = Buffer.from(raw, 'base64url');
    if (data.toString('base64url') !== raw) throw new Error('noncanonical');
    const item = JSON.parse(data.toString('utf8'));
    const keys = ['v', 'courseId', 'filter', 'q', 'id', 'createdAt', ...(item.v === 2 ? ['lessonContext'] : [])];
    if (!item || Object.keys(item).length !== keys.length || Object.keys(item).some(key => !keys.includes(key)) ||
        !(item.v === 2 || (item.v === 1 && pair === null)) || item.courseId !== courseId || item.filter !== filter ||
        item.q !== q || typeof item.id !== 'string' || !idPattern.test(item.id) ||
        (item.v === 2 && !samePair(validatedLessonContext(item.lessonContext), pair))) throw new Error('scope');
    const createdAt = new Date(item.createdAt);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== item.createdAt) throw new Error('date');
    return { createdAt, id: item.id };
  } catch { throw new CourseQAError('Ungültiger Seitenzeiger.', 400); }
}
function encodeCursor(item: Cursor, courseId: string, filter: string, q: string, pair: CourseQaLessonContextPair | null) {
  return Buffer.from(JSON.stringify({ v: 2, courseId, filter, q, id: item.id, createdAt: item.createdAt.toISOString(), lessonContext: pair })).toString('base64url');
}
function after(cursor: Cursor) {
  return { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] };
}

function summary(question: {
  id: string; title: string; body: string; createdAt: Date; hiddenAt: Date | null; solutionRevision: string | null;
  author: { id: string; name: string | null }; solution: { answerId: string } | null;
  _count?: { answers: number };
}, lessonContext: CourseQaLessonContext) {
  return { id: question.id, title: question.title, body: question.body, createdAt: question.createdAt.toISOString(),
    author: { id: question.author.id, name: question.author.name?.trim() || 'Unbenannte Person' },
    answerCount: question._count?.answers ?? 0, acceptedAnswerId: question.solution?.answerId ?? null,
    revision: question.solutionRevision, hidden: Boolean(question.hiddenAt), lessonContext };
}
function answerDto(answer: { id: string; body: string; createdAt: Date; hiddenAt: Date | null; author: { id: string; name: string | null } }) {
  return { id: answer.id, body: answer.body, createdAt: answer.createdAt.toISOString(),
    author: { id: answer.author.id, name: answer.author.name?.trim() || 'Unbenannte Person' }, hidden: Boolean(answer.hiddenAt) };
}

export async function listCourseQuestions(courseId: string, actor: Actor, params: URLSearchParams) {
  const allowed = new Set(['filter', 'q', 'cursor', 'publicationId', 'contentId']);
  if ([...params.keys()].some(key => !allowed.has(key) || params.getAll(key).length !== 1)) throw new CourseQAError('Ungültiger Filter.', 400);
  const filter = params.get('filter') ?? 'all';
  if (!['all', 'open', 'answered', 'hidden'].includes(filter)) throw new CourseQAError('Ungültiger Filter.', 400);
  const q = validatedSearch(params.get('q') ?? undefined);
  const pair = params.has('publicationId') || params.has('contentId') ? validatedLessonContext({ publicationId: params.get('publicationId'), contentId: params.get('contentId') }) : null;
  const cursor = decodeCursor(params.get('cursor'), courseId, filter, q, pair);
  return courseQATransaction(async tx => {
    const now = Date.now();
    const access = await authorize(tx, courseId, actor);
    if (filter === 'hidden' && !access.canModerate) throw new CourseQAError('Kein Zugriff auf diesen Filter.', 403);
    const rows = await tx.courseQuestion.findMany({
      where: { courseId, ...scopeWhere(pair), hiddenAt: filter === 'hidden' ? { not: null } : null,
        ...(filter === 'open' ? { solution: { is: null } } : filter === 'answered' ? { solution: { isNot: null } } : {}),
        AND: [
          ...(q ? [searchWhere(q)] : []),
          ...(cursor ? [after(cursor)] : []),
        ] },
      take: PAGE_SIZE + 1, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, title: true, body: true, createdAt: true, hiddenAt: true, solutionRevision: true, contextPublicationId: true, contextContentId: true,
        author: { select: { id: true, name: true } },
        solution: { select: { answerId: true } },
        _count: { select: { answers: { where: { hiddenAt: null } } } },
      },
    });
    const page = rows.slice(0, PAGE_SIZE);
    const projection = courseQaContextProjection(tx, courseId, actor.id, access.activePublicationId, now);
    const scope = await projection.scope(pair);
    return { items: await Promise.all(page.map(async row => summary(row, await projection.context(storedPair(row))))),
      scope, canAskInScope: access.canAsk && (scope.kind === 'course' || scope.lessonContext.status === 'current'),
      nextCursor: rows.length > PAGE_SIZE ? encodeCursor(page[page.length - 1], courseId, filter, q, pair) : null,
      canModerate: access.canModerate, canAsk: access.canAsk, canReply: access.canReply };
  });
}

/** Recheck every retained list row without replacing the reader's pagination window. */
export async function revalidateCourseQuestionIds(courseId: string, actor: Actor, input: Record<string, unknown>) {
  const { ids, filter } = input;
  if (Object.keys(input).some(key => !['ids', 'filter', 'q', 'lessonContext'].includes(key))) throw new CourseQAError('Ungültige Fragenliste.', 400);
  if (!Array.isArray(ids) || ids.length > VISIBILITY_BATCH_SIZE || ids.some(id => typeof id !== 'string' || !idPattern.test(id)) ||
      new Set(ids).size !== ids.length) throw new CourseQAError('Ungültige Fragenliste.', 400);
  if (!['all', 'open', 'answered', 'hidden'].includes(filter as string)) throw new CourseQAError('Ungültiger Filter.', 400);
  const q = validatedSearch(input.q);
  const pair = validatedLessonContext(input.lessonContext);
  return courseQATransaction(async tx => {
    const now = Date.now();
    const access = await authorize(tx, courseId, actor);
    const rows = filter === 'hidden' && !access.canModerate ? [] : await tx.courseQuestion.findMany({
      where: { courseId, ...scopeWhere(pair), ...searchWhere(q), id: { in: ids as string[] }, hiddenAt: filter === 'hidden' ? { not: null } : null,
        ...(filter === 'open' ? { solution: { is: null } } : filter === 'answered' ? { solution: { isNot: null } } : {}) },
      select: { id: true, contextPublicationId: true, contextContentId: true },
    });
    const projection = courseQaContextProjection(tx, courseId, actor.id, access.activePublicationId, now);
    const scope = await projection.scope(pair);
    return { visibleIds: rows.map(row => row.id),
      contexts: await Promise.all(rows.map(async row => ({ id: row.id, lessonContext: await projection.context(storedPair(row)) }))),
      scope, canAskInScope: access.canAsk && (scope.kind === 'course' || scope.lessonContext.status === 'current'),
      canModerate: access.canModerate, canAsk: access.canAsk, canReply: access.canReply };
  });
}

export async function readCourseQuestion(courseId: string, questionId: string, actor: Actor) {
  validatedId(questionId, 'Frage');
  return courseQATransaction(async tx => {
    const now = Date.now();
    const access = await authorize(tx, courseId, actor);
    const question = await tx.courseQuestion.findUnique({ where: { id: questionId },
      select: { id: true, courseId: true, title: true, body: true, createdAt: true, hiddenAt: true, solutionRevision: true, contextPublicationId: true, contextContentId: true,
        author: { select: { id: true, name: true } }, solution: { select: { answerId: true } } } });
    if (!question || question.courseId !== courseId || (question.hiddenAt && !access.canModerate)) throw new CourseQAError('Frage nicht gefunden.', 404);
    const answers = await tx.courseAnswer.findMany({ where: { questionId, ...(access.canModerate ? {} : { hiddenAt: null }) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: MAX_ANSWERS + 1,
      select: { id: true, body: true, createdAt: true, hiddenAt: true, author: { select: { id: true, name: true } } } });
    if (answers.length > MAX_ANSWERS) throw new CourseQAError('Zu viele Antworten für diese Ansicht.', 413);
    const projection = courseQaContextProjection(tx, courseId, actor.id, access.activePublicationId, now);
    return { question: summary(question, await projection.context(storedPair(question))), answers: answers.map(answerDto),
      canModerate: access.canModerate, canAsk: access.canAsk, canReply: access.canReply };
  });
}

export async function createCourseQuestion(courseId: string, actor: Actor, input: Record<string, unknown>) {
  if (Object.keys(input).some(key => !['title', 'body', 'requestId', 'lessonContext'].includes(key))) throw new CourseQAError('Ungültige Frage.', 400);
  const pair = validatedLessonContext(input.lessonContext);
  const title = validatedText(input.title, 5, 140, 'Titel');
  const body = validatedText(input.body, 10, 4000, 'Frage');
  const requestId = validatedRequestId(input.requestId);
  return courseQATransaction(async tx => {
    const now = Date.now();
    const access = await authorize(tx, courseId, actor, true);
    const projection = courseQaContextProjection(tx, courseId, actor.id, access.activePublicationId, now);
    if (!access.canAsk) throw new CourseQAError('Nur eingeschriebene Lernende können Fragen stellen.', 403);
    const existing = await tx.courseQuestion.findUnique({ where: { courseId_authorId_requestId: { courseId, authorId: actor.id, requestId } },
      select: { id: true, title: true, body: true, hiddenAt: true, createdAt: true, solutionRevision: true, contextPublicationId: true, contextContentId: true,
        author: { select: { id: true, name: true } }, solution: { select: { answerId: true } } } });
    if (existing) {
      if (existing.title !== title || existing.body !== body || !samePair(storedPair(existing), pair)) throw new CourseQAError('Anfragekennung wurde schon anders verwendet.', 409);
      if (existing.hiddenAt) throw new CourseQAError('Frage nicht gefunden.', 404);
      return { question: summary(existing, await projection.context(storedPair(existing))), created: false };
    }
    if (pair) {
      try { await projection.assertCurrent(pair); }
      catch (error) {
        if (error instanceof CoursePathError) throw new CourseQAError('Lektionskontext ist nicht verfügbar. Bitte neu laden.', error.status);
        throw error;
      }
    }
    const since = new Date(now - 24 * 60 * 60 * 1000);
    if (await tx.courseQuestion.count({ where: { courseId, authorId: actor.id, createdAt: { gte: since } } }) >= MAX_DAILY_QUESTIONS) {
      throw new CourseQAError('Für heute wurden zu viele Fragen gestellt.', 429);
    }
    const question = await tx.courseQuestion.create({ data: { courseId, authorId: actor.id, requestId, title, body,
      contextPublicationId: pair?.publicationId ?? null, contextContentId: pair?.contentId ?? null },
      select: { id: true, title: true, body: true, createdAt: true, hiddenAt: true, solutionRevision: true, contextPublicationId: true, contextContentId: true,
        author: { select: { id: true, name: true } }, solution: { select: { answerId: true } } } });
    return { question: summary(question, await projection.context(pair)), created: true };
  });
}

export async function createCourseAnswer(courseId: string, questionId: string, actor: Actor, input: Record<string, unknown>) {
  validatedId(questionId, 'Frage');
  const body = validatedText(input.body, 2, 4000, 'Antwort');
  const requestId = validatedRequestId(input.requestId);
  return courseQATransaction(async tx => {
    const access = await authorize(tx, courseId, actor, true);
    if (!access.canReply) throw new CourseQAError('Kein Zugriff auf Antworten.', 403);
    const question = await tx.courseQuestion.findUnique({ where: { id: questionId }, select: { courseId: true, hiddenAt: true } });
    if (!question || question.courseId !== courseId || question.hiddenAt) throw new CourseQAError('Frage nicht gefunden.', 404);
    const existing = await tx.courseAnswer.findUnique({ where: { questionId_authorId_requestId: { questionId, authorId: actor.id, requestId } },
      select: { id: true, body: true, createdAt: true, hiddenAt: true, author: { select: { id: true, name: true } } } });
    if (existing) {
      if (existing.body !== body) throw new CourseQAError('Anfragekennung wurde schon anders verwendet.', 409);
      if (existing.hiddenAt) throw new CourseQAError('Antwort nicht gefunden.', 404);
      return { answer: answerDto(existing), created: false };
    }
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (!access.canModerate && await tx.courseAnswer.count({ where: { authorId: actor.id, createdAt: { gte: since },
      question: { is: { courseId } } } }) >= MAX_DAILY_ANSWERS) {
      throw new CourseQAError('Für heute wurden zu viele Antworten in diesem Kurs geschrieben.', 429);
    }
    if (await tx.courseAnswer.count({ where: { questionId } }) >= MAX_ANSWERS) throw new CourseQAError('Diese Frage hat das Limit von 100 Antworten erreicht.', 409);
    const answer = await tx.courseAnswer.create({ data: { questionId, authorId: actor.id, requestId, body },
      select: { id: true, body: true, createdAt: true, hiddenAt: true, author: { select: { id: true, name: true } } } });
    return { answer: answerDto(answer), created: true };
  });
}

export async function selectCourseAnswer(courseId: string, questionId: string, actor: Actor, input: Record<string, unknown>) {
  validatedId(questionId, 'Frage');
  const { answerId, expectedRevision } = input;
  if (!(answerId === null || (typeof answerId === 'string' && idPattern.test(answerId))) ||
      !(expectedRevision === null || (typeof expectedRevision === 'string' && idPattern.test(expectedRevision)))) {
    throw new CourseQAError('Antwort und aktueller Lösungsstand sind erforderlich.', 400);
  }
  return courseQATransaction(async tx => {
    const access = await authorize(tx, courseId, actor, true);
    if (!access.canModerate) throw new CourseQAError('Kein Zugriff auf die Kursmoderation.', 403);
    const question = await tx.courseQuestion.findUnique({ where: { id: questionId }, select: { courseId: true, hiddenAt: true, solutionRevision: true } });
    if (!question || question.courseId !== courseId || question.hiddenAt) throw new CourseQAError('Frage nicht gefunden.', 404);
    if (answerId !== null) {
      const answer = await tx.courseAnswer.findUnique({ where: { id: answerId }, select: { questionId: true, hiddenAt: true } });
      if (!answer || answer.questionId !== questionId || answer.hiddenAt) throw new CourseQAError('Antwort nicht gefunden.', 404);
    }
    const current = await tx.courseQuestionSolution.findUnique({ where: { questionId }, select: { answerId: true } });
    if (question.solutionRevision !== expectedRevision) throw new CourseQAError('Die Auswahl wurde inzwischen geändert. Bitte neu laden.', 409);
    if ((current?.answerId ?? null) === answerId) return { acceptedAnswerId: answerId, revision: question.solutionRevision, changed: false };
    const revision = randomUUID();
    const updated = await tx.courseQuestion.updateMany({ where: { id: questionId, solutionRevision: expectedRevision }, data: { solutionRevision: revision } });
    if (updated.count !== 1) throw new CourseQAError('Die Auswahl wurde inzwischen geändert. Bitte neu laden.', 409);
    if (current) await tx.courseQuestionSolution.delete({ where: { questionId } });
    if (answerId) await tx.courseQuestionSolution.create({ data: { questionId, answerId, revision } });
    return { acceptedAnswerId: answerId, revision, changed: true };
  });
}

export async function hideCourseQuestion(courseId: string, questionId: string, actor: Actor, hidden: unknown) {
  validatedId(questionId, 'Frage');
  if (typeof hidden !== 'boolean') throw new CourseQAError('Ungültige Sichtbarkeit.', 400);
  return courseQATransaction(async tx => {
    const access = await authorize(tx, courseId, actor, true);
    if (!access.canModerate) throw new CourseQAError('Kein Zugriff auf die Kursmoderation.', 403);
    const question = await tx.courseQuestion.findUnique({ where: { id: questionId }, select: { courseId: true, hiddenAt: true } });
    if (!question || question.courseId !== courseId) throw new CourseQAError('Frage nicht gefunden.', 404);
    if (Boolean(question.hiddenAt) !== hidden) await tx.courseQuestion.update({ where: { id: questionId }, data: { hiddenAt: hidden ? new Date() : null } });
    return { hidden };
  });
}

export async function hideCourseAnswer(courseId: string, questionId: string, answerId: string, actor: Actor, hidden: unknown) {
  validatedId(questionId, 'Frage'); validatedId(answerId, 'Antwort');
  if (typeof hidden !== 'boolean') throw new CourseQAError('Ungültige Sichtbarkeit.', 400);
  return courseQATransaction(async tx => {
    const access = await authorize(tx, courseId, actor, true);
    if (!access.canModerate) throw new CourseQAError('Kein Zugriff auf die Kursmoderation.', 403);
    const answer = await tx.courseAnswer.findUnique({ where: { id: answerId },
      select: { questionId: true, hiddenAt: true, question: { select: { courseId: true } } } });
    if (!answer || answer.questionId !== questionId || answer.question.courseId !== courseId) throw new CourseQAError('Antwort nicht gefunden.', 404);
    if (Boolean(answer.hiddenAt) !== hidden) await tx.courseAnswer.update({ where: { id: answerId }, data: { hiddenAt: hidden ? new Date() : null } });
    if (hidden) {
      const removed = await tx.courseQuestionSolution.deleteMany({ where: { questionId, answerId } });
      if (removed.count) await tx.courseQuestion.update({ where: { id: questionId }, data: { solutionRevision: randomUUID() } });
    }
    return { hidden };
  });
}
