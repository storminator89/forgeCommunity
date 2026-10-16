import 'server-only';

import type { Prisma, Role } from '@prisma/client';
import { missionWindowState } from '@/lib/mission-week-clock';
import { bookmarkAccessEpoch, type OwnBookmark } from '@/lib/server/space-mission-bookmarks';
import { SPACE_ID_RE, SpaceApiError, spaceTransaction } from '@/lib/server/space-api';

export const MISSION_OVERVIEW_PAGE_SIZE = 20;

type OverviewCursor = { createdAt: Date; id: string };
type OverviewView = 'all' | 'saved';
type OverviewViewer = { id: string; role: Role; accessEpoch: number };

function readView(request: Request): OverviewView {
  const views = new URL(request.url).searchParams.getAll('view');
  if (views.length > 1 || views.length === 1 && views[0] !== 'all' && views[0] !== 'saved') {
    throw new SpaceApiError('Ungültige Missionsansicht', 400);
  }
  return views[0] === 'saved' ? 'saved' : 'all';
}

export type SpaceMissionOverviewItem = {
  id: string;
  title: string;
  space: { id: string; name: string };
  week: null | { startDate: string; timezone: string; startsAt: string; endsAt: string };
  windowState: 'self-paced' | 'current' | 'past';
  participationActive: boolean;
  ownBookmark: OwnBookmark;
};

function readCursor(request: Request, viewer: OverviewViewer, view: OverviewView): OverviewCursor | null {
  const cursors = new URL(request.url).searchParams.getAll('cursor');
  if (cursors.length === 0) return null;
  try {
    const raw = cursors[0];
    if (cursors.length !== 1 || !raw || raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const bytes = Buffer.from(raw, 'base64url');
    if (bytes.toString('base64url') !== raw) throw new Error();
    const value = JSON.parse(bytes.toString('utf8'));
    const keys = ['v', 'kind', 'viewerId', 'role', 'view', 'accessEpoch', 'createdAt', 'id'];
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) ||
        value.v !== 2 || value.kind !== 'space-mission-overview' ||
        value.viewerId !== viewer.id || value.role !== viewer.role || value.view !== view || value.accessEpoch !== viewer.accessEpoch ||
        typeof value.id !== 'string' || !SPACE_ID_RE.test(value.id) || typeof value.createdAt !== 'string') throw new Error();
    const createdAt = new Date(value.createdAt);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== value.createdAt) throw new Error();
    return { createdAt, id: value.id };
  } catch { throw new SpaceApiError('Ungültiger Cursor', 400); }
}

function encodeCursor(row: OverviewCursor, viewer: OverviewViewer, view: OverviewView): string {
  return Buffer.from(JSON.stringify({ v: 2, kind: 'space-mission-overview', viewerId: viewer.id, role: viewer.role, view, accessEpoch: viewer.accessEpoch,
    createdAt: row.createdAt.toISOString(), id: row.id })).toString('base64url');
}

function overviewSelect(viewer: OverviewViewer) {
  return {
    id: true, title: true, createdAt: true,
    weekStartsOn: true, weekTimezone: true, weekStartsAt: true, weekEndsAt: true,
    space: { select: { id: true, name: true } },
    bookmarkSettings: { where: { userId: viewer.id }, take: 1, select: { savedAt: true, revision: true } },
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
    const viewer = { ...live, accessEpoch: await bookmarkAccessEpoch(live.id, tx) };
    const view = readView(request);
    const cursor = readCursor(request, viewer, view);
    const rows = await tx.spaceMission.findMany({
      where: {
        closedAt: null,
        space: { visibility: 'PRIVATE', members: { some: { userId: live.id } } },
        ...(view === 'saved' ? { bookmarkSettings: { some: { userId: live.id, savedAt: { not: null } } } } : {}),
        ...(cursor ? { OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ] } : {}),
      },
      select: overviewSelect(viewer),
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
      ownBookmark: { saved: Boolean(row.bookmarkSettings[0]?.savedAt), revision: row.bookmarkSettings[0]?.revision ?? 0, accessEpoch: viewer.accessEpoch },
    }));
    return { items, nextCursor: rows.length > MISSION_OVERVIEW_PAGE_SIZE
      ? encodeCursor(page[page.length - 1], viewer, view) : null };
  });
}
