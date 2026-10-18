import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { createHash } from 'node:crypto';
import { getReadableSpace, type SpaceAccess } from '@/lib/server/space-access';
import { parseSpaceRequestId, SPACE_ID_RE, spaceTransaction, SpaceApiError } from '@/lib/server/space-api';
import { sanitizeTextServer } from '@/lib/server/sanitize-html';
import { d1SpacePoll, d1SpacePolls } from '@/lib/server/d1-space-poll-reads';
import { createD1SpacePoll } from '@/lib/server/d1-space-poll-create';
import { voteD1SpacePoll } from '@/lib/server/d1-space-poll-vote';
import { moderateD1SpacePoll } from '@/lib/server/d1-space-poll-moderation';

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
  let cursor: PollCursor | null = null;
  let cursorError: unknown;
  try { cursor = readCursor(request, spaceId); }
  catch (error) { cursorError = error; }
  // The protected statement checks live access before revealing cursor errors,
  // and an invalid cursor suppresses all poll/option projections in SQL.
  const page = await d1SpacePolls(userId, spaceId, cursor, cursorError === undefined);
  if (cursorError !== undefined) throw cursorError;
  return page;
}

export async function readPoll(spaceId: string, id: string, userId: string) {
  return d1SpacePoll(userId, spaceId, id);
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
  return createD1SpacePoll(userId, spaceId, input);
}

export async function votePoll(spaceId: string, id: string, userId: string, input: ReturnType<typeof parsePollVote>) {
  return voteD1SpacePoll(userId, spaceId, id, input);
}

export async function moderatePoll(spaceId: string, id: string, userId: string, input: ReturnType<typeof parsePollModeration>) {
  return moderateD1SpacePoll(userId, spaceId, id, input);
}
