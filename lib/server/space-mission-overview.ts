import 'server-only';

import type { Role } from '@/generated/prisma/client';
import { missionWindowState } from '@/lib/mission-week-clock';
import type { OwnBookmark } from '@/lib/server/space-mission-bookmarks';
import { SPACE_ID_RE, SpaceApiError } from '@/lib/server/space-api';
import { d1MissionOverview, type D1OverviewCursor } from '@/lib/server/d1-private-overviews';

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

function readCursor(request: Request, viewer: { id: string; role?: Role; accessEpoch?: number }, view: OverviewView): D1OverviewCursor | null {
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
        value.viewerId !== viewer.id || value.view !== view || typeof value.role !== 'string' ||
        !Number.isInteger(value.accessEpoch) || value.accessEpoch < 0 || value.accessEpoch > 2147483647 ||
        (viewer.role !== undefined && value.role !== viewer.role) ||
        (viewer.accessEpoch !== undefined && value.accessEpoch !== viewer.accessEpoch) ||
        typeof value.id !== 'string' || !SPACE_ID_RE.test(value.id) || typeof value.createdAt !== 'string') throw new Error();
    const createdAt = new Date(value.createdAt);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== value.createdAt) throw new Error();
    return { createdAt, id: value.id, role: value.role, accessEpoch: value.accessEpoch };
  } catch { throw new SpaceApiError('Ungültiger Cursor', 400); }
}

function encodeCursor(row: OverviewCursor, viewer: OverviewViewer, view: OverviewView): string {
  return Buffer.from(JSON.stringify({ v: 2, kind: 'space-mission-overview', viewerId: viewer.id, role: viewer.role, view, accessEpoch: viewer.accessEpoch,
    createdAt: row.createdAt.toISOString(), id: row.id })).toString('base64url');
}

/** Reauthorize every page in one live D1 statement snapshot. Admins also need
 * an actual membership; the general Space directory's admin override is not
 * appropriate for this personal overview. Soft-week expiry is descriptive. */
export async function listSpaceMissionOverview(userId: string, request: Request): Promise<{
  items: SpaceMissionOverviewItem[]; nextCursor: string | null;
}> {
  if (!SPACE_ID_RE.test(userId)) throw new SpaceApiError('Nicht authentifiziert', 401);
  let view: OverviewView = 'all';
  let cursor: D1OverviewCursor | null = null;
  let inputError: unknown;
  try {
    view = readView(request);
    cursor = readCursor(request, { id: userId }, view);
  } catch (error) { inputError = error; }
  // A malformed request still checks live identity first, but reads no page.
  const snapshot = await d1MissionOverview(userId, view, cursor, inputError ? 0 : MISSION_OVERVIEW_PAGE_SIZE + 1);
  if (!snapshot) throw new SpaceApiError('Nicht authentifiziert', 401);
  if (inputError) throw inputError;
  const { viewer, rows } = snapshot;
  // SQL suppresses the page on a changed role/access fence; retain the
  // existing invalid-cursor response after checking that same snapshot.
  readCursor(request, viewer, view);
  const page = rows.slice(0, MISSION_OVERVIEW_PAGE_SIZE);
  const now = new Date();
  const items = page.map((row): SpaceMissionOverviewItem => ({
    id: row.id, title: row.title, space: row.space,
    week: row.weekStartsOn !== null && row.weekTimezone !== null && row.weekStartsAt !== null && row.weekEndsAt !== null
      ? { startDate: row.weekStartsOn, timezone: row.weekTimezone,
        startsAt: row.weekStartsAt.toISOString(), endsAt: row.weekEndsAt.toISOString() } : null,
    windowState: missionWindowState(row.weekEndsAt, now),
    participationActive: row.participationActive,
    ownBookmark: { saved: row.saved, revision: row.revision, accessEpoch: viewer.accessEpoch },
  }));
  return { items, nextCursor: rows.length > MISSION_OVERVIEW_PAGE_SIZE
    ? encodeCursor(page[page.length - 1], viewer, view) : null };
}
