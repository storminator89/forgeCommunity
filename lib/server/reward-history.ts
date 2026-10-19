import 'server-only';

import { createHash } from 'node:crypto';
import { d1CourseDatabase } from '@/lib/server/d1-course-drafts';
import { isRewardHistoryEntry, type RewardHistoryEntry } from '@/lib/rewards';

type HistoryRow = {
  id: string; ledgerId: string; version: number | bigint
  type: string; reason: string | null; pointsDelta: number | bigint
  at: Date | string | number; courseTitle: string; activeAward: number | bigint
}

function projectHistory(rows: HistoryRow[]): RewardHistoryEntry[] {
  return rows.map(row => {
    const version = Number(row.version)
    const pointsDelta = Number(row.pointsDelta)
    const activeAward = Number(row.activeAward)
    const at = row.at instanceof Date ? row.at : new Date(row.at)
    if (typeof row.id !== 'string' || !row.id || typeof row.ledgerId !== 'string' || !row.ledgerId ||
      !Number.isSafeInteger(version) || version < 1 || !Number.isSafeInteger(pointsDelta) ||
      (activeAward !== 0 && activeAward !== 1) || !Number.isFinite(at.getTime())) throw new Error('Invalid reward history snapshot')
    const entry = {
      type: row.type, reason: row.reason, pointsDelta, at: at.toISOString(), courseTitle: row.courseTitle,
      eventKey: createHash('sha256').update(JSON.stringify(['forge-private-reward-event-v1', row.ledgerId, version, row.id])).digest('hex'),
      activeAward: activeAward === 1,
    }
    if (!isRewardHistoryEntry(entry)) throw new Error('Invalid private reward history')
    return entry
  })
}

/** One primary-session statement binds event identity to its current version. */
export async function readPrivateRewardHistory(userId: string): Promise<RewardHistoryEntry[]> {
  const result = await d1CourseDatabase().prepare(`
    SELECT h."id", h."ledgerId", h."version", CAST(h."type" AS TEXT) AS "type",
      CAST(h."reason" AS TEXT) AS "reason", h."pointsDelta", h."createdAt" AS "at", r."courseTitle",
      CASE WHEN r."eventType" = 'COURSE_COMPLETED' AND h."type" = 'AWARDED' AND h."reason" IS NULL
        AND h."pointsDelta" = 50 AND r."points" = 50 AND h."version" = 1
        AND r."stateVersion" = h."version" AND r."revokedAt" IS NULL THEN 1 ELSE 0 END AS "activeAward"
    FROM "RewardLedgerChange" h JOIN "RewardLedger" r ON r."id" = h."ledgerId"
    WHERE r."userId" = ?
    ORDER BY h."createdAt" DESC, h."version" DESC, h."id" DESC LIMIT 10`).bind(userId).all<HistoryRow>();
  if (!result.success) throw new Error('Private reward history unavailable');
  return projectHistory(result.results);
}
