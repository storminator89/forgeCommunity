import 'server-only';

import { env } from 'cloudflare:workers';
import type { Role } from '@/generated/prisma/client';
import type { privatePathwayViews } from '@/lib/server/learning-pathways';

type StoredDate = string | number;

// D1 may contain ISO timestamps from the adapter and SQLite CURRENT_TIMESTAMP
// defaults. Legacy imported Prisma timestamps are epoch milliseconds.
function date(value: StoredDate): Date {
  const normalized = typeof value === 'string' && /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?$/.test(value)
    ? `${value.replace(' ', 'T')}Z` : value;
  const result = new Date(normalized);
  if (!Number.isFinite(result.getTime())) throw new Error('Invalid D1 overview timestamp');
  return result;
}

function database() {
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is unavailable.');
  // These privacy-sensitive reads must start at the primary, including when
  // read replication is enabled. Each projection below is one SQL statement.
  return env.DB.withSession('first-primary');
}

export type D1OverviewCursor = {
  createdAt: Date; id: string; role: string; accessEpoch: number;
};

type MissionOverviewRow = {
  viewerId: string; viewerRole: Role; accessEpoch: number;
  id: string | null; title: string; spaceId: string; spaceName: string;
  createdAtMs: number; weekStartsOn: string | null; weekTimezone: string | null;
  weekStartsAt: StoredDate | null; weekEndsAt: StoredDate | null;
  saved: number; revision: number; participationActive: number;
};

/** Authorization and private rows are deliberately inseparable. An invitation
 * is never membership, and even admins need current PRIVATE membership here.
 * The LEFT JOIN retains live identity when the authorized page is empty. */
export async function d1MissionOverview(userId: string, view: 'all' | 'saved', cursor: D1OverviewCursor | null, limit: number) {
  const result = await database().prepare(`
    WITH viewer AS (
      SELECT u."id", u."role", COALESCE(a."epoch", 0) AS "accessEpoch"
      FROM "User" u LEFT JOIN "SpaceMissionBookmarkAccess" a ON a."userId" = u."id"
      WHERE u."id" = ?1
    ), authorized AS (
      SELECT m."id", m."title", s."id" AS "spaceId", s."name" AS "spaceName",
        CASE WHEN typeof(m."createdAt") IN ('integer', 'real') THEN m."createdAt"
          ELSE ROUND((julianday(m."createdAt") - 2440587.5) * 86400000) END AS "createdAtMs",
        m."weekStartsOn", m."weekTimezone", m."weekStartsAt", m."weekEndsAt",
        b."savedAt" IS NOT NULL AS "saved", COALESCE(b."revision", 0) AS "revision",
        (v."role" = 'USER' AND EXISTS (SELECT 1 FROM "SpaceMissionParticipation" p
          WHERE p."missionId" = m."id" AND p."userId" = v."id" AND p."optedOutAt" IS NULL)) AS "participationActive"
      FROM viewer v JOIN "SpaceMember" member ON member."userId" = v."id"
      JOIN "Space" s ON s."id" = member."spaceId" AND s."visibility" = 'PRIVATE'
      JOIN "SpaceMission" m ON m."spaceId" = s."id" AND m."closedAt" IS NULL
      LEFT JOIN "SpaceMissionBookmarkSetting" b ON b."missionId" = m."id" AND b."userId" = v."id"
      WHERE (?2 = 'all' OR b."savedAt" IS NOT NULL)
        AND (?3 = 0 OR (v."role" = ?4 AND v."accessEpoch" = ?5))
    ), page AS (
      SELECT * FROM authorized
      WHERE ?3 = 0 OR "createdAtMs" < ?6 OR ("createdAtMs" = ?6 AND "id" < ?7)
      ORDER BY "createdAtMs" DESC, "id" DESC LIMIT ?8
    )
    SELECT v."id" AS "viewerId", v."role" AS "viewerRole", v."accessEpoch", page.*
    FROM viewer v LEFT JOIN page ON 1 = 1
    ORDER BY page."createdAtMs" DESC, page."id" DESC
  `).bind(userId, view, cursor ? 1 : 0, cursor?.role ?? '', cursor?.accessEpoch ?? 0,
    cursor?.createdAt.getTime() ?? 0, cursor?.id ?? '', limit).all<MissionOverviewRow>();
  const first = result.results[0];
  if (!first) return null;
  return {
    viewer: { id: first.viewerId, role: first.viewerRole, accessEpoch: first.accessEpoch },
    rows: result.results.flatMap(row => row.id === null ? [] : [{
      id: row.id, title: row.title, space: { id: row.spaceId, name: row.spaceName },
      createdAt: date(row.createdAtMs), weekStartsOn: row.weekStartsOn, weekTimezone: row.weekTimezone,
      weekStartsAt: row.weekStartsAt === null ? null : date(row.weekStartsAt),
      weekEndsAt: row.weekEndsAt === null ? null : date(row.weekEndsAt),
      saved: Boolean(row.saved), revision: row.revision, participationActive: Boolean(row.participationActive),
    }]),
  };
}

type PathwayView = Awaited<ReturnType<typeof privatePathwayViews>>[number];
type PathwayRow = {
  eligible: number; id: string | null; title: string; description: string; badgeLabel: string;
  participatingUserId: string | null; joinedAt: StoredDate; optedOutAt: StoredDate | null;
  badgeActive: number; badgeFirstAwardedAt: StoredDate | null;
  courseId: string | null; courseTitle: string; position: number; available: number; isEnrolled: number; creditActive: number;
  history: string;
};

/** Single-statement equivalent of privatePathwayViews. Account eligibility,
 * publication availability, own participation/history, enrollment and live
 * unrevoked rewards are all read from the same current database snapshot. */
export async function d1PrivatePathwayViews(userId: string): Promise<PathwayView[] | null> {
  const result = await database().prepare(`
    WITH viewer AS (
      SELECT "id", ("role" = 'USER' AND "isTestAccount" = 0) AS eligible FROM "User" WHERE "id" = ?1
    )
    SELECT v.eligible, p."id", p."title", p."description", p."badgeLabel",
      participation."userId" AS "participatingUserId", participation."joinedAt", participation."optedOutAt",
      participation."badgeActive", participation."badgeFirstAwardedAt",
      pc."courseId", pc."title" AS "courseTitle", pc."position",
      (c."activePublicationId" IS NOT NULL) AS available,
      EXISTS (SELECT 1 FROM "Enrollment" e WHERE e."userId" = v."id" AND e."courseId" = pc."courseId") AS "isEnrolled",
      (participation."userId" IS NOT NULL AND participation."optedOutAt" IS NULL AND EXISTS (
        SELECT 1 FROM "RewardLedger" r WHERE r."userId" = v."id" AND r."eventType" = 'COURSE_COMPLETED'
          AND r."sourceId" = pc."courseId" AND r."revokedAt" IS NULL)) AS "creditActive",
      (SELECT json_group_array(json_object('type', recent."type", 'reason', recent."reason", 'at', recent."createdAt"))
        FROM (SELECT change."type", change."reason", change."createdAt" FROM "LearningPathwayChange" change
          WHERE change."userId" = participation."userId" AND change."pathwayId" = p."id"
          ORDER BY change."version" DESC LIMIT 20) recent) AS history
    FROM viewer v
    LEFT JOIN "LearningPathway" p ON v.eligible = 1 AND p."sealedAt" IS NOT NULL AND (
      EXISTS (SELECT 1 FROM "LearningPathwayParticipation" own WHERE own."userId" = v."id" AND own."pathwayId" = p."id")
      OR NOT EXISTS (SELECT 1 FROM "LearningPathwayCourse" unavailable
        LEFT JOIN "Course" live ON live."id" = unavailable."courseId"
        WHERE unavailable."pathwayId" = p."id" AND live."activePublicationId" IS NULL))
    LEFT JOIN "LearningPathwayParticipation" participation ON participation."pathwayId" = p."id" AND participation."userId" = v."id"
    LEFT JOIN "LearningPathwayCourse" pc ON pc."pathwayId" = p."id"
    LEFT JOIN "Course" c ON c."id" = pc."courseId"
    ORDER BY p."createdAt" DESC, p."id" DESC, pc."position" ASC
  `).bind(userId).all<PathwayRow>();
  if (!result.results[0]?.eligible) return null;
  const pathways = new Map<string, PathwayView>();
  for (const row of result.results) {
    if (row.id === null) continue;
    let pathway = pathways.get(row.id);
    if (!pathway) {
      const history = JSON.parse(row.history) as { type: string; reason: string | null; at: StoredDate }[];
      pathway = {
        id: row.id, title: row.title, description: row.description, badgeLabel: row.badgeLabel,
        courses: [], unavailable: false, requiredCount: 0, creditedCount: 0,
        participation: row.participatingUserId === null ? null : {
          joinedAt: date(row.joinedAt), optedOutAt: row.optedOutAt === null ? null : date(row.optedOutAt),
          badgeActive: Boolean(row.badgeActive),
          badgeFirstAwardedAt: row.badgeFirstAwardedAt === null ? null : date(row.badgeFirstAwardedAt),
        },
        history: history.map(change => ({ type: change.type, reason: change.reason, at: date(change.at) })),
      };
      pathways.set(row.id, pathway);
    }
    if (row.courseId !== null) {
      pathway.courses.push({ courseId: row.courseId, title: row.courseTitle, order: row.position,
        available: Boolean(row.available), isEnrolled: Boolean(row.isEnrolled), creditActive: Boolean(row.creditActive) });
      pathway.requiredCount++;
      if (!row.available) pathway.unavailable = true;
      if (row.creditActive) pathway.creditedCount++;
    }
  }
  return [...pathways.values()];
}
