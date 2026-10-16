import 'server-only';

import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { getReadableSpace, type SpaceAccess } from '@/lib/server/space-access';
import { parseSpaceRequestId, SPACE_ID_RE, spaceTransaction, SpaceApiError } from '@/lib/server/space-api';
import { sanitizeTextServer } from '@/lib/server/sanitize-html';

export const POLL_PAGE_SIZE = 10;
export const POLL_CHANGE_LIMIT = 100;
const MAX_REVISION = 2147483646;
const notFound = () => new SpaceApiError('Umfrage nicht gefunden', 404);
const conflict = () => new SpaceApiError('Die Auswahl wurde inzwischen geändert. Bitte neu laden.', 409);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function pollId(value: string) {
  if (!SPACE_ID_RE.test(value)) throw notFound();
  return value;
}

function exactBody(body: Record<string, unknown>, keys: string[]) {
  if (Object.keys(body).length !== keys.length || keys.some(key => !Object.hasOwn(body, key))) {
    throw new SpaceApiError('Ungültige Umfragedaten', 400);
  }
}

export function parsePollInput(body: Record<string, unknown>) {
  exactBody(body, ['question', 'options', 'requestId']);
  if (typeof body.question !== 'string' || body.question.length > 800 || !Array.isArray(body.options) ||
      body.options.length < 2 || body.options.length > 8 || body.options.some(label => typeof label !== 'string' || label.length > 400)) {
    throw new SpaceApiError('Frage und zwei bis acht Antworten sind erforderlich', 400);
  }
  const question = sanitizeTextServer(body.question);
  const options = (body.options as string[]).map(label => sanitizeTextServer(label));
  if (Array.from(question).length < 5 || question.length > 200 || options.some(label => !label.length || label.length > 100) ||
      new Set(options.map(label => label.toLocaleLowerCase('de-DE'))).size !== options.length) {
    throw new SpaceApiError('Frage oder Antworten sind ungültig oder doppelt', 400);
  }
  return { question, options, requestId: parseSpaceRequestId(body.requestId), payloadDigest: digest({ question, options }) };
}

export function parsePollVote(body: Record<string, unknown>) {
  exactBody(body, ['optionId', 'expectedRevision', 'requestId']);
  if (typeof body.optionId !== 'string' || !SPACE_ID_RE.test(body.optionId) ||
      typeof body.expectedRevision !== 'number' || !Number.isInteger(body.expectedRevision) ||
      body.expectedRevision < 0 || body.expectedRevision >= MAX_REVISION) {
    throw new SpaceApiError('Ungültige Auswahl', 400);
  }
  const { optionId, expectedRevision } = body;
  return { optionId, expectedRevision, requestId: parseSpaceRequestId(body.requestId), payloadDigest: digest({ optionId, expectedRevision }) };
}

export function parsePollModeration(body: Record<string, unknown>) {
  if (Object.hasOwn(body, 'closed')) {
    exactBody(body, ['closed']);
    if (body.closed !== true) throw new SpaceApiError('Umfragen können nur geschlossen werden', 400);
    return { closed: true } as const;
  }
  exactBody(body, ['hidden', 'expectedRevision']);
  if (typeof body.hidden !== 'boolean' || typeof body.expectedRevision !== 'number' ||
      !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision >= MAX_REVISION) {
    throw new SpaceApiError('Ungültiger Moderationsstand', 400);
  }
  return { hidden: body.hidden, expectedRevision: body.expectedRevision } as const;
}

async function accessPolls(spaceId: string, userId: string, tx: Prisma.TransactionClient) {
  const access = await getReadableSpace(spaceId, userId, tx);
  if (!access) throw notFound();
  return access;
}

const pollSelect = {
  id: true, spaceId: true, question: true, createdAt: true, closedAt: true, hiddenAt: true, moderationRevision: true,
  options: { select: { id: true, label: true, position: true, _count: { select: { votes: true } } }, orderBy: { position: 'asc' as const } },
} satisfies Prisma.SpacePollSelect;
type PollRow = Prisma.SpacePollGetPayload<{ select: typeof pollSelect }>;

async function findPoll(spaceId: string, id: string, access: SpaceAccess, tx: Prisma.TransactionClient) {
  const row = await tx.spacePoll.findFirst({ where: { id, spaceId, ...(access.canManage ? {} : { hiddenAt: null }) }, select: pollSelect });
  if (!row) throw notFound();
  return row;
}

async function projectPoll(row: PollRow, userId: string, access: SpaceAccess, tx: Prisma.TransactionClient) {
  const own = await tx.spacePollVote.findUnique({ where: { pollId_userId: { pollId: row.id, userId } }, select: { optionId: true, revision: true } });
  return {
    id: row.id, spaceId: row.spaceId, question: row.question, createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null, hiddenAt: row.hiddenAt?.toISOString() ?? null,
    moderationRevision: row.moderationRevision,
    options: row.options.map(option => ({ id: option.id, label: option.label, votes: option._count.votes })),
    totalVotes: row.options.reduce((sum, option) => sum + option._count.votes, 0),
    ownVote: own ?? { optionId: null, revision: 0 },
    canVote: access.isMember && !row.closedAt && !row.hiddenAt,
    canManage: access.canManage,
  };
}

type PollCursor = { id: string; createdAt: Date };
function readCursor(request: Request, spaceId: string): PollCursor | null {
  const raw = new URL(request.url).searchParams.get('cursor');
  if (raw === null) return null;
  try {
    if (!raw || raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const bytes = Buffer.from(raw, 'base64url');
    const value = JSON.parse(bytes.toString('utf8'));
    if (bytes.toString('base64url') !== raw || value.v !== 1 || value.kind !== 'polls' || value.spaceId !== spaceId ||
        typeof value.id !== 'string' || !SPACE_ID_RE.test(value.id) || typeof value.createdAt !== 'string') throw new Error();
    const createdAt = new Date(value.createdAt);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== value.createdAt) throw new Error();
    return { id: value.id, createdAt };
  } catch { throw new SpaceApiError('Ungültiger Cursor', 400); }
}

export async function listPolls(spaceId: string, userId: string, request: Request) {
  return spaceTransaction(async tx => {
    const access = await accessPolls(spaceId, userId, tx);
    // Validate cursor after access, so a revoked viewer learns no scope details.
    const cursor = readCursor(request, spaceId);
    const rows = await tx.spacePoll.findMany({ where: { spaceId, ...(access.canManage ? {} : { hiddenAt: null }),
      ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) },
      select: pollSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: POLL_PAGE_SIZE + 1 });
    const items = rows.slice(0, POLL_PAGE_SIZE);
    const last = items[items.length - 1];
    return { items: await Promise.all(items.map(row => projectPoll(row, userId, access, tx))),
      nextCursor: rows.length > POLL_PAGE_SIZE ? Buffer.from(JSON.stringify({ v: 1, kind: 'polls', spaceId, id: last.id, createdAt: last.createdAt.toISOString() })).toString('base64url') : null };
  });
}

export async function readPoll(spaceId: string, id: string, userId: string) {
  return spaceTransaction(async tx => {
    const access = await accessPolls(spaceId, userId, tx);
    return projectPoll(await findPoll(spaceId, id, access, tx), userId, access, tx);
  });
}

/** Unique races restart the complete authorization snapshot, never a partial write. */
async function pollWrite<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  try { return await spaceTransaction(work); }
  catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    return spaceTransaction(work);
  }
}

export async function createPoll(spaceId: string, userId: string, input: ReturnType<typeof parsePollInput>) {
  return pollWrite(async tx => {
    const access = await accessPolls(spaceId, userId, tx);
    if (!access.canManage) throw new SpaceApiError('Nicht autorisiert', 403);
    const previous = await tx.spacePoll.findUnique({ where: { spaceId_requestId: { spaceId, requestId: input.requestId } },
      select: { id: true, creatorId: true, payloadDigest: true } });
    if (previous) {
      if (previous.creatorId !== userId || previous.payloadDigest !== input.payloadDigest) throw new SpaceApiError('Anfrage-ID bereits verwendet', 409);
      return { item: await projectPoll(await findPoll(spaceId, previous.id, access, tx), userId, access, tx), created: false };
    }
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [spaceDaily, ownDaily] = await Promise.all([
      tx.spacePoll.count({ where: { spaceId, createdAt: { gte: since } } }),
      tx.spacePoll.count({ where: { creatorId: userId, createdAt: { gte: since } } }),
    ]);
    if (spaceDaily >= 10 || ownDaily >= 20) throw new SpaceApiError('Heute wurden bereits genügend Umfragen erstellt. Bitte später erneut versuchen.', 429);
    const row = await tx.spacePoll.create({ data: { spaceId, creatorId: userId, question: input.question,
      requestId: input.requestId, payloadDigest: input.payloadDigest,
      options: { create: input.options.map((label, position) => ({ label, position })) } }, select: pollSelect });
    return { item: await projectPoll(row, userId, access, tx), created: true };
  });
}

export async function votePoll(spaceId: string, id: string, userId: string, input: ReturnType<typeof parsePollVote>) {
  return pollWrite(async tx => {
    const access = await accessPolls(spaceId, userId, tx);
    const poll = await findPoll(spaceId, id, access, tx);
    if (!access.isMember) throw new SpaceApiError('Zum Abstimmen ist eine Mitgliedschaft erforderlich', 403);
    const previous = await tx.spacePollVoteRequest.findUnique({ where: { pollId_userId_requestId: { pollId: id, userId, requestId: input.requestId } }, select: { payloadDigest: true } });
    if (previous) {
      if (previous.payloadDigest !== input.payloadDigest) throw new SpaceApiError('Anfrage-ID bereits verwendet', 409);
      return projectPoll(poll, userId, access, tx);
    }
    if (poll.closedAt || poll.hiddenAt) throw new SpaceApiError('Diese Umfrage ist geschlossen oder ausgeblendet', 409);
    if (!poll.options.some(option => option.id === input.optionId)) throw new SpaceApiError('Antwort gehört nicht zu dieser Umfrage', 400);
    const key = { pollId_userId: { pollId: id, userId } };
    const vote = await tx.spacePollVote.findUnique({ where: key, select: { revision: true } });
    if ((vote?.revision ?? 0) !== input.expectedRevision) throw conflict();
    const [changes, recent] = await Promise.all([
      tx.spacePollVoteRequest.count({ where: { pollId: id, userId } }),
      tx.spacePollVoteRequest.count({ where: { userId, createdAt: { gte: new Date(Date.now() - 60_000) } } }),
    ]);
    if (changes >= POLL_CHANGE_LIMIT) throw new SpaceApiError('Für diese Umfrage sind höchstens 100 gespeicherte Abstimmungen pro Person möglich.', 429);
    if (recent >= 12) throw new SpaceApiError('Zu viele Änderungen. Bitte später erneut versuchen.', 429);
    const data = { optionId: input.optionId, revision: input.expectedRevision + 1 };
    await tx.spacePollVote.upsert({ where: key, update: data, create: { pollId: id, userId, ...data } });
    await tx.spacePollVoteRequest.create({ data: { pollId: id, userId, requestId: input.requestId, payloadDigest: input.payloadDigest } });
    // Re-read aggregate counts after the write in this same snapshot.
    return projectPoll(await findPoll(spaceId, id, access, tx), userId, access, tx);
  });
}

export async function moderatePoll(spaceId: string, id: string, userId: string, input: ReturnType<typeof parsePollModeration>) {
  return spaceTransaction(async tx => {
    const access = await accessPolls(spaceId, userId, tx);
    if (!access.canManage) throw new SpaceApiError('Nicht autorisiert', 403);
    const poll = await findPoll(spaceId, id, access, tx);
    if ('closed' in input) {
      if (!poll.closedAt) await tx.spacePoll.update({ where: { id }, data: { closedAt: new Date() } });
    } else if (Boolean(poll.hiddenAt) !== input.hidden) {
      if (poll.moderationRevision !== input.expectedRevision) throw conflict();
      await tx.spacePoll.update({ where: { id }, data: { hiddenAt: input.hidden ? new Date() : null, moderationRevision: { increment: 1 } } });
    }
    return projectPoll(await findPoll(spaceId, id, access, tx), userId, access, tx);
  });
}
