import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { DriverAdapterError } from '@prisma/driver-adapter-utils';
import { SPACE_ID_RE, SpaceApiError, spaceTransaction } from '@/lib/server/space-api';
import { setD1MissionBookmark } from '@/lib/server/d1-space-mission-bookmarks';

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
  return setD1MissionBookmark(spaceId, missionId, userId, input);
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
