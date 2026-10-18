import 'server-only';

import { Prisma, type SpaceMissionContributionKind } from '@/generated/prisma/client';
import { createHash } from 'node:crypto';
import { readOwnMissionBookmark } from '@/lib/server/space-mission-bookmarks';
import { getReadableSpace, type SpaceAccess } from '@/lib/server/space-access';
import { parseSpaceRequestId, SPACE_ID_RE, spaceTransaction, SpaceApiError } from '@/lib/server/space-api';
import { sanitizeTextServer } from '@/lib/server/sanitize-html';
import type { MissionNextAction } from '@/types/space-mission-invitations';
import { invitationTransaction, purgeMissionInvitations, revokeMissionParticipationInvitations } from '@/lib/server/space-mission-invitation-state';
import { MissionWeekError, parseMissionWeek, resolveMissionWeek, missionWindowState } from '@/lib/mission-week-clock';
import { listD1MissionModeration, listD1SpaceMissions, readD1SpaceMission } from '@/lib/server/d1-space-missions';
import { createD1SpaceMission } from '@/lib/server/d1-space-mission-create';
import { closeD1SpaceMission } from '@/lib/server/d1-space-mission-close';
import { setD1MissionParticipation } from '@/lib/server/d1-space-mission-participation';

export const MISSION_PARTICIPANT_LIMIT = 5;
export const MISSION_PAGE_SIZE = 20;
export const MISSION_CONTRIBUTION_LIMIT = 5;
const MAX_EPOCH = 2147483646;
const notFound = () => new SpaceApiError('Mission nicht gefunden', 404);
const conflict = () => new SpaceApiError('Teilnahme wurde geändert. Bitte neu laden.', 409);

export function missionId(value: string) {
  if (!SPACE_ID_RE.test(value)) throw notFound();
  return value;
}

export function missionBody(body: Record<string, unknown>, keys: string[]) {
  if (Object.keys(body).length !== keys.length || keys.some(key => !Object.hasOwn(body, key))) {
    throw new SpaceApiError('Ungültige Missionsdaten', 400);
  }
  return body;
}

export function parseMissionInput(body: Record<string, unknown>) {
  const hasWeek = Object.hasOwn(body, 'week');
  missionBody(body, hasWeek ? ['title', 'prompt', 'requestId', 'week'] : ['title', 'prompt', 'requestId']);
  if (typeof body.title !== 'string' || body.title.length > 400 ||
      typeof body.prompt !== 'string' || body.prompt.length > 8000) {
    throw new SpaceApiError('Titel oder Aufgabe ist ungültig', 400);
  }
  const title = sanitizeTextServer(body.title);
  const prompt = sanitizeTextServer(body.prompt);
  if (title.length < 3 || title.length > 100 || prompt.length < 10 || prompt.length > 2000) {
    throw new SpaceApiError('Titel oder Aufgabe ist ungültig', 400);
  }
  const requestId = parseSpaceRequestId(body.requestId);
  let week: ReturnType<typeof parseMissionWeek> | null = null;
  try { if (hasWeek) week = parseMissionWeek(body.week); }
  catch (error) { if (error instanceof MissionWeekError) throw new SpaceApiError(error.message, 400); throw error; }
  // Preserve the exact legacy {title,prompt} digest. Weekly keys bind only the
  // validated input in this fixed order, never recalculated UTC boundaries.
  const payload = week ? { title, prompt, week: { startDate: week.startDate, timezone: week.timezone } } : { title, prompt };
  const payloadDigest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return { title, prompt, requestId, payloadDigest, week };
}

export function parseMissionEpoch(body: Record<string, unknown>, join: boolean) {
  const key = join ? 'expectedEpoch' : 'epoch';
  missionBody(body, [key]);
  const epoch = body[key];
  if (typeof epoch !== 'number' || !Number.isInteger(epoch) || epoch < (join ? 0 : 1) || epoch > MAX_EPOCH) {
    throw new SpaceApiError('Ungültiger Teilnahmestand', 400);
  }
  return epoch;
}

export async function privateMissionAccess(spaceId: string, userId: string, tx: Prisma.TransactionClient) {
  const access = await getReadableSpace(spaceId, userId, tx);
  if (!access || access.space.visibility !== 'PRIVATE') throw notFound();
  return access;
}

const missionSelect = {
  id: true, spaceId: true, title: true, prompt: true, createdAt: true, closedAt: true,
  weekStartsOn: true, weekTimezone: true, weekStartsAt: true, weekEndsAt: true,
  creator: { select: { id: true, name: true, image: true } },
} satisfies Prisma.SpaceMissionSelect;
type MissionRow = Prisma.SpaceMissionGetPayload<{ select: typeof missionSelect }>;

/** Never count consent without current membership and a live learner account. */
export function activeMissionParticipantsWhere(spaceId: string): Prisma.SpaceMissionParticipationWhereInput {
  return { optedOutAt: null, user: { role: 'USER', spaceMemberships: { some: { spaceId } } } };
}

async function findMission(spaceId: string, id: string, tx: Prisma.TransactionClient) {
  const row = await tx.spaceMission.findFirst({ where: { id, spaceId }, select: missionSelect });
  if (!row) throw notFound();
  return row;
}

async function projectMission(row: MissionRow, userId: string, access: SpaceAccess, tx: Prisma.TransactionClient) {
  const [participants, self, account, reservedSlots] = await Promise.all([
    tx.spaceMissionParticipation.findMany({ where: { missionId: row.id, ...activeMissionParticipantsWhere(row.spaceId) },
      select: { joinedAt: true, user: { select: { id: true, name: true, image: true } } },
      orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }], take: MISSION_PARTICIPANT_LIMIT }),
    tx.spaceMissionParticipation.findUnique({ where: { missionId_userId: { missionId: row.id, userId } },
      select: { epoch: true, joinedAt: true, optedOutAt: true } }),
    tx.user.findUnique({ where: { id: userId }, select: { role: true } }),
    // Ineligible consent is omitted from display but cannot free a capacity
    // slot until explicitly revoked. This fails closed under legacy/raw edits.
    tx.spaceMissionParticipation.count({ where: { missionId: row.id, optedOutAt: null } }),
  ]);
  const active = Boolean(self && !self.optedOutAt && access.isMember && account?.role === 'USER');
  const visible = await visibleMissionContributions(row.spaceId, row.id, tx);
  const own = active && self ? await tx.spaceMissionContribution.findMany({ where: {
    missionId: row.id, authorId: userId, epoch: self.epoch, withdrawnAt: null,
  }, select: { id: true, kind: true, hiddenAt: true, targetContributionId: true },
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 2 * MISSION_CONTRIBUTION_LIMIT }) : [];
  const visibleIds = new Set(visible.map(item => item.id));
  const insightAuthors = new Set(visible.filter(item => item.kind === 'INSIGHT').map(item => item.authorId)).size;
  const hasCrossPersonBuildOn = visible.some(item => item.kind === 'BUILD_ON');
  let myNextAction: MissionNextAction | null = null;
  if (active) {
    const ownInsight = visible.some(item => item.authorId === userId && item.kind === 'INSIGHT');
    const ownBuildOn = own.find(item => item.kind === 'BUILD_ON' && !item.hiddenAt);
    const [insightAttempts, buildOnAttempts] = await Promise.all(['INSIGHT', 'BUILD_ON'].map(kind =>
      tx.spaceMissionContribution.count({ where: { missionId: row.id, authorId: userId, kind: kind as SpaceMissionContributionKind } })));
    const target = visible.find(item => item.kind === 'INSIGHT' && item.authorId !== userId);
    if (row.closedAt) myNextAction = { kind: 'CLOSED' };
    else if (insightAuthors >= 2 && hasCrossPersonBuildOn) myNextAction = { kind: 'CURRENT_GOAL_REACHED' };
    else if (!ownInsight) myNextAction = { kind: insightAttempts < MISSION_CONTRIBUTION_LIMIT ? 'SHARE_INSIGHT' : 'LIMIT_REACHED' };
    else if (ownBuildOn && !visibleIds.has(ownBuildOn.id)) myNextAction = { kind: 'REVIEW_BUILD_ON', contributionId: ownBuildOn.id };
    else if (!ownBuildOn && target && buildOnAttempts < MISSION_CONTRIBUTION_LIMIT) myNextAction = { kind: 'BUILD_ON', targetContributionId: target.id };
    else if (!ownBuildOn && buildOnAttempts >= MISSION_CONTRIBUTION_LIMIT) myNextAction = { kind: 'LIMIT_REACHED' };
    else myNextAction = { kind: 'WAIT_FOR_PEER' };
  }
  return {
    id: row.id, spaceId: row.spaceId, title: row.title, prompt: row.prompt, creator: row.creator,
    createdAt: row.createdAt.toISOString(), closedAt: row.closedAt?.toISOString() ?? null,
    week: row.weekStartsOn !== null && row.weekTimezone !== null && row.weekStartsAt !== null && row.weekEndsAt !== null
      ? { startDate: row.weekStartsOn, timezone: row.weekTimezone, startsAt: row.weekStartsAt.toISOString(), endsAt: row.weekEndsAt.toISOString() } : null,
    windowState: missionWindowState(row.weekEndsAt, new Date()),
    participants: participants.map(item => ({ ...item.user, joinedAt: item.joinedAt.toISOString() })),
    participantLimit: MISSION_PARTICIPANT_LIMIT,
    participation: { epoch: self?.epoch ?? 0, active, joinedAt: self?.joinedAt.toISOString() ?? null,
      optedOutAt: self?.optedOutAt?.toISOString() ?? null },
    ownBookmark: access.isMember && account && !row.closedAt ? await readOwnMissionBookmark(row.id, userId, tx) : null,
    canManage: access.canManage,
    myNextAction,
    canJoin: !row.closedAt && !active && access.isMember && account?.role === 'USER' && reservedSlots < MISSION_PARTICIPANT_LIMIT,
    contributions: visible.map(item => serializeContribution(item, userId)),
    ownContributions: own.map(item => ({ id: item.id, kind: item.kind, hidden: Boolean(item.hiddenAt),
      targetUnavailable: Boolean(item.targetContributionId && !visibleIds.has(item.targetContributionId)), canWithdraw: true })),
    progress: { insightAuthors, hasCrossPersonBuildOn, complete: insightAuthors >= 2 && hasCrossPersonBuildOn },
  };
}

export async function readMissionInTransaction(spaceId: string, id: string, userId: string, tx: Prisma.TransactionClient) {
  const access = await privateMissionAccess(spaceId, userId, tx);
  return projectMission(await findMission(spaceId, id, tx), userId, access, tx);
}

export async function readMission(spaceId: string, id: string, userId: string) {
  return readD1SpaceMission(spaceId, id, userId);
}

type MissionCursor = { createdAt: Date; id: string };
function readCursor(request: Request, spaceId: string): MissionCursor | null {
  const raw = new URL(request.url).searchParams.get('cursor');
  if (raw === null) return null;
  try {
    if (!raw || raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const bytes = Buffer.from(raw, 'base64url');
    if (bytes.toString('base64url') !== raw) throw new Error();
    const value = JSON.parse(bytes.toString('utf8'));
    if (value?.v !== 1 || value?.kind !== 'space-missions' || value?.spaceId !== spaceId ||
        typeof value.id !== 'string' || !SPACE_ID_RE.test(value.id) || typeof value.createdAt !== 'string') throw new Error();
    const createdAt = new Date(value.createdAt);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== value.createdAt) throw new Error();
    return { createdAt, id: value.id };
  } catch { throw new SpaceApiError('Ungültiger Cursor', 400); }
}

export async function listMissions(spaceId: string, userId: string, request: Request) {
  return listD1SpaceMissions(spaceId, userId, request);
}

export async function createMission(spaceId: string, userId: string, input: ReturnType<typeof parseMissionInput>) {
  return createD1SpaceMission(userId, spaceId, input);
}

export async function closeMission(spaceId: string, id: string, userId: string) {
  return closeD1SpaceMission(userId, spaceId, id);
}

/** Shared transaction-local join core. Invitation acceptance forbids the normal
 * duplicate-active replay and never opens another transaction. */
export async function joinMissionInTransaction(spaceId: string, id: string, userId: string, epoch: number,
  tx: Prisma.TransactionClient, allowDuplicate = true) {
  const access = await privateMissionAccess(spaceId, userId, tx);
  const mission = await findMission(spaceId, id, tx);
  const key = { missionId_userId: { missionId: id, userId } };
  const [current, account] = await Promise.all([
    tx.spaceMissionParticipation.findUnique({ where: key }),
    tx.user.findUnique({ where: { id: userId }, select: { role: true } }),
  ]);
  if (!access.isMember || account?.role !== 'USER') throw notFound();
  // Preserve ordinary join replay's existing closed-mission behavior. Invitation
  // decisions check OPEN first and pass false, so accepted replay never joins.
  if (allowDuplicate && current?.epoch === epoch + 1 && !current.optedOutAt) return { mission, access };
  if (mission.closedAt) throw new SpaceApiError('Mission ist geschlossen', 409, 'MISSION_CLOSED');
  if ((current?.epoch ?? 0) !== epoch || current && !current.optedOutAt || epoch >= MAX_EPOCH) throw conflict();
  const count = await tx.spaceMissionParticipation.count({ where: { missionId: id, optedOutAt: null } });
  if (count >= MISSION_PARTICIPANT_LIMIT) throw new SpaceApiError('Mission hat bereits fünf Teilnehmende', 409, 'MISSION_FULL');
  const data = { epoch: epoch + 1, joinedAt: new Date(), optedOutAt: null };
  await tx.spaceMissionParticipation.upsert({ where: key, update: data, create: { missionId: id, userId, ...data } });
  return { mission, access };
}

export async function setMissionParticipation(spaceId: string, id: string, userId: string, epoch: number, join: boolean) {
  return setD1MissionParticipation(spaceId, id, userId, epoch, join);
}

/** Must run inside the private Space member-removal transaction. */
export async function revokeSpaceMissionParticipation(spaceId: string, userId: string, tx: Prisma.TransactionClient) {
  await tx.spaceMissionParticipation.updateMany({ where: { userId, optedOutAt: null, mission: { spaceId } },
    data: { optedOutAt: new Date() } });
}

const contributionSelect = {
  id: true, authorId: true, epoch: true, kind: true, content: true, createdAt: true, targetContributionId: true,
  author: { select: { id: true, name: true, image: true } },
} satisfies Prisma.SpaceMissionContributionSelect;
type ContributionRow = Prisma.SpaceMissionContributionGetPayload<{ select: typeof contributionSelect }>;

function serializeContribution(row: ContributionRow, userId: string) {
  return { id: row.id, kind: row.kind, content: row.content, author: row.author,
    createdAt: row.createdAt.toISOString(), targetContributionId: row.targetContributionId, canWithdraw: row.authorId === userId };
}

/** Call only after privateMissionAccess in the same transaction. At most ten
 * current contributions survive the live-kind unique index and five-person cap.
 * Targets are resolved from that same eligible snapshot, never from history. */
export async function visibleMissionContributions(spaceId: string, id: string, tx: Prisma.TransactionClient) {
  const consent = await tx.spaceMissionParticipation.findMany({ where: { missionId: id, ...activeMissionParticipantsWhere(spaceId) },
    select: { userId: true, epoch: true }, take: MISSION_PARTICIPANT_LIMIT });
  if (!consent.length) return [];
  const rows = await tx.spaceMissionContribution.findMany({ where: { missionId: id, hiddenAt: null, withdrawnAt: null,
    OR: consent.map(item => ({ authorId: item.userId, epoch: item.epoch })) }, select: contributionSelect,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 2 * MISSION_PARTICIPANT_LIMIT });
  const insights = new Map(rows.filter(item => item.kind === 'INSIGHT').map(item => [item.id, item]));
  return rows.filter(item => item.kind === 'INSIGHT' || item.targetContributionId &&
    insights.has(item.targetContributionId) && insights.get(item.targetContributionId)!.authorId !== item.authorId);
}

export function parseMissionContribution(body: Record<string, unknown>) {
  missionBody(body, ['kind', 'content', 'epoch', 'requestId', 'targetContributionId']);
  if ((body.kind !== 'INSIGHT' && body.kind !== 'BUILD_ON') || typeof body.content !== 'string' || body.content.length > 8000) {
    throw new SpaceApiError('Ungültiger Missionsbeitrag', 400);
  }
  const content = sanitizeTextServer(body.content);
  if (content.length < 10 || content.length > 2000) throw new SpaceApiError('Beitrag muss 10 bis 2000 Zeichen enthalten', 400);
  const epoch = parseMissionEpoch({ epoch: body.epoch }, false);
  const requestId = parseSpaceRequestId(body.requestId);
  const targetContributionId = body.targetContributionId;
  if (body.kind === 'INSIGHT' ? targetContributionId !== null : typeof targetContributionId !== 'string' || !SPACE_ID_RE.test(targetContributionId)) {
    throw new SpaceApiError('Ungültiger Bezug', 400);
  }
  const kind: SpaceMissionContributionKind = body.kind;
  const payloadDigest = createHash('sha256').update(JSON.stringify({ kind, content, epoch, targetContributionId })).digest('hex');
  return { kind, content, epoch, requestId, payloadDigest, targetContributionId: targetContributionId as string | null };
}

async function requireMissionConsent(spaceId: string, id: string, userId: string, epoch: number, access: SpaceAccess, tx: Prisma.TransactionClient) {
  const [account, consent] = await Promise.all([
    tx.user.findUnique({ where: { id: userId }, select: { role: true } }),
    tx.spaceMissionParticipation.findUnique({ where: { missionId_userId: { missionId: id, userId } }, select: { epoch: true, optedOutAt: true } }),
  ]);
  if (!access.isMember || account?.role !== 'USER') throw notFound();
  if (!consent || consent.optedOutAt || consent.epoch !== epoch) throw conflict();
}

export async function contributeToMission(spaceId: string, id: string, userId: string, input: ReturnType<typeof parseMissionContribution>) {
  const work = async (tx: Prisma.TransactionClient, replayOnly = false) => {
    const access = await privateMissionAccess(spaceId, userId, tx);
    const mission = await findMission(spaceId, id, tx);
    await requireMissionConsent(spaceId, id, userId, input.epoch, access, tx);
    const visible = await visibleMissionContributions(spaceId, id, tx);
    const existing = await tx.spaceMissionContribution.findUnique({ where: { missionId_authorId_requestId: {
      missionId: id, authorId: userId, requestId: input.requestId,
    } }, select: { id: true, payloadDigest: true } });
    if (existing) {
      if (existing.payloadDigest !== input.payloadDigest) throw new SpaceApiError('Anfrage-ID wurde bereits verwendet', 409);
      if (!visible.some(item => item.id === existing.id)) throw notFound();
      return { item: await projectMission(mission, userId, access, tx), created: false };
    }
    if (mission.closedAt) throw new SpaceApiError('Mission ist geschlossen', 409);
    if (input.kind === 'BUILD_ON' && !visible.some(item => item.id === input.targetContributionId && item.kind === 'INSIGHT' && item.authorId !== userId)) throw notFound();
    const live = await tx.spaceMissionContribution.findFirst({ where: { missionId: id, authorId: userId, epoch: input.epoch,
      kind: input.kind, hiddenAt: null, withdrawnAt: null }, select: { id: true } });
    if (replayOnly || live) throw new SpaceApiError('Für diesen Schritt ist bereits ein Beitrag vorhanden', 409);
    const attempts = await tx.spaceMissionContribution.count({ where: { missionId: id, authorId: userId, kind: input.kind } });
    if (attempts >= MISSION_CONTRIBUTION_LIMIT) throw new SpaceApiError('Beitragslimit für diesen Schritt erreicht', 409);
    await tx.spaceMissionContribution.create({ data: { missionId: id, authorId: userId, ...input }, select: { id: true } });
    return { item: await projectMission(mission, userId, access, tx), created: true };
  };
  try { return await spaceTransaction(tx => work(tx)); }
  catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    return spaceTransaction(tx => work(tx, true));
  }
}

export async function withdrawMissionContribution(spaceId: string, id: string, contributionId: string, userId: string, epoch: number) {
  return spaceTransaction(async tx => {
    const access = await privateMissionAccess(spaceId, userId, tx);
    const mission = await findMission(spaceId, id, tx);
    // Leaving can hide posts, but must not prevent their later author withdrawal.
    const row = await tx.spaceMissionContribution.findFirst({ where: { id: contributionId, missionId: id, authorId: userId, epoch },
      select: { withdrawnAt: true } });
    if (!row) throw notFound();
    if (!row.withdrawnAt) await tx.spaceMissionContribution.update({ where: { id: contributionId }, data: { withdrawnAt: new Date() } });
    return projectMission(mission, userId, access, tx);
  });
}

export async function moderateMissionContribution(spaceId: string, id: string, contributionId: string, userId: string, hidden: boolean) {
  try {
    return await spaceTransaction(async tx => {
      const access = await privateMissionAccess(spaceId, userId, tx);
      if (!access.canManage) throw new SpaceApiError('Nicht autorisiert', 403);
      const mission = await findMission(spaceId, id, tx);
      const row = await tx.spaceMissionContribution.findFirst({ where: { id: contributionId, missionId: id }, select: { hiddenAt: true } });
      if (!row) throw notFound();
      if (Boolean(row.hiddenAt) !== hidden) await tx.spaceMissionContribution.update({ where: { id: contributionId }, data: { hiddenAt: hidden ? new Date() : null } });
      // No path writes withdrawnAt=null. Restoring visibility cannot revoke the
      // author's withdrawal or reactivate consent, an epoch or an invalid target.
      return projectMission(mission, userId, access, tx);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new SpaceApiError('Ein neuerer Beitrag belegt diesen Schritt bereits', 409);
    }
    throw error;
  }
}

export async function listMissionModeration(spaceId: string, id: string, userId: string, request: Request) {
  return listD1MissionModeration(spaceId, id, userId, request);
}
