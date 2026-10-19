import 'server-only';

import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getDatabaseProvider, getPostgresqlSchema } from '@/lib/database-provider';
import { isRewardHistoryEntry, type RewardHistoryEntry } from '@/lib/rewards';

function table(name: 'RewardLedger' | 'RewardLedgerChange') {
  // Fixed table names; PrismaPg's schema option does not qualify raw queries.
  const schema = getDatabaseProvider() === 'postgresql' ? getPostgresqlSchema() : null;
  return Prisma.raw(`${schema ? `"${schema.replaceAll('"', '""')}".` : ''}"${name}"`);
}

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

/** Event identity and eligibility belong to the SAME bounded SQL snapshot. */
export async function readPrivateRewardHistory(userId: string): Promise<RewardHistoryEntry[]> {
  const rows = await prisma.$queryRaw<HistoryRow[]>(Prisma.sql`
    SELECT h."id", h."ledgerId", h."version", CAST(h."type" AS TEXT) AS "type",
      CAST(h."reason" AS TEXT) AS "reason", h."pointsDelta", h."createdAt" AS "at", r."courseTitle",
      CASE WHEN r."eventType" = 'COURSE_COMPLETED' AND h."type" = 'AWARDED' AND h."reason" IS NULL
        AND h."pointsDelta" = 50 AND r."points" = 50 AND h."version" = 1
        AND r."stateVersion" = h."version" AND r."revokedAt" IS NULL THEN 1 ELSE 0 END AS "activeAward"
    FROM ${table('RewardLedgerChange')} h JOIN ${table('RewardLedger')} r ON r."id" = h."ledgerId"
    WHERE r."userId" = ${userId}
    ORDER BY h."createdAt" DESC, h."version" DESC, h."id" DESC LIMIT 10`);
  return projectHistory(rows);
}
