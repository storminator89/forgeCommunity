import 'server-only';

import { env } from 'cloudflare:workers';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SPACE_ID_RE, SpaceApiError } from '@/lib/server/space-api';
import { invitationUnavailable } from '@/lib/server/space-mission-invitation-state';
import type { MissionInvitationList, MissionInvitationPreference } from '@/types/space-mission-invitations';

const PAGE_SIZE = 20;
const MAX_VERSION = 2147483647;
const MAX_DATE_MS = 8640000000000000;
const MAX_ROW_BYTES = 1_500_000;
const MAX_RESPONSE_BYTES = 16_000_000;
type Setting = { enabled: boolean; revision: number; accountEpoch: number };
type Cursor = { id: string; createdAt: string; proof: string };
type PreferenceRow = { live: number; role: string | null; enabled: number; revision: number; accountEpoch: number };
type ListRow = PreferenceRow & {
  fits: number; hasMore: number; id: string | null; invitationRevision: number;
  createdAtMs: number; expiresAtMs: number; missionId: string; missionTitle: string;
  spaceId: string; spaceName: string; senderId: string; senderName: string | null;
  senderImage: string | null; full: number;
};

function database() {
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is unavailable.');
  return env.DB.withSession('first-primary');
}
function requireLiveUser(row: PreferenceRow | undefined) {
  if (!row?.live) throw new SpaceApiError('Nicht authentifiziert', 401);
  if (row.role !== 'USER') throw invitationUnavailable();
  if ((row.enabled !== 0 && row.enabled !== 1) || !validVersion(row.revision) || !validVersion(row.accountEpoch)) {
    throw new Error('Invalid D1 invitation setting');
  }
  return { enabled: row.enabled === 1, revision: row.revision, accountEpoch: row.accountEpoch };
}
function validVersion(value: number) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_VERSION;
}
function milliseconds(column: string) {
  return `(CASE WHEN typeof(${column}) IN ('integer', 'real') THEN CAST(${column} AS INTEGER)
    ELSE CAST(ROUND((julianday(${column}) - 2440587.5) * 86400000) AS INTEGER) END)`;
}
function bytes(...columns: string[]) {
  return columns.map(column => `COALESCE(length(CAST(${column} AS BLOB)), 0)`).join(' + ');
}

/** A missing setting is a read-only default. Identity and setting are from one
 * primary snapshot; GET never materializes settings or access fences. */
export async function readD1InvitationPreference(userId: string): Promise<MissionInvitationPreference> {
  const result = await database().prepare(`
    SELECT EXISTS (SELECT 1 FROM "User" WHERE "id" = ?1) AS live,
      u."role", COALESCE(s."enabled", 0) AS enabled, COALESCE(s."revision", 0) AS revision,
      COALESCE(s."accountEpoch", 0) AS accountEpoch
    FROM (SELECT 1) singleton LEFT JOIN "User" u ON u."id" = ?1
    LEFT JOIN "SpaceMissionInvitationSetting" s ON s."userId" = u."id"
  `).bind(userId).all<PreferenceRow>();
  const setting = requireLiveUser(result.results[0]);
  return { enabled: setting.enabled, revision: setting.revision };
}

function signingSecret() {
  const value = process.env.NEXTAUTH_SECRET;
  if (!value) throw new SpaceApiError('Einladungen sind vorübergehend nicht verfügbar', 503);
  return value;
}
function cursorProof(id: string, createdAt: string, userId: string, setting: Setting) {
  // Preserve the existing version, tuple order, encoding and configured key.
  return createHmac('sha256', signingSecret()).update(JSON.stringify(['own-mission-invitations/v1', userId,
    setting.accountEpoch, setting.revision, id, createdAt])).digest();
}
function readCursor(request: Request): Cursor | null {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => key !== 'cursor') || params.getAll('cursor').length > 1) {
    throw new SpaceApiError('Ungültige Einladungsdaten', 400);
  }
  const raw = params.get('cursor');
  if (raw === null) return null;
  try {
    if (!raw || raw.length > 700 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const encoded = Buffer.from(raw, 'base64url');
    if (encoded.toString('base64url') !== raw) throw new Error();
    const value = JSON.parse(encoded.toString());
    const keys = ['v', 'kind', 'id', 'createdAt', 'proof'];
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
        keys.some(key => !Object.hasOwn(value, key)) || value.v !== 1 || value.kind !== 'own-mission-invitations' ||
        typeof value.id !== 'string' || !SPACE_ID_RE.test(value.id) || typeof value.createdAt !== 'string' ||
        new Date(value.createdAt).toISOString() !== value.createdAt || typeof value.proof !== 'string' ||
        value.proof.length !== 43 || !/^[A-Za-z0-9_-]+$/.test(value.proof)) throw new Error();
    const proof = Buffer.from(value.proof, 'base64url');
    if (proof.length !== 32 || proof.toString('base64url') !== value.proof) throw new Error();
    return { id: value.id, createdAt: value.createdAt, proof: value.proof };
  } catch { throw new SpaceApiError('Ungültiger Cursor', 400); }
}

// All effective-pending predicates are evaluated BEFORE keyset ordering and
// LIMIT 21. Full capacity only changes canAccept; it never hides a valid row.
// No private peer setting/access tuple is selected for transport.
const listSql = `WITH
  clock AS (SELECT CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER) AS nowMs),
  viewer AS (
    SELECT u."id", u."role", COALESCE(s."enabled", 0) AS enabled,
      COALESCE(s."revision", 0) AS revision, COALESCE(s."accountEpoch", 0) AS accountEpoch
    FROM "User" u LEFT JOIN "SpaceMissionInvitationSetting" s ON s."userId" = u."id" WHERE u."id" = ?1
  ), effective AS (
    SELECT i."id", i."revision", i."missionId", m."spaceId", i."senderId",
      ${milliseconds('i."createdAt"')} AS createdAtMs, ${milliseconds('i."expiresAt"')} AS expiresAtMs
    FROM "SpaceMissionInvitation" i
    JOIN viewer v ON v."id" = i."recipientId" AND v."role" = 'USER' AND v.enabled = 1
    JOIN "SpaceMission" m ON m."id" = i."missionId" AND m."closedAt" IS NULL
    JOIN "Space" space ON space."id" = m."spaceId" AND space."visibility" = 'PRIVATE'
    JOIN "User" sender ON sender."id" = i."senderId" AND sender."role" = 'USER'
    LEFT JOIN "SpaceMissionInvitationSetting" senderSetting ON senderSetting."userId" = sender."id"
    LEFT JOIN "SpaceMissionInvitationAccess" senderAccess ON senderAccess."missionId" = m."id" AND senderAccess."userId" = sender."id"
    LEFT JOIN "SpaceMissionInvitationAccess" recipientAccess ON recipientAccess."missionId" = m."id" AND recipientAccess."userId" = v."id"
    JOIN "SpaceMissionParticipation" senderConsent ON senderConsent."missionId" = m."id" AND senderConsent."userId" = sender."id"
    LEFT JOIN "SpaceMissionParticipation" recipientConsent ON recipientConsent."missionId" = m."id" AND recipientConsent."userId" = v."id"
    CROSS JOIN clock
    WHERE ?2 = 1 AND i."state" = 'PENDING' AND i."createdAt" IS NOT NULL AND i."expiresAt" IS NOT NULL
      AND ${milliseconds('i."createdAt"')} BETWEEN -${MAX_DATE_MS} AND ${MAX_DATE_MS}
      AND ${milliseconds('i."expiresAt"')} BETWEEN -${MAX_DATE_MS} AND ${MAX_DATE_MS}
      AND ${milliseconds('i."expiresAt"')} > clock.nowMs
      AND typeof(i."revision") = 'integer' AND i."revision" BETWEEN 1 AND ${MAX_VERSION}
      AND EXISTS (SELECT 1 FROM "SpaceMember" member WHERE member."spaceId" = space."id" AND member."userId" = sender."id")
      AND EXISTS (SELECT 1 FROM "SpaceMember" member WHERE member."spaceId" = space."id" AND member."userId" = v."id")
      AND v.revision = i."recipientSettingRevision" AND v.accountEpoch = i."recipientAccountEpoch"
      AND COALESCE(senderSetting."accountEpoch", 0) = i."senderAccountEpoch"
      AND COALESCE(senderAccess."epoch", 0) = i."senderAccessEpoch"
      AND COALESCE(recipientAccess."epoch", 0) = i."recipientAccessEpoch"
      AND senderConsent."optedOutAt" IS NULL AND senderConsent."epoch" = i."senderEpoch"
      AND (recipientConsent."userId" IS NULL OR recipientConsent."optedOutAt" IS NOT NULL)
      AND COALESCE(recipientConsent."epoch", 0) = i."recipientEpoch"
  ), selected AS (
    SELECT * FROM effective WHERE ?3 = 0 OR createdAtMs < ?4 OR (createdAtMs = ?4 AND "id" < ?5)
    ORDER BY createdAtMs DESC, "id" DESC LIMIT ${PAGE_SIZE + 1}
  ), page AS (
    SELECT * FROM selected ORDER BY createdAtMs DESC, "id" DESC LIMIT ${PAGE_SIZE}
  ), projection AS (
    SELECT p.*, m."title" AS missionTitle, s."name" AS spaceName, sender."name" AS senderName, sender."image" AS senderImage,
      (SELECT COUNT(*) FROM "SpaceMissionParticipation" capacity WHERE capacity."missionId" = p."missionId" AND capacity."optedOutAt" IS NULL) >= 5 AS full,
      ${bytes('p."id"', 'p."missionId"', 'p."spaceId"', 'p."senderId"', 'm."title"', 's."name"', 'sender."name"', 'sender."image"')} AS rowBytes
    FROM page p JOIN "SpaceMission" m ON m."id" = p."missionId" JOIN "Space" s ON s."id" = p."spaceId"
    JOIN "User" sender ON sender."id" = p."senderId"
  ), budget AS (
    SELECT (COALESCE(MAX(rowBytes), 0) <= ${MAX_ROW_BYTES}
      AND COALESCE(SUM(6 * rowBytes + 4096), 0) <= ${MAX_RESPONSE_BYTES}) AS fits FROM projection
  )
  SELECT EXISTS (SELECT 1 FROM viewer) AS live, (SELECT "role" FROM viewer) AS role,
    COALESCE((SELECT enabled FROM viewer), 0) AS enabled, COALESCE((SELECT revision FROM viewer), 0) AS revision,
    COALESCE((SELECT accountEpoch FROM viewer), 0) AS accountEpoch, budget.fits,
    (SELECT COUNT(*) FROM selected) > ${PAGE_SIZE} AS hasMore, p."id", p."revision" AS invitationRevision,
    p.createdAtMs, p.expiresAtMs, p."missionId", p.missionTitle, p."spaceId", p.spaceName,
    p."senderId", p.senderName, p.senderImage, p.full
  FROM budget LEFT JOIN projection p ON budget.fits = 1 ORDER BY p.createdAtMs DESC, p."id" DESC`;

/** The own setting used for cursor validation comes from the SAME protected
 * primary SELECT as the page. Parsing errors are deferred until live identity
 * is rechecked, preserving the existing 401/404 precedence. */
export async function listD1MissionInvitations(userId: string, request: Request): Promise<MissionInvitationList> {
  let cursor: Cursor | null = null;
  let cursorError: unknown;
  try { cursor = readCursor(request); } catch (error) { cursorError = error; }
  const result = await database().prepare(listSql).bind(userId, cursorError ? 0 : 1, cursor ? 1 : 0,
    cursor ? new Date(cursor.createdAt).getTime() : 0, cursor?.id ?? '').all<ListRow>();
  const context = result.results[0];
  const setting = requireLiveUser(context);
  if (cursorError) throw cursorError;
  if (cursor && !timingSafeEqual(Buffer.from(cursor.proof, 'base64url'), cursorProof(cursor.id, cursor.createdAt, userId, setting))) {
    throw new SpaceApiError('Ungültiger Cursor', 400);
  }
  if (context.hasMore) signingSecret();
  if (!context.fits) throw new Error('D1 invitation projection exceeds safe byte limits');
  const rows = result.results.filter((row): row is ListRow & { id: string } => row.id !== null);
  const last = rows.at(-1);
  // No key is needed for a first page of at most 20 valid invitations. A
  // supplied cursor or a page needing a next cursor still fails closed at 503.
  const nextCursor = context.hasMore && last ? Buffer.from(JSON.stringify({ v: 1, kind: 'own-mission-invitations',
    id: last.id, createdAt: new Date(last.createdAtMs).toISOString(),
    proof: cursorProof(last.id, new Date(last.createdAtMs).toISOString(), userId, setting).toString('base64url'),
  })).toString('base64url') : null;
  return { items: rows.map(row => ({ id: row.id, revision: row.invitationRevision,
    createdAt: new Date(row.createdAtMs).toISOString(), expiresAt: new Date(row.expiresAtMs).toISOString(),
    mission: { id: row.missionId, title: row.missionTitle, space: { id: row.spaceId, name: row.spaceName } },
    sender: { id: row.senderId, name: row.senderName, image: row.senderImage },
    canAccept: row.full !== 1, unavailableReason: row.full === 1 ? 'FULL' : null,
  })), nextCursor };
}

// Detail and notice-target reads deliberately do not share the list's setting
// validation or cursor signing: closed/terminal detail and empty target results
// must remain available without either of those unrelated prerequisites.
type NativeInvitationDetail = import('@/types/space-mission-invitations').MissionInvitationDetail;
type NativeInvitationDetailRow = {
  live: unknown; isUser: unknown; scoped: unknown; closed: unknown; owned: unknown;
  ownState: unknown; pending: unknown; fits: unknown; id: unknown; invitationRevision: unknown;
  createdAtMs: unknown; expiresAtMs: unknown; missionId: unknown; missionTitle: unknown;
  spaceId: unknown; spaceName: unknown; senderId: unknown; senderName: unknown;
  senderImage: unknown; full: unknown;
};
type NativeInvitationTargetRow = { fits: unknown; id: unknown; missionId: unknown; spaceId: unknown };
const MAX_INVITATION_TARGETS = 50;
const MAX_INVITATION_TARGET_ID_BYTES = 100;
const MAX_INVITATION_TARGET_ROW_BYTES = 3 * MAX_INVITATION_TARGET_ID_BYTES;
const MAX_INVITATION_TARGET_JSON_BYTES = 1 + MAX_INVITATION_TARGETS * (MAX_INVITATION_TARGET_ID_BYTES + 3);

function nativeInvitationProjectionFailure(): never {
  throw new Error('Invalid native invitation projection');
}
function nativeInvitationFlag(value: unknown): boolean {
  if (value !== 0 && value !== 1) return nativeInvitationProjectionFailure();
  return value === 1;
}
function nativeInvitationId(value: unknown): string {
  if (typeof value !== 'string' || !SPACE_ID_RE.test(value)) return nativeInvitationProjectionFailure();
  return value;
}
function nativeInvitationBoundId(value: string): string {
  // Invalid inputs are nonmatching, rather than an early error that could
  // override live-account, scoped-mission or closed-mission precedence.
  return typeof value === 'string' && SPACE_ID_RE.test(value) ? value : '';
}
function nativeInvitationRevision(value: unknown): number {
  if (typeof value !== 'number' || !validVersion(value) || value < 1) return nativeInvitationProjectionFailure();
  return value;
}
function nativeInvitationDate(value: unknown): string {
  if (typeof value !== 'number' || !Number.isInteger(value) || Math.abs(value) > MAX_DATE_MS) {
    return nativeInvitationProjectionFailure();
  }
  return new Date(value).toISOString();
}
function nativeInvitationText(value: unknown): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_ROW_BYTES) return nativeInvitationProjectionFailure();
  return value;
}
function nativeInvitationNullableText(value: unknown): string | null {
  return value === null ? null : nativeInvitationText(value);
}
function nativeInvitationResponse<T>(value: T): T {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_RESPONSE_BYTES) return nativeInvitationProjectionFailure();
  return value;
}
function nativeInvitationSqlId(column: string): string {
  return `(typeof(${column}) = 'text' AND length(CAST(${column} AS BLOB)) BETWEEN 1 AND ${MAX_INVITATION_TARGET_ID_BYTES}
    AND ${column} NOT GLOB '*[^A-Za-z0-9_-]*')`;
}

// Static fragments only. Both readers use precisely the same current-consent
// predicate, without projecting any account, setting, access or consent tuple.
// The sender's enabled/revision are intentionally irrelevant; only its current
// account epoch participates. Capacity is intentionally absent from this gate.
const nativeInvitationPendingJoinsSql = `
    JOIN viewer v ON v."id" = i."recipientId" AND v."role" = 'USER'
    JOIN "SpaceMission" m ON m."id" = i."missionId" AND m."closedAt" IS NULL
    JOIN "Space" space ON space."id" = m."spaceId" AND space."visibility" = 'PRIVATE'
    JOIN "User" sender ON sender."id" = i."senderId" AND sender."role" = 'USER'
    JOIN "SpaceMissionInvitationSetting" recipientSetting ON recipientSetting."userId" = v."id" AND recipientSetting."enabled" = 1
    LEFT JOIN "SpaceMissionInvitationSetting" senderSetting ON senderSetting."userId" = sender."id"
    LEFT JOIN "SpaceMissionInvitationAccess" senderAccess ON senderAccess."missionId" = m."id" AND senderAccess."userId" = sender."id"
    LEFT JOIN "SpaceMissionInvitationAccess" recipientAccess ON recipientAccess."missionId" = m."id" AND recipientAccess."userId" = v."id"
    JOIN "SpaceMissionParticipation" senderConsent ON senderConsent."missionId" = m."id" AND senderConsent."userId" = sender."id"
    LEFT JOIN "SpaceMissionParticipation" recipientConsent ON recipientConsent."missionId" = m."id" AND recipientConsent."userId" = v."id"
    CROSS JOIN clock`;
const nativeInvitationPendingWhereSql = `
    i."state" = 'PENDING' AND i."createdAt" IS NOT NULL AND i."expiresAt" IS NOT NULL AND i."senderId" <> ''
    AND typeof(i."createdAt") IN ('integer', 'real', 'text') AND typeof(i."expiresAt") IN ('integer', 'real', 'text')
    AND instr(CAST(i."createdAt" AS BLOB), x'00') = 0 AND instr(CAST(i."expiresAt" AS BLOB), x'00') = 0
    AND ${milliseconds('i."createdAt"')} BETWEEN -${MAX_DATE_MS} AND ${MAX_DATE_MS}
    AND ${milliseconds('i."expiresAt"')} BETWEEN -${MAX_DATE_MS} AND ${MAX_DATE_MS}
    AND ${milliseconds('i."expiresAt"')} > clock.nowMs
    AND typeof(i."revision") = 'integer' AND i."revision" BETWEEN 1 AND ${MAX_VERSION}
    AND typeof(recipientSetting."revision") = 'integer' AND recipientSetting."revision" BETWEEN 0 AND ${MAX_VERSION}
    AND typeof(recipientSetting."accountEpoch") = 'integer' AND recipientSetting."accountEpoch" BETWEEN 0 AND ${MAX_VERSION}
    AND EXISTS (SELECT 1 FROM "SpaceMember" member WHERE member."spaceId" = space."id" AND member."userId" = sender."id")
    AND EXISTS (SELECT 1 FROM "SpaceMember" member WHERE member."spaceId" = space."id" AND member."userId" = v."id")
    AND recipientSetting."revision" = i."recipientSettingRevision" AND recipientSetting."accountEpoch" = i."recipientAccountEpoch"
    AND COALESCE(senderSetting."accountEpoch", 0) = i."senderAccountEpoch"
    AND COALESCE(senderAccess."epoch", 0) = i."senderAccessEpoch"
    AND COALESCE(recipientAccess."epoch", 0) = i."recipientAccessEpoch"
    AND senderConsent."optedOutAt" IS NULL AND senderConsent."epoch" = i."senderEpoch"
    AND (recipientConsent."userId" IS NULL OR recipientConsent."optedOutAt" IS NOT NULL)
    AND COALESCE(recipientConsent."epoch", 0) = i."recipientEpoch"`;

const nativeInvitationDetailSql = `WITH
  clock AS MATERIALIZED (SELECT CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER) AS nowMs),
  viewer AS MATERIALIZED (SELECT u."id", u."role" FROM "User" u WHERE u."id" = ?1),
  scope AS MATERIALIZED (
    SELECT m."id", m."spaceId", m."closedAt" IS NOT NULL AS closed
    FROM viewer v CROSS JOIN "SpaceMission" m JOIN "Space" space ON space."id" = m."spaceId"
    WHERE v."role" = 'USER' AND m."id" = ?3 AND m."spaceId" = ?2 AND space."visibility" = 'PRIVATE'
      AND EXISTS (SELECT 1 FROM "SpaceMember" member WHERE member."spaceId" = space."id" AND member."userId" = v."id")
  ), own AS MATERIALIZED (
    SELECT i."id", i."state", i."revision"
    FROM scope scoped CROSS JOIN "SpaceMissionInvitation" i
    WHERE scoped.closed = 0 AND i."id" = ?4 AND i."missionId" = scoped."id" AND i."recipientId" = ?1
  ), effective AS MATERIALIZED (
    SELECT i."id", i."revision", ${milliseconds('i."createdAt"')} AS createdAtMs,
      ${milliseconds('i."expiresAt"')} AS expiresAtMs, i."missionId", m."spaceId", i."senderId"
    FROM own owned CROSS JOIN "SpaceMissionInvitation" i ${nativeInvitationPendingJoinsSql}
    WHERE owned."state" = 'PENDING' AND i."id" = owned."id" AND ${nativeInvitationPendingWhereSql}
  ), pendingMetrics AS MATERIALIZED (
    SELECT ${bytes('e."id"', 'e."missionId"', 'e."spaceId"', 'e."senderId"', 'm."title"', 'space."name"', 'sender."name"', 'sender."image"')} AS rowBytes,
      (${nativeInvitationSqlId('e."id"')} AND ${nativeInvitationSqlId('e."missionId"')}
        AND ${nativeInvitationSqlId('e."spaceId"')} AND typeof(e."senderId") = 'text'
        AND typeof(m."title") = 'text' AND typeof(space."name") = 'text'
        AND typeof(sender."name") IN ('text', 'null') AND typeof(sender."image") IN ('text', 'null')) AS validTypes
    FROM effective e JOIN "SpaceMission" m ON m."id" = e."missionId"
    JOIN "Space" space ON space."id" = e."spaceId" JOIN "User" sender ON sender."id" = e."senderId"
  ), pendingBudget AS MATERIALIZED (
    SELECT (COALESCE(MIN(validTypes), 1) = 1 AND COUNT(*) <= 1
      AND COALESCE(MAX(rowBytes), 0) <= ${MAX_ROW_BYTES}
      AND COALESCE(SUM(6 * rowBytes + 4096), 0) <= ${MAX_RESPONSE_BYTES}) AS fits FROM pendingMetrics
  ), budget AS MATERIALIZED (
    SELECT CASE WHEN owned."state" IN ('ACCEPTED', 'DECLINED') THEN
      (${nativeInvitationSqlId('owned."id"')} AND typeof(owned."revision") = 'integer'
        AND owned."revision" BETWEEN 1 AND ${MAX_VERSION}
        AND 6 * ${bytes('owned."id"')} + 4096 <= ${MAX_RESPONSE_BYTES})
      ELSE pendingBudget.fits END AS fits
    FROM pendingBudget LEFT JOIN own owned ON 1 = 1
  ), pendingProjection AS MATERIALIZED (
    SELECT e.*, m."title" AS missionTitle, space."name" AS spaceName, sender."name" AS senderName, sender."image" AS senderImage,
      (SELECT COUNT(*) FROM "SpaceMissionParticipation" capacity WHERE capacity."missionId" = e."missionId" AND capacity."optedOutAt" IS NULL) >= 5 AS full
    FROM budget bounds CROSS JOIN effective e JOIN "SpaceMission" m ON m."id" = e."missionId"
    JOIN "Space" space ON space."id" = e."spaceId" JOIN "User" sender ON sender."id" = e."senderId"
    WHERE bounds.fits = 1
  )
  SELECT EXISTS (SELECT 1 FROM viewer) AS live, EXISTS (SELECT 1 FROM viewer WHERE "role" = 'USER') AS isUser,
    EXISTS (SELECT 1 FROM scope) AS scoped, COALESCE((SELECT closed FROM scope), 0) AS closed,
    EXISTS (SELECT 1 FROM own) AS owned,
    COALESCE((SELECT CASE "state" WHEN 'PENDING' THEN 1 WHEN 'ACCEPTED' THEN 2 WHEN 'DECLINED' THEN 3 ELSE 0 END FROM own), 0) AS ownState,
    EXISTS (SELECT 1 FROM effective) AS pending, budget.fits,
    CASE WHEN owned."state" IN ('ACCEPTED', 'DECLINED') AND budget.fits = 1 THEN owned."id" ELSE p."id" END AS id,
    CASE WHEN owned."state" IN ('ACCEPTED', 'DECLINED') AND budget.fits = 1 THEN owned."revision" ELSE p."revision" END AS invitationRevision,
    p.createdAtMs, p.expiresAtMs, p."missionId", p.missionTitle, p."spaceId", p.spaceName, p."senderId", p.senderName, p.senderImage, p.full
  FROM budget LEFT JOIN own owned ON 1 = 1 LEFT JOIN pendingProjection p ON budget.fits = 1`;

/** One primary snapshot. Closed scope suppresses even the own-ID lookup; a
 * terminal own row never reaches pending settings, timestamps or profiles. */
export async function readD1MissionInvitation(spaceId: string, missionId: string, invitationId: string,
  userId: string): Promise<NativeInvitationDetail> {
  const result = await database().prepare(nativeInvitationDetailSql).bind(userId,
    nativeInvitationBoundId(spaceId), nativeInvitationBoundId(missionId), nativeInvitationBoundId(invitationId)).all<NativeInvitationDetailRow>();
  if (result.success !== true || !Array.isArray(result.results) || result.results.length !== 1) return nativeInvitationProjectionFailure();
  const row = result.results[0];
  if (!nativeInvitationFlag(row.live)) throw new SpaceApiError('Nicht authentifiziert', 401);
  if (!nativeInvitationFlag(row.isUser) || !nativeInvitationFlag(row.scoped)) throw invitationUnavailable();
  if (nativeInvitationFlag(row.closed)) return { state: 'UNAVAILABLE', invitation: null };
  if (!nativeInvitationFlag(row.owned)) throw invitationUnavailable();
  if (row.ownState === 2 || row.ownState === 3) {
    if (!nativeInvitationFlag(row.fits)) return nativeInvitationProjectionFailure();
    const state = row.ownState === 2 ? 'ACCEPTED' : 'DECLINED';
    return nativeInvitationResponse<NativeInvitationDetail>({ state, invitation: { id: nativeInvitationId(row.id), state,
      revision: nativeInvitationRevision(row.invitationRevision) } });
  }
  if (row.ownState !== 0 && row.ownState !== 1) return nativeInvitationProjectionFailure();
  if (row.ownState === 0 || !nativeInvitationFlag(row.pending)) return { state: 'UNAVAILABLE', invitation: null };
  if (!nativeInvitationFlag(row.fits)) return nativeInvitationProjectionFailure();
  const full = nativeInvitationFlag(row.full);
  return nativeInvitationResponse<NativeInvitationDetail>({ state: 'PENDING', invitation: {
    id: nativeInvitationId(row.id), revision: nativeInvitationRevision(row.invitationRevision),
    createdAt: nativeInvitationDate(row.createdAtMs), expiresAt: nativeInvitationDate(row.expiresAtMs),
    mission: { id: nativeInvitationId(row.missionId), title: nativeInvitationText(row.missionTitle),
      space: { id: nativeInvitationId(row.spaceId), name: nativeInvitationText(row.spaceName) } },
    sender: { id: nativeInvitationText(row.senderId), name: nativeInvitationNullableText(row.senderName), image: nativeInvitationNullableText(row.senderImage) },
    canAccept: !full, unavailableReason: full ? 'FULL' : null,
  } });
}

const nativeInvitationTargetsSql = `WITH
  clock AS MATERIALIZED (SELECT CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER) AS nowMs),
  viewer AS MATERIALIZED (SELECT u."id", u."role" FROM "User" u WHERE u."id" = ?1),
  requested AS MATERIALIZED (SELECT value AS id FROM json_each(?2) WHERE type = 'text'),
  effective AS MATERIALIZED (
    SELECT i."id", i."missionId", m."spaceId"
    FROM requested request CROSS JOIN "SpaceMissionInvitation" i ${nativeInvitationPendingJoinsSql}
    WHERE i."id" = request.id AND ${nativeInvitationPendingWhereSql}
  ), metrics AS MATERIALIZED (
    SELECT ${bytes('e."id"', 'e."missionId"', 'e."spaceId"')} AS rowBytes,
      (${nativeInvitationSqlId('e."id"')} AND ${nativeInvitationSqlId('e."missionId"')}
        AND ${nativeInvitationSqlId('e."spaceId"')}) AS validTypes FROM effective e
  ), budget AS MATERIALIZED (
    SELECT (COALESCE(MIN(validTypes), 1) = 1 AND COUNT(*) <= ${MAX_INVITATION_TARGETS}
      AND COALESCE(MAX(rowBytes), 0) <= ${MAX_INVITATION_TARGET_ROW_BYTES}
      AND COALESCE(SUM(6 * rowBytes + 4096), 0) <= ${MAX_RESPONSE_BYTES}) AS fits FROM metrics
  )
  SELECT budget.fits, e."id", e."missionId", e."spaceId"
  FROM budget LEFT JOIN effective e ON budget.fits = 1 ORDER BY e."id"`;

/** Raw read-only resolver. The facade owns the original pre-deduplication
 * length check and the private-error logging/sanitization boundary. No profile,
 * title, capacity query, signing requirement or write participates here. */
export async function resolveD1MissionInvitationTargets(ids: string[], userId: string): Promise<Map<string, { href: string; label: string }>> {
  if (ids.length > MAX_INVITATION_TARGETS) throw new SpaceApiError('Zu viele Benachrichtigungen', 400);
  const requested = [...new Set(ids.filter(id => typeof id === 'string' && SPACE_ID_RE.test(id)))];
  if (!requested.length) return new Map();
  const encoded = JSON.stringify(requested);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_INVITATION_TARGET_JSON_BYTES) return nativeInvitationProjectionFailure();
  const result = await database().prepare(nativeInvitationTargetsSql).bind(userId, encoded).all<NativeInvitationTargetRow>();
  if (result.success !== true || !Array.isArray(result.results) || !result.results.length || result.results.length > requested.length) {
    return nativeInvitationProjectionFailure();
  }
  if (result.results.some(row => !nativeInvitationFlag(row.fits))) return nativeInvitationProjectionFailure();
  if (result.results[0].id === null) {
    if (result.results.length !== 1 || result.results[0].missionId !== null || result.results[0].spaceId !== null) {
      return nativeInvitationProjectionFailure();
    }
    return new Map();
  }
  const requestedSet = new Set(requested);
  const targets = new Map<string, { href: string; label: string }>();
  for (const row of result.results) {
    const id = nativeInvitationId(row.id);
    const missionId = nativeInvitationId(row.missionId);
    const spaceId = nativeInvitationId(row.spaceId);
    if (!requestedSet.has(id) || targets.has(id)) return nativeInvitationProjectionFailure();
    targets.set(id, {
      href: `/community/spaces/${encodeURIComponent(spaceId)}/missions/${encodeURIComponent(missionId)}?invitation=${encodeURIComponent(id)}#mission-invitation`,
      label: 'Einladung ansehen',
    });
  }
  nativeInvitationResponse([...targets]);
  return targets;
}
