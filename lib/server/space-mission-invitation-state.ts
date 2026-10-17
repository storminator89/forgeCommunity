import 'server-only';

import { Prisma } from '@prisma/client';
import { DriverAdapterError } from '@prisma/driver-adapter-utils';
import { isUserEmailConflict } from '@/lib/server/database-conflicts';
import { SpaceApiError, spaceTransaction } from '@/lib/server/space-api';

export const INVITATION_MAX_VERSION = 2147483647;
export const INVITATION_NOTICE_TYPE = 'SPACE_MISSION_INVITATION';
export const invitationConflict = () => new SpaceApiError('Einladung wurde geändert. Bitte neu laden.', 409);
export const invitationUnavailable = () => new SpaceApiError('Einladung nicht verfügbar', 404);

/** Retry the whole snapshot, including real provider COMMIT failures and first
 * zero-fence races. Lookalike objects and unrelated adapter errors fail closed. */
export async function invitationTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try { return await spaceTransaction(work); }
    catch (error) {
      const adapter = error instanceof DriverAdapterError ? error :
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P1008'
          ? error.meta?.driverAdapterError : null;
      const busy = adapter instanceof DriverAdapterError && adapter.cause.kind === 'SocketTimeout' &&
        /^SQLITE_BUSY(?:_SNAPSHOT|_RECOVERY|_TIMEOUT)?$/.test(adapter.cause.originalCode ?? '');
      const unique = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (!unique && !busy) throw error;
      // A real account email conflict is unrelated to first invitation/bookmark
      // fence creation. Preserve it for the admin route's accurate mapping.
      if (unique && (error.meta?.modelName === 'User' || isUserEmailConflict(error))) throw error;
      if (attempt === 3) throw invitationConflict();
      await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 10));
    }
  }
  throw invitationConflict();
}

export async function invitationSetting(userId: string, tx: Prisma.TransactionClient) {
  return await tx.spaceMissionInvitationSetting.findUnique({ where: { userId } }) ??
    { userId, enabled: false, revision: 0, accountEpoch: 0 };
}

export async function invitationAccess(missionId: string, userId: string, tx: Prisma.TransactionClient) {
  return (await tx.spaceMissionInvitationAccess.findUnique({ where: { missionId_userId: { missionId, userId } } }))?.epoch ?? 0;
}

/** Explicit no-op writes prevent absent-zero ABA and serialize recipient-wide
 * delivery/disable, even on providers with first-row unique races. */
export async function fenceInvitationSetting(setting: Awaited<ReturnType<typeof invitationSetting>>, tx: Prisma.TransactionClient) {
  const existing = await tx.spaceMissionInvitationSetting.findUnique({ where: { userId: setting.userId }, select: { userId: true } });
  if (!existing) {
    if (setting.revision !== 0 || setting.accountEpoch !== 0 || setting.enabled) throw invitationConflict();
    await tx.spaceMissionInvitationSetting.create({ data: setting });
  } else {
    const fence = await tx.spaceMissionInvitationSetting.updateMany({ where: setting, data: { revision: setting.revision } });
    if (fence.count !== 1) throw invitationConflict();
  }
}

export async function fenceInvitationAccess(missionId: string, userId: string, epoch: number, tx: Prisma.TransactionClient) {
  const where = { missionId_userId: { missionId, userId } };
  const existing = await tx.spaceMissionInvitationAccess.findUnique({ where, select: { epoch: true } });
  if (!existing) {
    if (epoch !== 0) throw invitationConflict();
    await tx.spaceMissionInvitationAccess.create({ data: { missionId, userId, epoch: 0 } });
  } else {
    const fence = await tx.spaceMissionInvitationAccess.updateMany({ where: { missionId, userId, epoch }, data: { epoch } });
    if (fence.count !== 1) throw invitationConflict();
  }
}

const scrubPending = {
  senderId: null, createdAt: null, expiresAt: null, senderEpoch: null, senderAccessEpoch: null,
  senderAccountEpoch: null, recipientAccessEpoch: null, recipientAccountEpoch: null,
  recipientSettingRevision: null, recipientEpoch: null,
} as const;

/** Notices are actually deleted before source identity is scrubbed. The caller
 * owns this transaction; never throw a mapped HTTP error after a terminal latch. */
export async function settleMissionInvitations(where: Prisma.SpaceMissionInvitationWhereInput,
  state: 'ACCEPTED' | 'DECLINED' | 'REVOKED' | 'EXPIRED', tx: Prisma.TransactionClient) {
  let settled = 0;
  for (;;) {
    const rows = await tx.spaceMissionInvitation.findMany({ where: { AND: [where, { state: 'PENDING' }] },
      select: { id: true, revision: true }, orderBy: { id: 'asc' }, take: 200 });
    if (!rows.length) return settled;
    if (rows.some(row => row.revision >= INVITATION_MAX_VERSION)) throw invitationConflict();
    const ids = rows.map(row => row.id);
    await tx.notification.deleteMany({ where: { type: 'SYSTEM', targetType: INVITATION_NOTICE_TYPE, targetId: { in: ids } } });
    const result = await tx.spaceMissionInvitation.updateMany({ where: { AND: [where, { id: { in: ids }, state: 'PENDING' }] },
      data: { ...scrubPending, state, revision: { increment: 1 } } });
    if (result.count !== rows.length) throw invitationConflict();
    settled += result.count;
  }
}

/** Both normal self-join and sender leave invalidate pending invitations. The
 * acceptance join core deliberately bypasses this wrapper and settles its row. */
export async function revokeMissionParticipationInvitations(missionId: string, userId: string,
  direction: 'incoming' | 'outgoing', tx: Prisma.TransactionClient) {
  await settleMissionInvitations({ missionId, ...(direction === 'incoming' ? { recipientId: userId } : { senderId: userId }) }, 'REVOKED', tx);
}

/** Materialize even a missing zero fence before removing membership. Re-add
 * has no reset path. Only the current open mission needs an access receipt. */
export async function revokeSpaceMissionInvitations(spaceId: string, userId: string, tx: Prisma.TransactionClient) {
  if (!await tx.user.findUnique({ where: { id: userId }, select: { id: true } })) return;
  const mission = await tx.spaceMission.findFirst({ where: { spaceId, closedAt: null }, select: { id: true } });
  if (!mission) return;
  const epoch = await invitationAccess(mission.id, userId, tx);
  if (epoch >= INVITATION_MAX_VERSION) throw invitationConflict();
  await fenceInvitationAccess(mission.id, userId, epoch, tx);
  const result = await tx.spaceMissionInvitationAccess.updateMany({ where: { missionId: mission.id, userId, epoch }, data: { epoch: epoch + 1 } });
  if (result.count !== 1) throw invitationConflict();
  await settleMissionInvitations({ missionId: mission.id, OR: [{ senderId: userId }, { recipientId: userId }] }, 'REVOKED', tx);
}

/** Official USER-role loss retains only the living account's monotone fence. */
export async function revokeAccountMissionInvitations(userId: string, tx: Prisma.TransactionClient) {
  const setting = await invitationSetting(userId, tx);
  if (setting.revision >= INVITATION_MAX_VERSION || setting.accountEpoch >= INVITATION_MAX_VERSION) throw invitationConflict();
  await fenceInvitationSetting(setting, tx);
  const result = await tx.spaceMissionInvitationSetting.updateMany({ where: setting,
    data: { enabled: false, revision: setting.revision + 1, accountEpoch: setting.accountEpoch + 1 } });
  if (result.count !== 1) throw invitationConflict();
  await settleMissionInvitations({ OR: [{ senderId: userId }, { recipientId: userId }] }, 'REVOKED', tx);
}

/** Irreversible close deletes every mission-scoped private row and notice. */
export async function purgeMissionInvitations(missionId: string, tx: Prisma.TransactionClient) {
  for (;;) {
    const rows = await tx.spaceMissionInvitation.findMany({ where: { missionId }, select: { id: true }, take: 200 });
    if (!rows.length) break;
    const ids = rows.map(row => row.id);
    await tx.notification.deleteMany({ where: { type: 'SYSTEM', targetType: INVITATION_NOTICE_TYPE, targetId: { in: ids } } });
    await tx.spaceMissionInvitation.deleteMany({ where: { missionId, id: { in: ids } } });
  }
  await tx.spaceMissionInvitationRequest.deleteMany({ where: { missionId } });
  await tx.spaceMissionInvitationAccess.deleteMany({ where: { missionId } });
}

/** Call before account deletion, while sender links still identify all exact
 * surviving-recipient notices. No deleted-account hashes or archive survive. */
export async function eraseAccountMissionInvitations(userId: string, tx: Prisma.TransactionClient) {
  await settleMissionInvitations({ senderId: userId }, 'REVOKED', tx);
  for (;;) {
    const own = await tx.spaceMissionInvitation.findMany({ where: { recipientId: userId }, select: { id: true }, take: 200 });
    if (!own.length) break;
    const ids = own.map(row => row.id);
    await tx.notification.deleteMany({ where: { type: 'SYSTEM', targetType: INVITATION_NOTICE_TYPE, targetId: { in: ids } } });
    await tx.spaceMissionInvitation.deleteMany({ where: { recipientId: userId, id: { in: ids } } });
  }
  await tx.spaceMissionInvitationRequest.deleteMany({ where: { senderId: userId } });
  await tx.spaceMissionInvitationAccess.deleteMany({ where: { userId } });
  await tx.spaceMissionInvitationSetting.deleteMany({ where: { userId } });
}
