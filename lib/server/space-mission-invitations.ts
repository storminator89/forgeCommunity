import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { reportInvitationFailure } from '@/lib/server/space-mission-invitation-errors';
import { listD1MissionInvitations, readD1InvitationPreference } from '@/lib/server/d1-space-mission-invitation-reads';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DecideMissionInvitation, MissionInvitationAcknowledgment, MissionInvitationCandidates, MissionInvitationDetail,
  MissionInvitationList, PendingMissionInvitation, SendMissionInvitation } from '@/types/space-mission-invitations';
import { parseSpaceRequestId, SPACE_ID_RE, SpaceApiError, spaceTransaction } from '@/lib/server/space-api';
import { joinMissionInTransaction, MISSION_PARTICIPANT_LIMIT, readMissionInTransaction } from '@/lib/server/space-missions';
import { fenceInvitationAccess, fenceInvitationSetting, invitationAccess, invitationConflict, invitationSetting,
  invitationTransaction, invitationUnavailable, INVITATION_MAX_VERSION, INVITATION_NOTICE_TYPE, settleMissionInvitations } from '@/lib/server/space-mission-invitation-state';

const CANDIDATE_LIFETIME = 5 * 60 * 1000;
const INVITATION_LIFETIME = 7 * 24 * 60 * 60 * 1000;
const SENDER_LIMIT = 4;
const MISSION_LIMIT = 20;
const PENDING_LIMIT = 10;
const personSelect = { id: true, name: true, image: true } as const;
const invalid = () => new SpaceApiError('Ungültige Einladungsdaten', 400);
const closed = () => new SpaceApiError('Mission ist geschlossen', 409, 'MISSION_CLOSED');

function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      keys.some(key => !Object.hasOwn(value, key))) throw invalid();
}
function version(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > INVITATION_MAX_VERSION) throw invalid();
  return value;
}
function canonicalBytes(value: unknown, length: number): value is string {
  return typeof value === 'string' && value.length === Math.ceil(length * 8 / 6) && /^[A-Za-z0-9_-]+$/.test(value) &&
    Buffer.from(value, 'base64url').length === length && Buffer.from(value, 'base64url').toString('base64url') === value;
}
export function parseInvitationPreference(body: Record<string, unknown>) {
  exact(body, ['enabled', 'expectedRevision']);
  if (typeof body.enabled !== 'boolean') throw invalid();
  return { enabled: body.enabled, expectedRevision: version(body.expectedRevision) };
}
export function parseInvitationDecision(body: Record<string, unknown>): DecideMissionInvitation {
  exact(body, ['decision', 'expectedRevision']);
  if (body.decision !== 'ACCEPT' && body.decision !== 'DECLINE') throw invalid();
  return { decision: body.decision, expectedRevision: version(body.expectedRevision, 1) };
}
export function parseInvitationSend(body: Record<string, unknown>) {
  exact(body, ['recipientId', 'senderEpoch', 'senderAccessEpoch', 'requestId', 'selection']);
  if (typeof body.recipientId !== 'string' || !SPACE_ID_RE.test(body.recipientId)) throw invalid();
  const selection = body.selection;
  exact(selection, ['validUntil', 'nonce', 'token']);
  if (typeof selection.validUntil !== 'string' || selection.validUntil.length !== 24 ||
      !Number.isFinite(new Date(selection.validUntil).getTime()) || new Date(selection.validUntil).toISOString() !== selection.validUntil ||
      !canonicalBytes(selection.nonce, 16) || !canonicalBytes(selection.token, 32)) throw invalid();
  const input: SendMissionInvitation = { recipientId: body.recipientId, senderEpoch: version(body.senderEpoch, 1),
    senderAccessEpoch: version(body.senderAccessEpoch), requestId: parseSpaceRequestId(body.requestId),
    selection: { validUntil: selection.validUntil, nonce: selection.nonce, token: selection.token } };
  return { ...input, payloadDigest: createHash('sha256').update(JSON.stringify(input)).digest('hex') };
}
function secret() {
  const value = process.env.NEXTAUTH_SECRET;
  if (!value) throw new SpaceApiError('Einladungen sind vorübergehend nicht verfügbar', 503);
  return value;
}
async function liveUser(userId: string, tx: Prisma.TransactionClient) {
  const account = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!account) throw new SpaceApiError('Nicht authentifiziert', 401);
  if (account.role !== 'USER') throw invitationUnavailable();
}
async function scopedMission(spaceId: string, missionId: string, userId: string, tx: Prisma.TransactionClient) {
  await liveUser(userId, tx);
  const mission = await tx.spaceMission.findFirst({ where: { id: missionId, spaceId,
    space: { visibility: 'PRIVATE', members: { some: { userId } } } },
    select: { id: true, spaceId: true, closedAt: true, invitationAttemptCount: true } });
  if (!mission) throw invitationUnavailable();
  return mission;
}
async function senderAuthority(spaceId: string, missionId: string, userId: string, tx: Prisma.TransactionClient) {
  const mission = await scopedMission(spaceId, missionId, userId, tx);
  if (mission.closedAt) throw closed();
  const consent = await tx.spaceMissionParticipation.findUnique({ where: { missionId_userId: { missionId, userId } } });
  if (!consent || consent.optedOutAt) throw invitationUnavailable();
  const [setting, accessEpoch] = await Promise.all([invitationSetting(userId, tx), invitationAccess(missionId, userId, tx)]);
  return { mission, consent, setting, accessEpoch };
}

type Tuple = { missionId: string; senderId: string; recipientId: string; senderEpoch: number; senderAccessEpoch: number;
  senderAccountEpoch: number; recipientAccessEpoch: number; recipientAccountEpoch: number; recipientSettingRevision: number;
  recipientEpoch: number; validUntil: string; nonce: string };
function selectionMac(tuple: Tuple, signingSecret: string) {
  // Array order is versioned and fixed, without storing or exposing the tuple.
  return createHmac('sha256', signingSecret).update(JSON.stringify(['invitation-candidate/v1', tuple.missionId, tuple.senderId,
    tuple.recipientId, tuple.senderEpoch, tuple.senderAccessEpoch, tuple.senderAccountEpoch, tuple.recipientAccessEpoch,
    tuple.recipientAccountEpoch, tuple.recipientSettingRevision, tuple.recipientEpoch, tuple.validUntil, tuple.nonce])).digest();
}
function tokenMatches(tuple: Tuple, token: string, now: Date, signingSecret: string) {
  const until = new Date(tuple.validUntil).getTime();
  if (until <= now.getTime() || until > now.getTime() + CANDIDATE_LIFETIME) return false;
  const bytes = Buffer.from(token, 'base64url');
  const expected = selectionMac(tuple, signingSecret);
  return bytes.length === expected.length && timingSafeEqual(bytes, expected);
}

export async function readInvitationPreference(userId: string) {
  return readD1InvitationPreference(userId);
}
export async function setInvitationPreference(userId: string, input: ReturnType<typeof parseInvitationPreference>) {
  return invitationTransaction(async tx => {
    await liveUser(userId, tx);
    const setting = await invitationSetting(userId, tx);
    if (setting.revision !== input.expectedRevision) throw invitationConflict();
    // A same-value CAS is a write-free no-op. In particular, saving true again
    // must not invalidate pending selections/notices by advancing their fence.
    if (setting.enabled === input.enabled) return { enabled: setting.enabled, revision: setting.revision };
    if (setting.revision >= INVITATION_MAX_VERSION) throw invitationConflict();
    await fenceInvitationSetting(setting, tx);
    const changed = await tx.spaceMissionInvitationSetting.updateMany({ where: setting,
      data: { enabled: input.enabled, revision: setting.revision + 1 } });
    if (changed.count !== 1) throw invitationConflict();
    if (!input.enabled) await settleMissionInvitations({ recipientId: userId }, 'REVOKED', tx);
    return { enabled: input.enabled, revision: setting.revision + 1 };
  });
}

export async function invitationCandidates(spaceId: string, missionId: string, userId: string, request: Request): Promise<MissionInvitationCandidates> {
  return spaceTransaction(async tx => {
    const sender = await senderAuthority(spaceId, missionId, userId, tx);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].length !== 1 || params.getAll('q').length !== 1) throw invalid();
    const q = params.get('q')?.trim() ?? '';
    if (q.length < 2 || q.length > 80) throw invalid();
    const signingSecret = secret();
    const users = await tx.user.findMany({ where: { id: { not: userId }, role: 'USER', name: { contains: q },
      spaceMemberships: { some: { spaceId } }, spaceMissionParticipations: { none: { missionId, optedOutAt: null } } },
      select: personSelect, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 11 });
    const items: MissionInvitationCandidates['items'] = [];
    // More than ten matching names require refinement, without a total count.
    if (users.length <= 10) for (const user of users) {
      const [setting, accessEpoch, consent] = await Promise.all([invitationSetting(user.id, tx), invitationAccess(missionId, user.id, tx),
        tx.spaceMissionParticipation.findUnique({ where: { missionId_userId: { missionId, userId: user.id } }, select: { epoch: true } })]);
      const validUntil = new Date(Date.now() + CANDIDATE_LIFETIME).toISOString();
      const nonce = randomBytes(16).toString('base64url');
      const token = selectionMac({ missionId, senderId: userId, recipientId: user.id, senderEpoch: sender.consent.epoch,
        senderAccessEpoch: sender.accessEpoch, senderAccountEpoch: sender.setting.accountEpoch, recipientAccessEpoch: accessEpoch,
        recipientAccountEpoch: setting.accountEpoch, recipientSettingRevision: setting.revision,
        recipientEpoch: consent?.epoch ?? 0, validUntil, nonce }, signingSecret).toString('base64url');
      items.push({ user, selection: { validUntil, nonce, token } });
    }
    return { items, senderEpoch: sender.consent.epoch, senderAccessEpoch: sender.accessEpoch };
  });
}

const pendingInclude = {
  mission: { include: { space: { select: { id: true, name: true, visibility: true } } } },
  sender: { select: { ...personSelect, role: true } }, recipient: { select: { id: true, role: true } },
} satisfies Prisma.SpaceMissionInvitationInclude;
type PendingRow = Prisma.SpaceMissionInvitationGetPayload<{ include: typeof pendingInclude }>;

/** One batched snapshot for current roles, actual membership, settings, access
 * and participation. Projection and notice resolver share this exact predicate. */
async function pendingSnapshot(rows: PendingRow[], now: Date, tx: Prisma.TransactionClient) {
  const users = [...new Set(rows.flatMap(row => [row.recipientId, ...(row.senderId ? [row.senderId] : [])]))];
  const missions = [...new Set(rows.map(row => row.missionId))];
  const spaces = [...new Set(rows.map(row => row.mission.spaceId))];
  const [settings, access, consents, memberships, counts] = rows.length ? await Promise.all([
    tx.spaceMissionInvitationSetting.findMany({ where: { userId: { in: users } } }),
    tx.spaceMissionInvitationAccess.findMany({ where: { missionId: { in: missions }, userId: { in: users } } }),
    tx.spaceMissionParticipation.findMany({ where: { missionId: { in: missions }, userId: { in: users } }, select: { missionId: true, userId: true, epoch: true, optedOutAt: true } }),
    tx.spaceMember.findMany({ where: { spaceId: { in: spaces }, userId: { in: users } }, select: { spaceId: true, userId: true } }),
    tx.spaceMissionParticipation.groupBy({ by: ['missionId'], where: { missionId: { in: missions }, optedOutAt: null }, _count: { _all: true } }),
  ]) : [[], [], [], [], []];
  const key = (a: string, b: string) => JSON.stringify([a, b]);
  const settingMap = new Map(settings.map(row => [row.userId, row]));
  const accessMap = new Map(access.map(row => [key(row.missionId, row.userId), row.epoch]));
  const consentMap = new Map(consents.map(row => [key(row.missionId, row.userId), row]));
  const memberSet = new Set(memberships.map(row => key(row.spaceId, row.userId)));
  const countMap = new Map(counts.map(row => [row.missionId, row._count._all]));
  return rows.map(row => {
    const sender = row.senderId ? settingMap.get(row.senderId) : undefined;
    const recipient = settingMap.get(row.recipientId);
    const senderConsent = row.senderId ? consentMap.get(key(row.missionId, row.senderId)) : undefined;
    const recipientConsent = consentMap.get(key(row.missionId, row.recipientId));
    const expired = Boolean(row.expiresAt && now.getTime() >= row.expiresAt.getTime());
    const valid = row.state === 'PENDING' && Boolean(row.createdAt && row.expiresAt && !expired && !row.mission.closedAt &&
      row.mission.space.visibility === 'PRIVATE' && row.sender && row.senderId && row.sender.role === 'USER' && row.recipient.role === 'USER' &&
      memberSet.has(key(row.mission.spaceId, row.senderId)) && memberSet.has(key(row.mission.spaceId, row.recipientId)) &&
      recipient?.enabled && recipient.revision === row.recipientSettingRevision && recipient.accountEpoch === row.recipientAccountEpoch &&
      (sender?.accountEpoch ?? 0) === row.senderAccountEpoch &&
      (accessMap.get(key(row.missionId, row.senderId)) ?? 0) === row.senderAccessEpoch &&
      (accessMap.get(key(row.missionId, row.recipientId)) ?? 0) === row.recipientAccessEpoch &&
      senderConsent && !senderConsent.optedOutAt && senderConsent.epoch === row.senderEpoch &&
      (!recipientConsent || Boolean(recipientConsent.optedOutAt)) && (recipientConsent?.epoch ?? 0) === row.recipientEpoch);
    const full = (countMap.get(row.missionId) ?? 0) >= MISSION_PARTICIPANT_LIMIT;
    return { row, valid, expired, full };
  });
}
function projectPending(entry: Awaited<ReturnType<typeof pendingSnapshot>>[number]): PendingMissionInvitation {
  const { row, full } = entry;
  if (!entry.valid || !row.sender || !row.createdAt || !row.expiresAt) throw invitationUnavailable();
  return { id: row.id, revision: row.revision, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
    mission: { id: row.missionId, title: row.mission.title, space: { id: row.mission.space.id, name: row.mission.space.name } },
    sender: { id: row.sender.id, name: row.sender.name, image: row.sender.image }, canAccept: !full, unavailableReason: full ? 'FULL' : null };
}
async function latchInvalidIncoming(recipientId: string, tx: Prisma.TransactionClient) {
  // Expired rows can accumulate across open missions without a scheduler.
  // Scrub them in bounded batches before constructing any actor/fence IN lists.
  await settleMissionInvitations({ recipientId, expiresAt: { lte: new Date() } }, 'EXPIRED', tx);
  const rows = await tx.spaceMissionInvitation.findMany({ where: { recipientId, state: 'PENDING' }, include: pendingInclude });
  const snapshot = await pendingSnapshot(rows, new Date(), tx);
  for (const entry of snapshot) if (!entry.valid) await settleMissionInvitations({ id: entry.row.id }, entry.expired ? 'EXPIRED' : 'REVOKED', tx);
  return snapshot.filter(entry => entry.valid).length;
}

export async function sendMissionInvitation(spaceId: string, missionId: string, userId: string,
  input: ReturnType<typeof parseInvitationSend>): Promise<MissionInvitationAcknowledgment> {
  const acknowledgment = { requestId: input.requestId, processed: true } as const;
  return invitationTransaction(async tx => {
    const sender = await senderAuthority(spaceId, missionId, userId, tx);
    if (sender.consent.epoch !== input.senderEpoch || sender.accessEpoch !== input.senderAccessEpoch) throw invitationConflict();
    const previous = await tx.spaceMissionInvitationRequest.findUnique({ where: { missionId_senderId_requestId: { missionId, senderId: userId, requestId: input.requestId } } });
    if (previous) {
      if (previous.payloadDigest !== input.payloadDigest) throw new SpaceApiError('Anfrage-ID wurde bereits verwendet', 409);
      return acknowledgment;
    }
    const requestCount = await tx.spaceMissionInvitationRequest.count({ where: { missionId, senderId: userId } });
    if (requestCount >= SENDER_LIMIT || sender.mission.invitationAttemptCount >= MISSION_LIMIT) return acknowledgment;
    const reserved = await tx.spaceMission.updateMany({ where: { id: missionId, closedAt: null,
      invitationAttemptCount: sender.mission.invitationAttemptCount }, data: { invitationAttemptCount: { increment: 1 } } });
    if (reserved.count !== 1) throw invitationConflict();
    await tx.spaceMissionInvitationRequest.create({ data: { missionId, senderId: userId, requestId: input.requestId, payloadDigest: input.payloadDigest } });
    // Fail closed uniformly before any target-dependent path if signing is unavailable.
    const signingSecret = secret();
    // Resolve live same-Space target BEFORE any FK-backed target fence writes.
    const target = input.recipientId !== userId ? await tx.user.findFirst({ where: { id: input.recipientId, role: 'USER',
      spaceMemberships: { some: { spaceId } } }, select: { id: true } }) : null;
    if (!target) return acknowledgment;
    const [setting, accessEpoch, consent] = await Promise.all([invitationSetting(target.id, tx), invitationAccess(missionId, target.id, tx),
      tx.spaceMissionParticipation.findUnique({ where: { missionId_userId: { missionId, userId: target.id } } })]);
    await fenceInvitationSetting(sender.setting, tx);
    await fenceInvitationAccess(missionId, userId, sender.accessEpoch, tx);
    await fenceInvitationSetting(setting, tx);
    await fenceInvitationAccess(missionId, target.id, accessEpoch, tx);
    const now = new Date();
    const valid = tokenMatches({ missionId, senderId: userId, recipientId: target.id, senderEpoch: sender.consent.epoch,
      senderAccessEpoch: sender.accessEpoch, senderAccountEpoch: sender.setting.accountEpoch, recipientAccessEpoch: accessEpoch,
      recipientAccountEpoch: setting.accountEpoch, recipientSettingRevision: setting.revision, recipientEpoch: consent?.epoch ?? 0,
      validUntil: input.selection.validUntil, nonce: input.selection.nonce }, input.selection.token, now, signingSecret);
    if (!valid || !setting.enabled || consent && !consent.optedOutAt) return acknowledgment;
    if (await tx.spaceMissionInvitation.findUnique({ where: { missionId_recipientId: { missionId, recipientId: target.id } }, select: { id: true } })) return acknowledgment;
    const pendingCount = await latchInvalidIncoming(target.id, tx);
    const count = await tx.spaceMissionParticipation.count({ where: { missionId, optedOutAt: null } });
    if (pendingCount >= PENDING_LIMIT || count >= MISSION_PARTICIPANT_LIMIT) return acknowledgment;
    const invitation = await tx.spaceMissionInvitation.create({ data: { missionId, recipientId: target.id, senderId: userId,
      state: 'PENDING', revision: 1, createdAt: now, expiresAt: new Date(now.getTime() + INVITATION_LIFETIME),
      senderEpoch: sender.consent.epoch, senderAccessEpoch: sender.accessEpoch, senderAccountEpoch: sender.setting.accountEpoch,
      recipientAccessEpoch: accessEpoch, recipientAccountEpoch: setting.accountEpoch, recipientSettingRevision: setting.revision,
      recipientEpoch: consent?.epoch ?? 0 }, select: { id: true } });
    await tx.notification.create({ data: { userId: target.id, type: 'SYSTEM', targetType: INVITATION_NOTICE_TYPE,
      targetId: invitation.id, content: 'Du hast eine Einladung zu einer Space-Mission.' } });
    return acknowledgment;
  });
}

function ownPendingWhere(userId: string): Prisma.SpaceMissionInvitationWhereInput {
  return { recipientId: userId, state: 'PENDING', recipient: { role: 'USER' },
    mission: { closedAt: null, space: { visibility: 'PRIVATE', members: { some: { userId } } } } };
}
export async function listMissionInvitations(userId: string, request: Request): Promise<MissionInvitationList> {
  return listD1MissionInvitations(userId, request);
}
export async function readMissionInvitation(spaceId: string, missionId: string, invitationId: string, userId: string): Promise<MissionInvitationDetail> {
  return spaceTransaction(async tx => {
    const mission = await scopedMission(spaceId, missionId, userId, tx);
    if (mission.closedAt) return { state: 'UNAVAILABLE', invitation: null };
    const row = await tx.spaceMissionInvitation.findFirst({ where: { id: invitationId, missionId, recipientId: userId }, include: pendingInclude });
    if (!row) throw invitationUnavailable();
    if (row.state === 'ACCEPTED' || row.state === 'DECLINED') return { state: row.state,
      invitation: { id: row.id, state: row.state, revision: row.revision } };
    const entry = (await pendingSnapshot([row], new Date(), tx))[0];
    return entry.valid ? { state: 'PENDING', invitation: projectPending(entry) } : { state: 'UNAVAILABLE', invitation: null };
  });
}
export async function decideMissionInvitation(spaceId: string, missionId: string, invitationId: string, userId: string,
  input: DecideMissionInvitation) {
  const result = await invitationTransaction(async tx => {
    const mission = await scopedMission(spaceId, missionId, userId, tx);
    if (mission.closedAt) throw closed();
    const row = await tx.spaceMissionInvitation.findFirst({ where: { id: invitationId, missionId, recipientId: userId }, include: pendingInclude });
    if (!row) throw invitationUnavailable();
    const targetState = input.decision === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED';
    if (row.state === targetState && row.revision === input.expectedRevision + 1) {
      return { data: { invitation: { id: row.id, state: targetState, revision: row.revision },
        mission: await readMissionInTransaction(spaceId, missionId, userId, tx) } };
    }
    if (row.state !== 'PENDING' || row.revision !== input.expectedRevision) throw invitationConflict();
    const entry = (await pendingSnapshot([row], new Date(), tx))[0];
    if (!entry.valid) {
      await settleMissionInvitations({ id: row.id, revision: input.expectedRevision }, entry.expired ? 'EXPIRED' : 'REVOKED', tx);
      return { unavailable: true } as const;
    }
    const [senderSetting, recipientSetting, senderAccess, recipientAccess] = await Promise.all([
      invitationSetting(row.senderId!, tx), invitationSetting(userId, tx),
      invitationAccess(missionId, row.senderId!, tx), invitationAccess(missionId, userId, tx),
    ]);
    await fenceInvitationSetting(senderSetting, tx);
    await fenceInvitationSetting(recipientSetting, tx);
    await fenceInvitationAccess(missionId, row.senderId!, senderAccess, tx);
    await fenceInvitationAccess(missionId, userId, recipientAccess, tx);
    // A new clock read just before transition prevents a boundary-expired accept.
    if (new Date().getTime() >= row.expiresAt!.getTime()) {
      await settleMissionInvitations({ id: row.id, revision: input.expectedRevision }, 'EXPIRED', tx);
      return { unavailable: true } as const;
    }
    if (input.decision === 'ACCEPT') await joinMissionInTransaction(spaceId, missionId, userId, row.recipientEpoch!, tx, false);
    await settleMissionInvitations({ id: row.id, revision: input.expectedRevision }, targetState, tx);
    return { data: { invitation: { id: row.id, state: targetState, revision: row.revision + 1 },
      mission: await readMissionInTransaction(spaceId, missionId, userId, tx) } };
  });
  // A terminal expiry/revocation latch must commit before HTTP mapping.
  if ('unavailable' in result) throw invitationUnavailable();
  return result.data;
}

/** Inbox page is bounded at 50. SQLite real-adapter evidence measures ten
 * SELECTs (plus COMMIT) for 1/10/50 invitation targets, independent of count.
 * PostgreSQL query-count verification remains a provider acceptance gate. */
export async function resolveMissionInvitationTargets(ids: string[], userId: string) {
  if (ids.length > 50) throw new SpaceApiError('Zu viele Benachrichtigungen', 400);
  return spaceTransaction(async tx => {
    const rows = await tx.spaceMissionInvitation.findMany({ where: { ...ownPendingWhere(userId), id: { in: ids } }, include: pendingInclude });
    const snapshot = await pendingSnapshot(rows, new Date(), tx);
    return new Map(snapshot.filter(entry => entry.valid).map(({ row }) => [row.id, {
      href: `/community/spaces/${encodeURIComponent(row.mission.spaceId)}/missions/${encodeURIComponent(row.missionId)}?invitation=${encodeURIComponent(row.id)}#mission-invitation`,
      label: 'Einladung ansehen',
    }]));
  }).catch(error => {
    reportInvitationFailure('invitation-targets.resolve', error);
    // Existing inbox handlers may log failures. Strip all original private
    // diagnostics before crossing that unchanged global error boundary.
    throw new Error('MISSION_INVITATION_RESOLUTION_FAILED');
  });
}
