import 'server-only';

import { Prisma } from '@prisma/client';
import { DriverAdapterError } from '@prisma/driver-adapter-utils';
import { SPACE_ID_RE, SpaceApiError, spaceTransaction } from '@/lib/server/space-api';

export type OwnBookmark = { saved: boolean; revision: number; accessEpoch: number };
export const BOOKMARK_MAX_VERSION = 2147483647;
const notFound = () => new SpaceApiError('Mission nicht gefunden', 404);
const conflict = () => new SpaceApiError('Merker wurde geändert. Bitte neu laden.', 409);

export function parseMissionBookmark(body: Record<string, unknown>) {
  const keys = ['saved', 'expectedRevision', 'accessEpoch'];
  if (Object.keys(body).length !== keys.length || keys.some(key => !Object.hasOwn(body, key)) ||
      typeof body.saved !== 'boolean' ||
      ![body.expectedRevision, body.accessEpoch].every(value => typeof value === 'number' &&
        Number.isInteger(value) && value >= 0 && value <= BOOKMARK_MAX_VERSION)) {
    throw new SpaceApiError('Ungültige Merkerdaten', 400);
  }
  return { saved: body.saved, expectedRevision: body.expectedRevision as number, accessEpoch: body.accessEpoch as number };
}

/** Access-row and setting first-creation races must retry the entire live
 * authorization snapshot. Serializable conflicts are handled by spaceTransaction. */
export async function bookmarkTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try { return await spaceTransaction(work); }
    catch (error) {
      // The installed SQLite adapter exposes genuine BUSY locks as either
      // its class directly (COMMIT) or a P1008 carrying that same class. Do
      // not turn unrelated timeouts or merely similar objects into retries.
      const adapter = error instanceof DriverAdapterError ? error :
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P1008'
          ? error.meta?.driverAdapterError : null;
      const sqliteBusy = adapter instanceof DriverAdapterError && adapter.cause.kind === 'SocketTimeout' &&
        /^SQLITE_BUSY(?:_SNAPSHOT|_RECOVERY|_TIMEOUT)?$/.test(adapter.cause.originalCode ?? '');
      const unique = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (!unique && !sqliteBusy) throw error;
      if (attempt === 3) throw conflict();
      await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 10));
    }
  }
  throw conflict();
}

export async function bookmarkAccessEpoch(userId: string, tx: Prisma.TransactionClient): Promise<number> {
  return (await tx.spaceMissionBookmarkAccess.findUnique({ where: { userId }, select: { epoch: true } }))?.epoch ?? 0;
}

/** Call only after actual PRIVATE membership and open-mission authorization in
 * the same transaction. GET is write-free, including absent access/settings. */
export async function readOwnMissionBookmark(missionId: string, userId: string, tx: Prisma.TransactionClient): Promise<OwnBookmark> {
  const [setting, accessEpoch] = await Promise.all([
    tx.spaceMissionBookmarkSetting.findUnique({ where: { missionId_userId: { missionId, userId } }, select: { savedAt: true, revision: true } }),
    bookmarkAccessEpoch(userId, tx),
  ]);
  return { saved: Boolean(setting?.savedAt), revision: setting?.revision ?? 0, accessEpoch };
}

export async function setMissionBookmark(spaceId: string, missionId: string, userId: string,
  input: ReturnType<typeof parseMissionBookmark>): Promise<OwnBookmark> {
  return bookmarkTransaction(async tx => {
    const account = SPACE_ID_RE.test(userId) ? await tx.user.findUnique({ where: { id: userId }, select: { id: true } }) : null;
    if (!account) throw new SpaceApiError('Nicht authentifiziert', 401);
    const mission = await tx.spaceMission.findFirst({ where: { id: missionId, spaceId, closedAt: null,
      space: { visibility: 'PRIVATE', members: { some: { userId } } } }, select: { id: true } });
    if (!mission) throw notFound();
    const access = await tx.spaceMissionBookmarkAccess.findUnique({ where: { userId }, select: { epoch: true } });
    if ((access?.epoch ?? 0) !== input.accessEpoch) throw conflict();
    // Materialize and write the per-user fence even at epoch zero. Competing
    // first-save/revoke transactions therefore cannot evade the same lock/CAS.
    if (!access) await tx.spaceMissionBookmarkAccess.create({ data: { userId, epoch: 0 } });
    else {
      const fence = await tx.spaceMissionBookmarkAccess.updateMany({ where: { userId, epoch: input.accessEpoch },
        data: { epoch: input.accessEpoch } });
      if (fence.count !== 1) throw conflict();
    }
    if (input.expectedRevision >= BOOKMARK_MAX_VERSION) throw conflict();
    const data = { savedAt: input.saved ? new Date() : null, revision: input.expectedRevision + 1 };
    if (input.expectedRevision === 0) {
      const previous = await tx.spaceMissionBookmarkSetting.findUnique({ where: { missionId_userId: { missionId, userId } }, select: { revision: true } });
      if (previous) throw conflict();
      await tx.spaceMissionBookmarkSetting.create({ data: { missionId, userId, ...data } });
    } else {
      const result = await tx.spaceMissionBookmarkSetting.updateMany({ where: { missionId, userId, revision: input.expectedRevision }, data });
      if (result.count !== 1) throw conflict();
    }
    return { saved: input.saved, revision: data.revision, accessEpoch: input.accessEpoch };
  });
}

/** Run inside the official private-member-removal transaction, which itself
 * must use bookmarkTransaction to retry concurrent first fence creation. */
export async function revokeSpaceMissionBookmarks(spaceId: string, userId: string, tx: Prisma.TransactionClient) {
  if (!await tx.user.findUnique({ where: { id: userId }, select: { id: true } })) return;
  const access = await tx.spaceMissionBookmarkAccess.findUnique({ where: { userId }, select: { epoch: true } });
  if ((access?.epoch ?? 0) >= BOOKMARK_MAX_VERSION) throw conflict();
  if (!access) await tx.spaceMissionBookmarkAccess.create({ data: { userId, epoch: 1 } });
  else {
    const result = await tx.spaceMissionBookmarkAccess.updateMany({ where: { userId, epoch: access.epoch },
      data: { epoch: access.epoch + 1 } });
    if (result.count !== 1) throw conflict();
  }
  await tx.spaceMissionBookmarkSetting.deleteMany({ where: { userId, mission: { spaceId } } });
}
