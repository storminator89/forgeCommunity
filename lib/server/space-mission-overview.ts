import 'server-only';

import type { Prisma, Role } from '@prisma/client';
import { missionWindowState } from '@/lib/mission-week-clock';
import { SPACE_ID_RE, SpaceApiError, spaceTransaction } from '@/lib/server/space-api';

export const MISSION_OVERVIEW_PAGE_SIZE = 20;

type OverviewCursor = { createdAt: Date; id: string };
type OverviewViewer = { id: string; role: Role };

export type SpaceMissionOverviewItem = {
  id: string;
  title: string;
  space: { id: string; name: string };
  week: null | { startDate: string; timezone: string; startsAt: string; endsAt: string };
  windowState: 'self-paced' | 'current' | 'past';
  participationActive: boolean;
};

function readCursor(request: Request, viewer: OverviewViewer): OverviewCursor | null {
  const cursors = new URL(request.url).searchParams.getAll('cursor');
  if (cursors.length === 0) return null;
  try {
    const raw = cursors[0];
    if (cursors.length !== 1 || !raw || raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const bytes = Buffer.from(raw, 'base64url');
    if (bytes.toString('base64url') !== raw) throw new Error();
    const value = JSON.parse(bytes.toString('utf8'));
    const keys = ['v', 'kind', 'viewerId', 'role', 'createdAt', 'id'];
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) ||
        value.v !== 1 || value.kind !== 'space-mission-overview' ||
        value.viewerId !== viewer.id || value.role !== viewer.role ||
        typeof value.id !== 'string' || !SPACE_ID_RE.test(value.id) || typeof value.createdAt !== 'string') throw new Error();
    const createdAt = new Date(value.createdAt);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== value.createdAt) throw new Error();
    return { createdAt, id: value.id };
  } catch { throw new SpaceApiError('Ungültiger Cursor', 400); }
}

function encodeCursor(row: OverviewCursor, viewer: OverviewViewer): string {
  return Buffer.from(JSON.stringify({ v: 1, kind: 'space-mission-overview', viewerId: viewer.id, role: viewer.role,
    createdAt: row.createdAt.toISOString(), id: row.id })).toString('base64url');
}

function overviewSelect(viewer: OverviewViewer) {
  return {
    id: true, title: true, createdAt: true,
    weekStartsOn: true, weekTimezone: true, weekStartsAt: true, weekEndsAt: true,
    space: { select: { id: true, name: true } },
    // Read only the caller's current consent, never the roster or its history.
    participations: { where: { userId: viewer.id, optedOutAt: null },
      take: viewer.role === 'USER' ? 1 : 0, select: { missionId: true } },
  } satisfies Prisma.SpaceMissionSelect;
}

/** Reauthorize every page in one live serializable snapshot. Admins also need
 * an actual membership; the general Space directory's admin override is not
 * appropriate for this personal overview. Soft-week expiry is descriptive. */
export async function listSpaceMissionOverview(userId: string, request: Request): Promise<{
  items: SpaceMissionOverviewItem[]; nextCursor: string | null;
}> {
  return spaceTransaction(async tx => {
    const live = SPACE_ID_RE.test(userId)
      ? await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true } }) : null;
    if (!live) throw new SpaceApiError('Nicht authentifiziert', 401);
    const cursor = readCursor(request, live);
    const rows = await tx.spaceMission.findMany({
      where: {
        closedAt: null,
        space: { visibility: 'PRIVATE', members: { some: { userId: live.id } } },
        ...(cursor ? { OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ] } : {}),
      },
      select: overviewSelect(live),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MISSION_OVERVIEW_PAGE_SIZE + 1,
    });
    const page = rows.slice(0, MISSION_OVERVIEW_PAGE_SIZE);
    const now = new Date();
    const items = page.map((row): SpaceMissionOverviewItem => ({
      id: row.id, title: row.title, space: row.space,
      week: row.weekStartsOn !== null && row.weekTimezone !== null && row.weekStartsAt !== null && row.weekEndsAt !== null
        ? { startDate: row.weekStartsOn, timezone: row.weekTimezone,
          startsAt: row.weekStartsAt.toISOString(), endsAt: row.weekEndsAt.toISOString() } : null,
      windowState: missionWindowState(row.weekEndsAt, now),
      participationActive: live.role === 'USER' && row.participations.length > 0,
    }));
    return { items, nextCursor: rows.length > MISSION_OVERVIEW_PAGE_SIZE
      ? encodeCursor(page[page.length - 1], live) : null };
  });
}
