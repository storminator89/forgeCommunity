import 'server-only';

import { env } from 'cloudflare:workers';
import { missionWindowState } from '@/lib/mission-week-clock';
import { SPACE_ID_RE, SpaceApiError } from '@/lib/server/space-api';
import type { MissionNextAction } from '@/types/space-mission-invitations';

const PAGE_SIZE = 20;
const PARTICIPANT_LIMIT = 5;
const CONTRIBUTION_LIMIT = 5;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
type StoredDate = string | number;
type Mode = 'list' | 'detail' | 'moderation';
type Cursor = { createdAt: Date; id: string };
type Person = { id: string; name: string | null; image: string | null };
type DataRow = { kind: string; missionId: string | null; data: string | null;
  personId: string | null; name: string | null; image: string | null };
type Context = { authorized: number; isAdmin: number; isMember: number; role: string | null;
  found: number; pageCount: number; invalidState: number; oversized: number };
type MissionRow = { id: string; spaceId: string; title: string; prompt: string; creatorId: string | null;
  createdAt: StoredDate; createdAtMs: number; closedAt: StoredDate | null; weekStartsOn: string | null; weekTimezone: string | null;
  weekStartsAt: StoredDate | null; weekEndsAt: StoredDate | null; selfExists: number; epoch: number;
  joinedAt: StoredDate | null; optedOutAt: StoredDate | null; reservedSlots: number;
  bookmarkSaved: number; bookmarkRevision: number; bookmarkAccessEpoch: number;
  insightAttempts: number; buildOnAttempts: number };
type ParticipantRow = { userId: string; joinedAt: StoredDate };
type ContributionRow = { id: string; authorId: string; kind: 'INSIGHT' | 'BUILD_ON'; content: string;
  createdAt: StoredDate; createdAtMs: number; targetContributionId: string | null; hiddenAt?: StoredDate | null; withdrawnAt?: StoredDate | null };
type OwnRow = { id: string; kind: 'INSIGHT' | 'BUILD_ON'; hidden: number; createdAtMs: number; targetContributionId: string | null };

function date(value: StoredDate): Date {
  const normalized = typeof value === 'string' && /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?$/.test(value)
    ? `${value.replace(' ', 'T')}Z` : value;
  const result = new Date(normalized);
  if (!Number.isFinite(result.getTime())) throw new Error('Invalid D1 mission timestamp');
  return result;
}
function milliseconds(column: string) {
  return `CASE WHEN typeof(${column}) IN ('integer', 'real') THEN ${column}
    ELSE ROUND((julianday(${column}) - 2440587.5) * 86400000) END`;
}

function readCursor(request: Request | undefined, scope: string): Cursor | null {
  const raw = request ? new URL(request.url).searchParams.get('cursor') : null;
  if (raw === null) return null;
  try {
    if (!raw || raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const bytes = Buffer.from(raw, 'base64url');
    if (bytes.toString('base64url') !== raw) throw new Error();
    const value = JSON.parse(bytes.toString('utf8'));
    if (value?.v !== 1 || value?.kind !== 'space-missions' || value?.spaceId !== scope ||
        typeof value.id !== 'string' || !SPACE_ID_RE.test(value.id) || typeof value.createdAt !== 'string') throw new Error();
    const createdAt = new Date(value.createdAt);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== value.createdAt) throw new Error();
    return { createdAt, id: value.id };
  } catch { throw new SpaceApiError('Ungültiger Cursor', 400); }
}

function encodeCursor(row: { id: string; createdAtMs: number }, scope: string) {
  return Buffer.from(JSON.stringify({ v: 1, kind: 'space-missions', spaceId: scope,
    createdAt: new Date(row.createdAtMs).toISOString(), id: row.id })).toString('base64url');
}

// One primary SQL statement owns identity, Space authority, current consent,
// targets, bookmarks and all page projections. People are transported once in
// separate typed rows; the response byte budget counts every DTO occurrence.
const missionReadSql = `WITH viewer AS (SELECT id, role FROM User WHERE id = ?1),
  access AS (SELECT s.id, v.role, (v.role = 'ADMIN') AS isAdmin,
    EXISTS (SELECT 1 FROM SpaceMember own WHERE own.spaceId = s.id AND own.userId = v.id) AS isMember
    FROM Space s JOIN viewer v ON 1 = 1 WHERE s.id = ?2 AND s.visibility = 'PRIVATE'
      AND (v.role = 'ADMIN' OR EXISTS (SELECT 1 FROM SpaceMember own WHERE own.spaceId = s.id AND own.userId = v.id))),
  mission_page AS (SELECT m.*, ${milliseconds('m.createdAt')} AS createdAtMs
    FROM SpaceMission m JOIN access a ON a.id = m.spaceId
    WHERE (?3 = '' OR m.id = ?3) AND (?4 <> 'list' OR ?8 = 1)
      AND (?4 <> 'list' OR ?5 = 0 OR ${milliseconds('m.createdAt')} < ?6
        OR (${milliseconds('m.createdAt')} = ?6 AND m.id < ?7))
    ORDER BY createdAtMs DESC, m.id DESC LIMIT CASE WHEN ?4 = 'list' THEN 21 ELSE 1 END),
  missions AS (SELECT * FROM mission_page ORDER BY createdAtMs DESC, id DESC LIMIT 20),
  eligible AS (SELECT p.missionId, p.userId, p.epoch, p.joinedAt,
      ROW_NUMBER() OVER (PARTITION BY p.missionId ORDER BY ${milliseconds('p.joinedAt')} ASC, p.userId ASC) AS position
    FROM SpaceMissionParticipation p JOIN missions m ON m.id = p.missionId
    JOIN User u ON u.id = p.userId AND u.role = 'USER'
    JOIN SpaceMember member ON member.userId = u.id AND member.spaceId = m.spaceId WHERE p.optedOutAt IS NULL),
  participants AS (SELECT * FROM eligible WHERE position <= 5),
  live_contributions AS (SELECT c.*, ${milliseconds('c.createdAt')} AS createdAtMs
    FROM SpaceMissionContribution c JOIN participants p ON p.missionId = c.missionId
      AND p.userId = c.authorId AND p.epoch = c.epoch WHERE c.hiddenAt IS NULL AND c.withdrawnAt IS NULL),
  visible_ranked AS (SELECT c.*, ROW_NUMBER() OVER
      (PARTITION BY c.missionId ORDER BY c.createdAtMs ASC, c.id ASC) AS position
    FROM live_contributions c WHERE c.kind = 'INSIGHT' OR (c.kind = 'BUILD_ON' AND EXISTS
      (SELECT 1 FROM live_contributions target WHERE target.id = c.targetContributionId
        AND target.missionId = c.missionId AND target.kind = 'INSIGHT' AND target.authorId <> c.authorId))),
  visible AS (SELECT * FROM visible_ranked WHERE position <= 10),
  own_ranked AS (SELECT c.*, ${milliseconds('c.createdAt')} AS createdAtMs, ROW_NUMBER() OVER
      (PARTITION BY c.missionId ORDER BY ${milliseconds('c.createdAt')} DESC, c.id DESC) AS position
    FROM SpaceMissionContribution c JOIN missions m ON m.id = c.missionId JOIN access a ON a.id = m.spaceId
    JOIN SpaceMissionParticipation p ON p.missionId = c.missionId AND p.userId = ?1 AND p.epoch = c.epoch
    WHERE c.authorId = ?1 AND p.optedOutAt IS NULL AND a.isMember = 1 AND a.role = 'USER' AND c.withdrawnAt IS NULL),
  own AS (SELECT * FROM own_ranked WHERE position <= 10),
  moderation_page AS (SELECT c.*, ${milliseconds('c.createdAt')} AS createdAtMs
    FROM SpaceMissionContribution c JOIN missions m ON m.id = c.missionId JOIN access a ON a.id = m.spaceId
    WHERE ?4 = 'moderation' AND a.isAdmin = 1 AND ?8 = 1 AND (?5 = 0 OR ${milliseconds('c.createdAt')} < ?6
      OR (${milliseconds('c.createdAt')} = ?6 AND c.id < ?7))
    ORDER BY createdAtMs DESC, c.id DESC LIMIT 21),
  moderation AS (SELECT * FROM moderation_page ORDER BY createdAtMs DESC, id DESC LIMIT 20),
  invalid AS (SELECT
    EXISTS (SELECT 1 FROM missions m WHERE
      (SELECT COUNT(*) FROM SpaceMissionParticipation p WHERE p.missionId = m.id AND p.optedOutAt IS NULL) > 5
      OR EXISTS (SELECT 1 FROM SpaceMissionParticipation p WHERE p.missionId = m.id AND p.optedOutAt IS NULL
        AND (p.epoch < 1 OR p.epoch > 2147483646)))
    OR EXISTS (SELECT 1 FROM live_contributions GROUP BY missionId, authorId, epoch, kind HAVING COUNT(*) > 1)
    OR EXISTS (SELECT 1 FROM live_contributions WHERE kind NOT IN ('INSIGHT', 'BUILD_ON')) AS invalidState),
  usages AS (SELECT creatorId AS personId FROM missions WHERE ?4 <> 'moderation' AND creatorId IS NOT NULL
    UNION ALL SELECT userId FROM participants WHERE ?4 <> 'moderation'
    UNION ALL SELECT authorId FROM visible WHERE ?4 <> 'moderation'
    UNION ALL SELECT authorId FROM moderation),
  people AS (SELECT u.id, u.name, u.image, (SELECT COUNT(*) FROM usages n WHERE n.personId = u.id) AS uses
    FROM User u WHERE u.id IN (SELECT personId FROM usages)),
  field_guard AS (SELECT
    EXISTS (SELECT 1 FROM people WHERE length(CAST(COALESCE(name, '') AS BLOB)) > 256000
      OR length(CAST(COALESCE(image, '') AS BLOB)) > 256000 OR length(CAST(id AS BLOB)) > 1024)
    OR EXISTS (SELECT 1 FROM missions WHERE length(CAST(title AS BLOB)) > 64000 OR length(CAST(prompt AS BLOB)) > 64000
      OR length(CAST(id AS BLOB)) > 1024 OR length(CAST(spaceId AS BLOB)) > 1024
      OR length(CAST(COALESCE(creatorId, '') AS BLOB)) > 1024
      OR length(CAST(COALESCE(weekStartsOn, '') AS BLOB)) > 1024 OR length(CAST(COALESCE(weekTimezone, '') AS BLOB)) > 1024
      OR length(CAST(createdAt AS BLOB)) > 1024 OR length(CAST(COALESCE(closedAt, '') AS BLOB)) > 1024
      OR length(CAST(COALESCE(weekStartsAt, '') AS BLOB)) > 1024 OR length(CAST(COALESCE(weekEndsAt, '') AS BLOB)) > 1024)
    OR EXISTS (SELECT 1 FROM participants WHERE length(CAST(userId AS BLOB)) > 1024 OR length(CAST(joinedAt AS BLOB)) > 1024)
    OR EXISTS (SELECT 1 FROM SpaceMissionParticipation p JOIN missions m ON m.id = p.missionId WHERE p.userId = ?1
      AND (length(CAST(p.joinedAt AS BLOB)) > 1024 OR length(CAST(COALESCE(p.optedOutAt, '') AS BLOB)) > 1024))
    OR EXISTS (SELECT 1 FROM visible WHERE length(CAST(content AS BLOB)) > 64000 OR length(CAST(id AS BLOB)) > 1024
      OR length(CAST(authorId AS BLOB)) > 1024 OR length(CAST(COALESCE(targetContributionId, '') AS BLOB)) > 1024
      OR length(CAST(createdAt AS BLOB)) > 1024 OR length(CAST(kind AS BLOB)) > 1024)
    OR EXISTS (SELECT 1 FROM own WHERE length(CAST(id AS BLOB)) > 1024 OR length(CAST(kind AS BLOB)) > 1024
      OR length(CAST(COALESCE(targetContributionId, '') AS BLOB)) > 1024)
    OR EXISTS (SELECT 1 FROM moderation WHERE length(CAST(content AS BLOB)) > 64000 OR length(CAST(id AS BLOB)) > 1024
      OR length(CAST(authorId AS BLOB)) > 1024 OR length(CAST(COALESCE(targetContributionId, '') AS BLOB)) > 1024
      OR length(CAST(createdAt AS BLOB)) > 1024 OR length(CAST(kind AS BLOB)) > 1024
      OR length(CAST(COALESCE(hiddenAt, '') AS BLOB)) > 1024 OR length(CAST(COALESCE(withdrawnAt, '') AS BLOB)) > 1024) AS oversized),
  records AS (
    SELECT 'mission' AS kind, m.id AS missionId, CASE WHEN f.oversized = 0 THEN json_patch(json_object(
      'id', m.id, 'spaceId', m.spaceId, 'title', m.title, 'prompt', m.prompt, 'creatorId', m.creatorId,
      'createdAt', m.createdAt, 'createdAtMs', m.createdAtMs, 'closedAt', m.closedAt, 'weekStartsOn', m.weekStartsOn, 'weekTimezone', m.weekTimezone,
      'weekStartsAt', m.weekStartsAt, 'weekEndsAt', m.weekEndsAt, 'joinedAt', p.joinedAt, 'optedOutAt', p.optedOutAt), json_object(
      'selfExists', p.userId IS NOT NULL, 'epoch', COALESCE(p.epoch, 0),
      'reservedSlots', (SELECT COUNT(*) FROM SpaceMissionParticipation capacity WHERE capacity.missionId = m.id AND capacity.optedOutAt IS NULL),
      'bookmarkSaved', b.savedAt IS NOT NULL, 'bookmarkRevision', COALESCE(b.revision, 0),
      'bookmarkAccessEpoch', COALESCE(ba.epoch, 0),
      'insightAttempts', (SELECT COUNT(*) FROM SpaceMissionContribution c WHERE c.missionId = m.id AND c.authorId = ?1 AND c.kind = 'INSIGHT'),
      'buildOnAttempts', (SELECT COUNT(*) FROM SpaceMissionContribution c WHERE c.missionId = m.id AND c.authorId = ?1 AND c.kind = 'BUILD_ON'))) END AS data
    FROM missions m CROSS JOIN field_guard f
    LEFT JOIN SpaceMissionParticipation p ON p.missionId = m.id AND p.userId = ?1
    LEFT JOIN SpaceMissionBookmarkSetting b ON b.missionId = m.id AND b.userId = ?1
    LEFT JOIN SpaceMissionBookmarkAccess ba ON ba.userId = ?1 WHERE ?4 <> 'moderation'
    UNION ALL SELECT 'participant', p.missionId, CASE WHEN f.oversized = 0 THEN json_object('userId', p.userId, 'joinedAt', p.joinedAt) END
      FROM participants p CROSS JOIN field_guard f WHERE ?4 <> 'moderation'
    UNION ALL SELECT 'contribution', c.missionId, CASE WHEN f.oversized = 0 THEN json_object(
      'id', c.id, 'authorId', c.authorId, 'kind', c.kind, 'content', c.content, 'createdAt', c.createdAt, 'createdAtMs', c.createdAtMs,
      'targetContributionId', c.targetContributionId) END FROM visible c CROSS JOIN field_guard f WHERE ?4 <> 'moderation'
    UNION ALL SELECT 'own', c.missionId, CASE WHEN f.oversized = 0 THEN json_object('id', c.id, 'kind', c.kind,
      'createdAtMs', c.createdAtMs, 'hidden', c.hiddenAt IS NOT NULL, 'targetContributionId', c.targetContributionId) END
      FROM own c CROSS JOIN field_guard f WHERE ?4 <> 'moderation'
    UNION ALL SELECT 'moderation', c.missionId, CASE WHEN f.oversized = 0 THEN json_object(
      'id', c.id, 'authorId', c.authorId, 'kind', c.kind, 'content', c.content, 'createdAt', c.createdAt, 'createdAtMs', c.createdAtMs,
      'targetContributionId', c.targetContributionId, 'hiddenAt', c.hiddenAt, 'withdrawnAt', c.withdrawnAt) END
      FROM moderation c CROSS JOIN field_guard f),
  budget AS (SELECT f.oversized OR COALESCE((SELECT SUM(length(CAST(data AS BLOB)) + 4096) FROM records), 0)
    + CASE WHEN f.oversized = 0 THEN COALESCE((SELECT SUM(uses *
      (length(CAST(json_quote(id) AS BLOB)) + length(CAST(json_quote(name) AS BLOB)) + length(CAST(json_quote(image) AS BLOB)) + 1024)) FROM people), 0) ELSE 0 END > 8388608
    AS oversized FROM field_guard f)
  SELECT 'context' AS kind, NULL AS missionId, json_object(
    'authorized', EXISTS (SELECT 1 FROM access), 'isAdmin', COALESCE((SELECT isAdmin FROM access), 0),
    'isMember', COALESCE((SELECT isMember FROM access), 0), 'role', (SELECT role FROM viewer),
    'found', (SELECT COUNT(*) FROM missions),
    'pageCount', CASE WHEN ?4 = 'moderation' THEN (SELECT COUNT(*) FROM moderation_page) ELSE (SELECT COUNT(*) FROM mission_page) END,
    'invalidState', (SELECT invalidState FROM invalid), 'oversized', b.oversized) AS data,
    NULL AS personId, NULL AS name, NULL AS image FROM budget b
  UNION ALL SELECT r.kind, r.missionId, r.data, NULL, NULL, NULL FROM records r, budget b WHERE b.oversized = 0
  UNION ALL SELECT 'person', NULL, NULL, p.id, p.name, p.image FROM people p, budget b WHERE b.oversized = 0`;

async function read(spaceId: string, userId: string, id: string, mode: Mode, request?: Request) {
  let cursor: Cursor | null = null;
  let cursorError: unknown;
  const scope = mode === 'moderation' ? `${spaceId}:${id}` : spaceId;
  try { cursor = readCursor(request, scope); } catch (error) { cursorError = error; }
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is unavailable.');
  const result = await env.DB.withSession('first-primary').prepare(missionReadSql)
    .bind(userId, spaceId, id, mode, cursor ? 1 : 0, cursor?.createdAt.getTime() ?? 0, cursor?.id ?? '', cursorError ? 0 : 1)
    .all<DataRow>();
  const contextRow = result.results.find(row => row.kind === 'context');
  if (!contextRow?.data) throw new Error('Missing D1 mission context');
  const context = JSON.parse(contextRow.data) as Context;
  if (!context.authorized) throw new SpaceApiError('Mission nicht gefunden', 404);
  if (mode === 'moderation' && !context.isAdmin) throw new SpaceApiError('Nicht autorisiert', 403);
  if (mode !== 'list' && !context.found) throw new SpaceApiError('Mission nicht gefunden', 404);
  if (cursorError) throw cursorError;
  if (context.invalidState) throw new SpaceApiError('Mission enthält einen ungültigen Teilnahmestand.', 409);
  if (context.oversized) throw new SpaceApiError('Missionsdaten sind zu groß und können nicht sicher geladen werden.', 500);
  const people = new Map<string, Person>();
  for (const row of result.results) if (row.kind === 'person' && row.personId) {
    people.set(row.personId, { id: row.personId, name: row.name, image: row.image });
  }
  const data = <T>(kind: string, missionId?: string): T[] => result.results
    .filter(row => row.kind === kind && (missionId === undefined || row.missionId === missionId))
    .map(row => JSON.parse(row.data!) as T);
  const person = (personId: string) => {
    const found = people.get(personId);
    if (!found) throw new Error('Missing D1 mission person');
    return found;
  };
  return { context, data, person, scope };
}

function boundResponse<T>(value: T): T {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_RESPONSE_BYTES) {
    throw new SpaceApiError('Missionsdaten sind zu groß und können nicht sicher geladen werden.', 500);
  }
  return value;
}

function contribution(row: ContributionRow, userId: string, person: (id: string) => Person) {
  return { id: row.id, kind: row.kind, content: row.content, author: person(row.authorId),
    createdAt: date(row.createdAt).toISOString(), targetContributionId: row.targetContributionId,
    canWithdraw: row.authorId === userId };
}

function project(row: MissionRow, userId: string, snapshot: Awaited<ReturnType<typeof read>>) {
  const { context, data, person } = snapshot;
  const active = Boolean(row.selfExists && row.optedOutAt === null && context.isMember && context.role === 'USER');
  const participants = data<ParticipantRow>('participant', row.id).sort((a, b) =>
    date(a.joinedAt).getTime() - date(b.joinedAt).getTime() || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  const visible = data<ContributionRow>('contribution', row.id).sort((a, b) =>
    a.createdAtMs - b.createdAtMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const own = data<OwnRow>('own', row.id).sort((a, b) => b.createdAtMs - a.createdAtMs || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const visibleIds = new Set(visible.map(item => item.id));
  const insightAuthors = new Set(visible.filter(item => item.kind === 'INSIGHT').map(item => item.authorId)).size;
  const hasCrossPersonBuildOn = visible.some(item => item.kind === 'BUILD_ON');
  let myNextAction: MissionNextAction | null = null;
  if (active) {
    const ownInsight = visible.some(item => item.authorId === userId && item.kind === 'INSIGHT');
    const ownBuildOn = own.find(item => item.kind === 'BUILD_ON' && !item.hidden);
    const target = visible.find(item => item.kind === 'INSIGHT' && item.authorId !== userId);
    if (row.closedAt !== null) myNextAction = { kind: 'CLOSED' };
    else if (insightAuthors >= 2 && hasCrossPersonBuildOn) myNextAction = { kind: 'CURRENT_GOAL_REACHED' };
    else if (!ownInsight) myNextAction = { kind: row.insightAttempts < CONTRIBUTION_LIMIT ? 'SHARE_INSIGHT' : 'LIMIT_REACHED' };
    else if (ownBuildOn && !visibleIds.has(ownBuildOn.id)) myNextAction = { kind: 'REVIEW_BUILD_ON', contributionId: ownBuildOn.id };
    else if (!ownBuildOn && target && row.buildOnAttempts < CONTRIBUTION_LIMIT) myNextAction = { kind: 'BUILD_ON', targetContributionId: target.id };
    else if (!ownBuildOn && row.buildOnAttempts >= CONTRIBUTION_LIMIT) myNextAction = { kind: 'LIMIT_REACHED' };
    else myNextAction = { kind: 'WAIT_FOR_PEER' };
  }
  return { id: row.id, spaceId: row.spaceId, title: row.title, prompt: row.prompt,
    creator: row.creatorId === null ? null : person(row.creatorId), createdAt: date(row.createdAt).toISOString(),
    closedAt: row.closedAt === null ? null : date(row.closedAt).toISOString(),
    week: row.weekStartsOn !== null && row.weekTimezone !== null && row.weekStartsAt !== null && row.weekEndsAt !== null
      ? { startDate: row.weekStartsOn, timezone: row.weekTimezone,
        startsAt: date(row.weekStartsAt).toISOString(), endsAt: date(row.weekEndsAt).toISOString() } : null,
    windowState: missionWindowState(row.weekEndsAt === null ? null : date(row.weekEndsAt), new Date()),
    participants: participants.map(item => ({ ...person(item.userId), joinedAt: date(item.joinedAt).toISOString() })),
    participantLimit: PARTICIPANT_LIMIT,
    participation: { epoch: row.epoch, active, joinedAt: row.joinedAt === null ? null : date(row.joinedAt).toISOString(),
      optedOutAt: row.optedOutAt === null ? null : date(row.optedOutAt).toISOString() },
    ownBookmark: context.isMember && row.closedAt === null
      ? { saved: Boolean(row.bookmarkSaved), revision: row.bookmarkRevision, accessEpoch: row.bookmarkAccessEpoch } : null,
    canManage: Boolean(context.isAdmin), myNextAction,
    canJoin: row.closedAt === null && !active && Boolean(context.isMember) && context.role === 'USER' && row.reservedSlots < PARTICIPANT_LIMIT,
    contributions: visible.map(item => contribution(item, userId, person)),
    ownContributions: own.map(item => ({ id: item.id, kind: item.kind, hidden: Boolean(item.hidden),
      targetUnavailable: Boolean(item.targetContributionId && !visibleIds.has(item.targetContributionId)), canWithdraw: true })),
    progress: { insightAuthors, hasCrossPersonBuildOn, complete: insightAuthors >= 2 && hasCrossPersonBuildOn } };
}

export async function readD1SpaceMission(spaceId: string, id: string, userId: string) {
  const result = await read(spaceId, userId, id, 'detail');
  return boundResponse(project(result.data<MissionRow>('mission')[0], userId, result));
}

export async function listD1SpaceMissions(spaceId: string, userId: string, request: Request) {
  const result = await read(spaceId, userId, '', 'list', request);
  const missions = result.data<MissionRow>('mission').sort((a, b) =>
    b.createdAtMs - a.createdAtMs || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return boundResponse({ items: missions.map(row => project(row, userId, result)),
    nextCursor: result.context.pageCount > PAGE_SIZE ? encodeCursor(missions[missions.length - 1], spaceId) : null });
}

export async function listD1MissionModeration(spaceId: string, id: string, userId: string, request: Request) {
  const result = await read(spaceId, userId, id, 'moderation', request);
  const rows = result.data<ContributionRow>('moderation').sort((a, b) =>
    b.createdAtMs - a.createdAtMs || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return boundResponse({ items: rows.map(row => ({ ...contribution(row, userId, result.person),
    hiddenAt: row.hiddenAt === null || row.hiddenAt === undefined ? null : date(row.hiddenAt).toISOString(),
    withdrawnAt: row.withdrawnAt === null || row.withdrawnAt === undefined ? null : date(row.withdrawnAt).toISOString() })),
    nextCursor: result.context.pageCount > PAGE_SIZE ? encodeCursor(rows[rows.length - 1], result.scope) : null });
}
