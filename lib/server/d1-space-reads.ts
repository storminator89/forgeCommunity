import 'server-only';

import { env } from 'cloudflare:workers';
import type { SpaceSummary } from '@/lib/server/space-access';
import { pageSpaceDirectory, SPACE_DIRECTORY_PAGE_SIZE, SpaceApiError } from '@/lib/server/space-api';
import { pageSpaceRows, SPACE_PAGE_SIZE, type SpaceDiscussionDto } from '@/lib/server/space-discussions';

export type D1StoredDate = string | number;
type CreatedCursor = { createdAt: Date; id: string };
export type D1SpaceMemberCursor = { joinedAt: Date; userId: string };
type Person = { id: string; name: string | null; image: string | null };

/** Start each protected statement at the primary, including with replication. */
export function d1SpaceDatabase() {
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is unavailable.');
  return env.DB.withSession('first-primary');
}

/** Adapter ISO dates, SQLite UTC defaults and legacy numeric milliseconds. */
export function d1Date(value: D1StoredDate): Date {
  const normalized = typeof value === 'string' && /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?$/.test(value)
    ? `${value.replace(' ', 'T')}Z` : value;
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid D1 Space timestamp');
  return date;
}

/** Only interpolate source-owned SQL expressions, never request values. */
export function d1DateMs(expression: string) {
  return `(CASE WHEN typeof(${expression}) IN ('integer', 'real') THEN CAST(${expression} AS INTEGER)
    ELSE CAST(ROUND((julianday(${expression}) - 2440587.5) * 86400000) AS INTEGER) END)`;
}

/** Shared statement prefix: ?1 is the live account and ?2 the requested Space.
 * Deliberately contains no Space text or account profile/private fields. */
export function d1SpaceAccessCtes({ privateOnly = false, adminOnly = false }: {
  privateOnly?: boolean; adminOnly?: boolean;
} = {}) {
  return `viewer AS (SELECT u."id", u."role" FROM "User" u WHERE u."id" = ?1),
    access AS (
      SELECT s."id", s."visibility", (v."role" = 'ADMIN') AS "canManage",
        EXISTS (SELECT 1 FROM "SpaceMember" member WHERE member."spaceId" = s."id"
          AND member."userId" = v."id") AS "isMember"
      FROM viewer v JOIN "Space" s ON s."id" = ?2
      WHERE ${privateOnly ? `s."visibility" = 'PRIVATE' AND` : ''}
        ${adminOnly ? `v."role" = 'ADMIN' AND` : ''}
        (s."visibility" = 'PUBLIC' OR v."role" = 'ADMIN' OR EXISTS (
          SELECT 1 FROM "SpaceMember" member WHERE member."spaceId" = s."id" AND member."userId" = v."id"))
    )`;
}

// https://developers.cloudflare.com/d1/platform/limits/ documents a 2,000,000
// byte string/BLOB/row limit. Stay below it even for oversized legacy fields.
// The result budget also bounds worst-case JSON escaping (six bytes per UTF-8
// byte), column/row overhead and Worker memory. These are fail-closed limits,
// never field truncation or successful partial pages.
export const D1_SPACE_ROW_BYTES = 1_500_000;
export const D1_SPACE_RESULT_BYTES = 32_000_000;
export const D1_SPACE_RESPONSE_BYTES = 16_000_000;

export function d1TextBytes(...expressions: string[]) {
  return expressions.map(expression => `COALESCE(length(CAST(${expression} AS BLOB)), 0)`).join(' + ') || '0';
}

/** rowByteSelect must return one numeric `bytes` row per projected record;
 * responseByteSelect must also weight every repeated person in the final DTO.
 * Size only already-authorized page rows and distinct people. Do not construct
 * JSON for the size check: JSON escaping itself can exceed D1's cell limit. */
export function d1ProjectionBudgetCtes(rowByteSelect: string, responseByteSelect = rowByteSelect) {
  return `projection_sizes AS (${rowByteSelect}),
    response_sizes AS (${responseByteSelect}),
    projection_budget AS (
      SELECT (COALESCE(MAX(bytes), 0) <= ${D1_SPACE_ROW_BYTES}
        AND COALESCE(SUM(6 * bytes + 4096), 0) <= ${D1_SPACE_RESULT_BYTES}
        AND (SELECT COALESCE(SUM(6 * bytes + 4096), 0) FROM response_sizes) <= ${D1_SPACE_RESPONSE_BYTES}) AS fits
      FROM projection_sizes
    )`;
}

function assertFits(fits: number) {
  if (fits !== 1) throw new Error('D1 Space projection exceeds safe byte limits');
}

/** Count the actual assembled JSON, including repeated references to the same
 * person, before Response.json allocates it. Only scalar strings are encoded
 * here, so a repeated large avatar cannot first allocate a giant DTO string. */
export function d1BoundedResponse<T>(value: T): T {
  let bytes = 0;
  const stringSizes = new Map<string, number>();
  const add = (size: number) => {
    bytes += size;
    if (bytes > D1_SPACE_RESPONSE_BYTES) throw new Error('D1 Space response exceeds safe byte limits');
  };
  const stringBytes = (text: string) => {
    let size = stringSizes.get(text);
    if (size === undefined) {
      size = Buffer.byteLength(JSON.stringify(text), 'utf8');
      stringSizes.set(text, size);
    }
    return size;
  };
  const visit = (item: unknown): void => {
    if (typeof item === 'string') { add(stringBytes(item)); return; }
    if (item === null) { add(4); return; }
    if (typeof item === 'number') { add(Number.isFinite(item) ? String(item).length : 4); return; }
    if (typeof item === 'boolean') { add(String(item).length); return; }
    if (item instanceof Date) { add(stringBytes(item.toISOString())); return; }
    if (Array.isArray(item)) {
      add(2 + Math.max(0, item.length - 1));
      for (const entry of item) visit(entry);
      return;
    }
    if (typeof item === 'object') {
      const entries = Object.entries(item);
      add(2 + Math.max(0, entries.length - 1));
      for (const [key, entry] of entries) { add(stringBytes(key) + 1); visit(entry); }
      return;
    }
    throw new Error('Unsupported D1 Space response value');
  };
  visit(value);
  return value;
}

type SummaryRow = {
  kind: 'space'; id: string; name: string; description: string; visibility: SpaceSummary['visibility'];
  createdAt: D1StoredDate; updatedAt: D1StoredDate; createdAtMs: number;
  memberCount: number; discussionCount: number; isMember: number; canManage: number;
};
type SummaryContextRow = { kind: 'context'; live: number; fits: number };

function summary(row: SummaryRow): SpaceSummary {
  return { id: row.id, name: row.name, description: row.description, visibility: row.visibility,
    createdAt: d1Date(row.createdAt).toISOString(), updatedAt: d1Date(row.updatedAt).toISOString(),
    memberCount: row.memberCount, discussionCount: row.discussionCount,
    isMember: Boolean(row.isMember), canManage: Boolean(row.canManage), canWrite: Boolean(row.isMember) };
}

const summaryTextBytes = d1TextBytes('s."id"', 's."name"', 's."description"', 's."visibility"', 's."createdAt"', 's."updatedAt"');

export async function d1SpaceDirectory(userId: string, cursor: CreatedCursor | null) {
  const result = await d1SpaceDatabase().prepare(`
    WITH viewer AS (SELECT "id", "role" FROM "User" WHERE "id" = ?1),
    readable AS (
      SELECT s."id", ${d1DateMs('s."createdAt"')} AS "createdAtMs"
      FROM viewer v JOIN "Space" s ON s."visibility" = 'PUBLIC' OR v."role" = 'ADMIN' OR EXISTS (
        SELECT 1 FROM "SpaceMember" member WHERE member."spaceId" = s."id" AND member."userId" = v."id")
    ), page AS (
      SELECT * FROM readable WHERE ?2 = 0 OR "createdAtMs" < ?3 OR ("createdAtMs" = ?3 AND "id" < ?4)
      ORDER BY "createdAtMs" DESC, "id" DESC LIMIT ${SPACE_DIRECTORY_PAGE_SIZE + 1}
    ), ${d1ProjectionBudgetCtes(`SELECT ${summaryTextBytes} AS bytes FROM page p JOIN "Space" s ON s."id" = p."id"`)}
    SELECT 'context' AS kind, EXISTS(SELECT 1 FROM viewer) AS live, b.fits,
      NULL AS id, NULL AS name, NULL AS description, NULL AS visibility, NULL AS createdAt,
      NULL AS updatedAt, NULL AS createdAtMs, NULL AS memberCount, NULL AS discussionCount,
      NULL AS isMember, NULL AS canManage
    FROM projection_budget b
    UNION ALL
    SELECT 'space', NULL, NULL, s."id", s."name", s."description", s."visibility", s."createdAt", s."updatedAt",
      p."createdAtMs", (SELECT COUNT(*) FROM "SpaceMember" m WHERE m."spaceId" = s."id"),
      (SELECT COUNT(*) FROM "SpaceDiscussion" d WHERE d."spaceId" = s."id" AND d."hiddenAt" IS NULL),
      EXISTS(SELECT 1 FROM "SpaceMember" m WHERE m."spaceId" = s."id" AND m."userId" = v."id"), v."role" = 'ADMIN'
    FROM projection_budget b JOIN page p ON b.fits = 1 JOIN "Space" s ON s."id" = p."id" CROSS JOIN viewer v
    ORDER BY kind, createdAtMs DESC, id DESC
  `).bind(userId, cursor ? 1 : 0, cursor?.createdAt.getTime() ?? 0, cursor?.id ?? '').all<SummaryContextRow | SummaryRow>();
  const context = result.results.find((row): row is SummaryContextRow => row.kind === 'context');
  if (!context?.live) throw new SpaceApiError('Nicht authentifiziert', 401);
  assertFits(context.fits);
  const rows = result.results.filter((row): row is SummaryRow => row.kind === 'space');
  const page = pageSpaceDirectory(rows.map(row => ({ row, id: row.id, createdAt: d1Date(row.createdAtMs) })));
  return d1BoundedResponse({ items: page.items.map(item => summary(item.row)), nextCursor: page.nextCursor });
}

export async function d1SpaceSummary(userId: string, spaceId: string): Promise<SpaceSummary | null> {
  const result = await d1SpaceDatabase().prepare(`
    WITH ${d1SpaceAccessCtes()},
    ${d1ProjectionBudgetCtes(`SELECT ${summaryTextBytes} AS bytes FROM access a JOIN "Space" s ON s."id" = a."id"`)}
    SELECT 'context' AS kind, EXISTS(SELECT 1 FROM access) AS live, b.fits,
      NULL AS id, NULL AS name, NULL AS description, NULL AS visibility, NULL AS createdAt,
      NULL AS updatedAt, NULL AS createdAtMs, NULL AS memberCount, NULL AS discussionCount,
      NULL AS isMember, NULL AS canManage
    FROM projection_budget b
    UNION ALL
    SELECT 'space', NULL, NULL, s."id", s."name", s."description", s."visibility", s."createdAt", s."updatedAt",
      ${d1DateMs('s."createdAt"')}, (SELECT COUNT(*) FROM "SpaceMember" m WHERE m."spaceId" = s."id"),
      (SELECT COUNT(*) FROM "SpaceDiscussion" d WHERE d."spaceId" = s."id" AND d."hiddenAt" IS NULL), a."isMember", a."canManage"
    FROM projection_budget b JOIN access a ON b.fits = 1 JOIN "Space" s ON s."id" = a."id"
  `).bind(userId, spaceId).all<SummaryContextRow | SummaryRow>();
  const context = result.results.find((row): row is SummaryContextRow => row.kind === 'context');
  if (!context?.live) return null;
  assertFits(context.fits);
  const row = result.results.find((item): item is SummaryRow => item.kind === 'space');
  if (!row) throw new Error('Missing authorized D1 Space summary');
  return d1BoundedResponse(summary(row));
}

type DiscussionContextRow = { kind: 'context'; authorized: number; fits: number };
type DiscussionRow = { kind: 'discussion'; id: string; authorId: string; title: string; content: string;
  createdAt: D1StoredDate; updatedAt: D1StoredDate; hiddenAt: D1StoredDate | null; createdAtMs: number; replyCount: number };
type PersonRow = { kind: 'person' } & Person;

/** Cursor parsing errors are exposed by the route only after this authorization.
 * An invalid cursor suppresses all content and profile projections altogether. */
export async function d1SpaceDiscussions(userId: string, spaceId: string, cursor: CreatedCursor | null, cursorValid = true) {
  const result = await d1SpaceDatabase().prepare(`
    WITH ${d1SpaceAccessCtes()},
    readable AS (
      SELECT d."id", ${d1DateMs('d."createdAt"')} AS "createdAtMs"
      FROM access a JOIN "SpaceDiscussion" d ON d."spaceId" = a."id"
      WHERE ?6 = 1 AND (a."canManage" = 1 OR d."hiddenAt" IS NULL)
    ), page AS (
      SELECT * FROM readable WHERE ?3 = 0 OR "createdAtMs" < ?4 OR ("createdAtMs" = ?4 AND "id" < ?5)
      ORDER BY "createdAtMs" DESC, "id" DESC LIMIT ${SPACE_PAGE_SIZE + 1}
    ), people AS (
      SELECT DISTINCT u."id" FROM page p JOIN "SpaceDiscussion" d ON d."id" = p."id" JOIN "User" u ON u."id" = d."authorId"
    ), ${d1ProjectionBudgetCtes(`
      SELECT ${d1TextBytes('d."id"', 'd."authorId"', 'd."title"', 'd."content"', 'd."createdAt"', 'd."updatedAt"', 'd."hiddenAt"')} AS bytes
        FROM page p JOIN "SpaceDiscussion" d ON d."id" = p."id"
      UNION ALL SELECT ${d1TextBytes('u."id"', 'u."name"', 'u."image"')} AS bytes FROM people person JOIN "User" u ON u."id" = person."id"`,
      `SELECT ${d1TextBytes('d."id"', 'd."authorId"', 'd."title"', 'd."content"', 'd."createdAt"', 'd."updatedAt"', 'd."hiddenAt"', 'u."id"', 'u."name"', 'u."image"')} AS bytes
        FROM page p JOIN "SpaceDiscussion" d ON d."id" = p."id" JOIN "User" u ON u."id" = d."authorId"`)}
    SELECT 'context' AS kind, EXISTS(SELECT 1 FROM access) AS authorized, b.fits,
      NULL AS id, NULL AS authorId, NULL AS title, NULL AS content, NULL AS createdAt,
      NULL AS updatedAt, NULL AS hiddenAt, NULL AS createdAtMs, NULL AS replyCount, NULL AS name, NULL AS image
    FROM projection_budget b
    UNION ALL
    SELECT 'discussion', NULL, NULL, d."id", d."authorId", d."title", d."content", d."createdAt", d."updatedAt", d."hiddenAt",
      p."createdAtMs", (SELECT COUNT(*) FROM "SpaceReply" r WHERE r."discussionId" = d."id" AND r."hiddenAt" IS NULL), NULL, NULL
    FROM projection_budget b JOIN page p ON b.fits = 1 JOIN "SpaceDiscussion" d ON d."id" = p."id"
    UNION ALL
    SELECT 'person', NULL, NULL, u."id", NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, u."name", u."image"
    FROM projection_budget b JOIN people person ON b.fits = 1 JOIN "User" u ON u."id" = person."id"
    ORDER BY kind, createdAtMs DESC, id DESC
  `).bind(userId, spaceId, cursor ? 1 : 0, cursor?.createdAt.getTime() ?? 0, cursor?.id ?? '', cursorValid ? 1 : 0)
    .all<DiscussionContextRow | DiscussionRow | PersonRow>();
  const context = result.results.find((row): row is DiscussionContextRow => row.kind === 'context');
  if (!context?.authorized) throw new SpaceApiError('Space nicht gefunden', 404);
  assertFits(context.fits);
  const people = new Map(result.results.filter((row): row is PersonRow => row.kind === 'person')
    .map(row => [row.id, { id: row.id, name: row.name, image: row.image }]));
  const rows = result.results.filter((row): row is DiscussionRow => row.kind === 'discussion')
    .map(row => ({ ...row, storedCreatedAt: row.createdAt, createdAt: d1Date(row.createdAtMs) }));
  const page = pageSpaceRows(rows, 'discussions', spaceId);
  const items: SpaceDiscussionDto[] = page.items.map(row => {
    const author = people.get(row.authorId);
    if (!author) throw new Error('Missing D1 discussion author');
    return { id: row.id, spaceId, title: row.title, content: row.content, createdAt: d1Date(row.storedCreatedAt).toISOString(),
      updatedAt: d1Date(row.updatedAt).toISOString(), hiddenAt: row.hiddenAt === null ? null : d1Date(row.hiddenAt).toISOString(),
      author, replyCount: row.replyCount };
  });
  return d1BoundedResponse({ items, nextCursor: page.nextCursor });
}

const MEMBER_PAGE_SIZE = 20;
type MemberContextRow = { kind: 'context'; isAdmin: number; authorized: number; fits: number };
type MemberRow = { kind: 'member'; joinedAtMs: number } & Person;

export async function d1SpaceMembers(userId: string, spaceId: string, cursor: D1SpaceMemberCursor | null, cursorValid = true) {
  const result = await d1SpaceDatabase().prepare(`
    WITH ${d1SpaceAccessCtes({ privateOnly: true, adminOnly: true })},
    member_keys AS (
      SELECT m."userId", ${d1DateMs('m."joinedAt"')} AS "joinedAtMs"
      FROM access a JOIN "SpaceMember" m ON m."spaceId" = a."id" WHERE ?6 = 1
    ), page AS (
      SELECT * FROM member_keys WHERE ?3 = 0 OR "joinedAtMs" < ?4 OR ("joinedAtMs" = ?4 AND "userId" < ?5)
      ORDER BY "joinedAtMs" DESC, "userId" DESC LIMIT ${MEMBER_PAGE_SIZE + 1}
    ), ${d1ProjectionBudgetCtes(`SELECT ${d1TextBytes('u."id"', 'u."name"', 'u."image"')} AS bytes FROM page p JOIN "User" u ON u."id" = p."userId"`)}
    SELECT 'context' AS kind, EXISTS(SELECT 1 FROM viewer WHERE "role" = 'ADMIN') AS isAdmin,
      EXISTS(SELECT 1 FROM access) AS authorized, b.fits, NULL AS id, NULL AS joinedAtMs, NULL AS name, NULL AS image
    FROM projection_budget b
    UNION ALL
    SELECT 'member', NULL, NULL, NULL, u."id", p."joinedAtMs", u."name", u."image"
    FROM projection_budget b JOIN page p ON b.fits = 1 JOIN "User" u ON u."id" = p."userId"
    ORDER BY kind, joinedAtMs DESC, id DESC
  `).bind(userId, spaceId, cursor ? 1 : 0, cursor?.joinedAt.getTime() ?? 0, cursor?.userId ?? '', cursorValid ? 1 : 0)
    .all<MemberContextRow | MemberRow>();
  const context = result.results.find((row): row is MemberContextRow => row.kind === 'context');
  if (!context?.isAdmin) throw new SpaceApiError('Nicht autorisiert', 403);
  if (!context.authorized) throw new SpaceApiError('Space nicht gefunden', 404);
  assertFits(context.fits);
  const rows = result.results.filter((row): row is MemberRow => row.kind === 'member');
  const page = rows.slice(0, MEMBER_PAGE_SIZE);
  const last = page[page.length - 1];
  const nextCursor = rows.length > MEMBER_PAGE_SIZE ? Buffer.from(JSON.stringify({ v: 1, kind: 'space-members', spaceId,
    joinedAt: d1Date(last.joinedAtMs).toISOString(), userId: last.id })).toString('base64url') : null;
  return d1BoundedResponse({ items: page.map(row => ({ id: row.id, name: row.name, image: row.image })), nextCursor });
}

type CandidateContextRow = { kind: 'context'; isAdmin: number; authorized: number; fits: number };
type CandidateRow = { kind: 'candidate' } & Person;

export async function d1SpaceMemberCandidates(userId: string, spaceId: string, q: string) {
  const result = await d1SpaceDatabase().prepare(`
    WITH ${d1SpaceAccessCtes({ privateOnly: true, adminOnly: true })},
    candidates AS (
      SELECT u."id" FROM access a CROSS JOIN "User" u
      WHERE ?4 = 1 AND (instr(lower(u."id"), lower(?3)) > 0 OR instr(lower(u."name"), lower(?3)) > 0)
        AND NOT EXISTS (SELECT 1 FROM "SpaceMember" m WHERE m."spaceId" = a."id" AND m."userId" = u."id")
      ORDER BY u."name" ASC, u."id" ASC LIMIT 20
    ), ${d1ProjectionBudgetCtes(`SELECT ${d1TextBytes('u."id"', 'u."name"', 'u."image"')} AS bytes FROM candidates c JOIN "User" u ON u."id" = c."id"`)}
    SELECT 'context' AS kind, EXISTS(SELECT 1 FROM viewer WHERE "role" = 'ADMIN') AS isAdmin,
      EXISTS(SELECT 1 FROM access) AS authorized, b.fits, NULL AS id, NULL AS name, NULL AS image
    FROM projection_budget b
    UNION ALL
    SELECT 'candidate', NULL, NULL, NULL, u."id", u."name", u."image"
    FROM projection_budget b JOIN candidates c ON b.fits = 1 JOIN "User" u ON u."id" = c."id"
    ORDER BY kind, name ASC, id ASC
  `).bind(userId, spaceId, q, q.length >= 2 ? 1 : 0).all<CandidateContextRow | CandidateRow>();
  const context = result.results.find((row): row is CandidateContextRow => row.kind === 'context');
  if (!context?.isAdmin) throw new SpaceApiError('Nicht autorisiert', 403);
  if (!context.authorized) throw new SpaceApiError('Space nicht gefunden', 404);
  assertFits(context.fits);
  return d1BoundedResponse(result.results.filter((row): row is CandidateRow => row.kind === 'candidate')
    .map(row => ({ id: row.id, name: row.name, image: row.image })));
}
