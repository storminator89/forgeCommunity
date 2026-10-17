import 'server-only';

import { validSpaceId } from '@/lib/server/space-access';
import { SpaceApiError } from '@/lib/server/space-api';
import { pageSpaceRows, SPACE_PAGE_SIZE, type SpaceDiscussionDto, type SpaceReplyDto } from '@/lib/server/space-discussions';
import {
  d1BoundedResponse, d1Date, d1DateMs, d1ProjectionBudgetCtes,
  d1SpaceAccessCtes, d1SpaceDatabase, d1TextBytes, type D1StoredDate,
} from '@/lib/server/d1-space-reads';

type Cursor = { createdAt: Date; id: string };
type ReadKind = 'discussion' | 'replies' | 'reply';
type ContextRow = { kind: 'context'; authorized: number; fits: number };
type ContentRow = {
  kind: 'content'; id: string; parentId: string; authorId: string; title: string | null; content: string;
  createdAt: D1StoredDate; updatedAt: D1StoredDate; hiddenAt: D1StoredDate | null;
  createdAtMs: number; replyCount: number | null;
};
type PersonRow = { kind: 'person'; id: string; name: string | null; image: string | null };
type Row = ContextRow | ContentRow | PersonRow;

function text(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid D1 Space text projection');
}

function storedDate(value: unknown): Date {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Invalid D1 Space timestamp projection');
  return d1Date(value);
}

function personMap(rows: Row[]) {
  const people = new Map<string, SpaceReplyDto['author']>();
  for (const row of rows) {
    if (row.kind !== 'person') continue;
    text(row.id);
    if (!row.id || (row.name !== null && typeof row.name !== 'string') ||
        (row.image !== null && typeof row.image !== 'string')) throw new Error('Invalid D1 Space author projection');
    people.set(row.id, { id: row.id, name: row.name, image: row.image });
  }
  return people;
}

function contentProjection(row: ContentRow, people: ReturnType<typeof personMap>) {
  text(row.id); text(row.parentId); text(row.authorId); text(row.content);
  const author = people.get(row.authorId);
  if (!author) throw new Error('Missing D1 Space content author');
  if (typeof row.createdAtMs !== 'number' || !Number.isFinite(row.createdAtMs)) {
    throw new Error('Invalid D1 Space ordering timestamp');
  }
  return { id: row.id, content: row.content, createdAt: storedDate(row.createdAt).toISOString(),
    updatedAt: storedDate(row.updatedAt).toISOString(),
    hiddenAt: row.hiddenAt === null ? null : storedDate(row.hiddenAt).toISOString(), author };
}

/** One protected statement per request. Table/column fragments are selected only
 * from these source-owned modes; every request value is bound. Person rows are
 * distinct and separate so repeated avatars never inflate a D1 result row. */
async function readRows(kind: ReadKind, userId: string, spaceId: string, discussionId: string,
  replyId = '', cursor: Cursor | null = null, cursorValid = true) {
  const missing = kind === 'reply' ? 'Antwort nicht gefunden' : 'Diskussion nicht gefunden';
  // getReadableSpace also rejects a malformed stored-session identity with404.
  if (!validSpaceId(userId)) throw new SpaceApiError(missing, 404);
  const discussion = kind === 'discussion';
  const table = discussion ? 'SpaceDiscussion' : 'SpaceReply';
  const parentColumn = discussion ? 'spaceId' : 'discussionId';
  const textColumns = ['c."id"', `c."${parentColumn}"`, 'c."authorId"', 'c."content"',
    'c."createdAt"', 'c."updatedAt"', 'c."hiddenAt"', ...(discussion ? ['c."title"'] : [])];
  const result = await d1SpaceDatabase().prepare(`
    WITH ${d1SpaceAccessCtes()},
    readable_parent AS (
      SELECT d."id", a."canManage" FROM access a
      JOIN "SpaceDiscussion" d ON d."spaceId" = a."id" AND d."id" = ?3
      WHERE a."canManage" = 1 OR d."hiddenAt" IS NULL
    ), readable AS (
      SELECT c."id", ${d1DateMs('c."createdAt"')} AS "createdAtMs"
      FROM readable_parent parent JOIN "${table}" c ON ${discussion ? 'c."id" = parent."id"' : 'c."discussionId" = parent."id"'}
      WHERE ?8 = 1 ${discussion ? '' : 'AND (parent."canManage" = 1 OR c."hiddenAt" IS NULL)'}
        ${kind === 'reply' ? 'AND c."id" = ?4' : ''}
    ), page AS (
      SELECT * FROM readable WHERE ?5 = 0 OR "createdAtMs" < ?6 OR ("createdAtMs" = ?6 AND "id" < ?7)
      ORDER BY "createdAtMs" DESC, "id" DESC LIMIT ${kind === 'replies' ? SPACE_PAGE_SIZE + 1 : 1}
    ), people AS (
      SELECT DISTINCT u."id" FROM page p JOIN "${table}" c ON c."id" = p."id"
      JOIN "User" u ON u."id" = c."authorId"
    ), ${d1ProjectionBudgetCtes(`
      SELECT ${d1TextBytes(...textColumns)} AS bytes FROM page p JOIN "${table}" c ON c."id" = p."id"
      UNION ALL SELECT ${d1TextBytes('u."id"', 'u."name"', 'u."image"')} AS bytes
        FROM people person JOIN "User" u ON u."id" = person."id"`,
      `SELECT ${d1TextBytes(...textColumns, 'u."id"', 'u."name"', 'u."image"')} AS bytes
        FROM page p JOIN "${table}" c ON c."id" = p."id" JOIN "User" u ON u."id" = c."authorId"`)}
    SELECT 'context' AS kind, EXISTS(SELECT 1 FROM ${kind === 'reply' ? 'readable' : 'readable_parent'}) AS authorized, b.fits,
      NULL AS id, NULL AS parentId, NULL AS authorId, NULL AS title, NULL AS content,
      NULL AS createdAt, NULL AS updatedAt, NULL AS hiddenAt, NULL AS createdAtMs,
      NULL AS replyCount, NULL AS name, NULL AS image
    FROM projection_budget b
    UNION ALL
    SELECT 'content', NULL, NULL, c."id", c."${parentColumn}", c."authorId", ${discussion ? 'c."title"' : 'NULL'},
      c."content", c."createdAt", c."updatedAt", c."hiddenAt", p."createdAtMs",
      ${discussion ? '(SELECT COUNT(*) FROM "SpaceReply" reply WHERE reply."discussionId" = c."id" AND reply."hiddenAt" IS NULL)' : 'NULL'}, NULL, NULL
    FROM projection_budget b JOIN page p ON b.fits = 1 JOIN "${table}" c ON c."id" = p."id"
    UNION ALL
    SELECT 'person', NULL, NULL, u."id", NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, u."name", u."image"
    FROM projection_budget b JOIN people person ON b.fits = 1 JOIN "User" u ON u."id" = person."id"
    ORDER BY kind, createdAtMs DESC, id DESC
  `).bind(userId, spaceId, discussionId, replyId, cursor ? 1 : 0, cursor?.createdAt.getTime() ?? 0,
    cursor?.id ?? '', cursorValid ? 1 : 0).all<Row>();
  const context = result.results.find((row): row is ContextRow => row.kind === 'context');
  // Access/target404 deliberately precedes the defensive byte limit failure.
  if (!context) throw new Error('Missing D1 Space discussion read context');
  if (context.authorized !== 1) throw new SpaceApiError(missing, 404);
  if (context.fits !== 1) throw new Error('D1 Space discussion projection exceeds safe byte limits');
  return { rows: result.results.filter((row): row is ContentRow => row.kind === 'content'),
    people: personMap(result.results) };
}

export async function d1SpaceDiscussion(userId: string, spaceId: string, discussionId: string): Promise<SpaceDiscussionDto> {
  const { rows, people } = await readRows('discussion', userId, spaceId, discussionId);
  const row = rows[0];
  if (!row) throw new Error('Missing authorized D1 Space discussion');
  text(row.title);
  if (!Number.isSafeInteger(row.replyCount) || row.replyCount === null || row.replyCount < 0) {
    throw new Error('Invalid D1 Space reply count');
  }
  return d1BoundedResponse({ ...contentProjection(row, people), spaceId: row.parentId, title: row.title, replyCount: row.replyCount });
}

export async function d1SpaceReplies(userId: string, spaceId: string, discussionId: string,
  cursor: Cursor | null, cursorValid = true) {
  const { rows, people } = await readRows('replies', userId, spaceId, discussionId, '', cursor, cursorValid);
  const projected = rows.map(row => ({ row, ...contentProjection(row, people),
    discussionId: row.parentId, createdAt: d1Date(row.createdAtMs) }));
  const page = pageSpaceRows(projected, 'replies', spaceId, discussionId);
  const items: SpaceReplyDto[] = page.items.map(({ row }) => ({ ...contentProjection(row, people), discussionId: row.parentId }));
  return d1BoundedResponse({ items, nextCursor: page.nextCursor });
}

export async function d1SpaceReply(userId: string, spaceId: string, discussionId: string, replyId: string): Promise<SpaceReplyDto> {
  const { rows, people } = await readRows('reply', userId, spaceId, discussionId, replyId);
  const row = rows[0];
  if (!row) throw new Error('Missing authorized D1 Space reply');
  return d1BoundedResponse({ ...contentProjection(row, people), discussionId: row.parentId });
}
