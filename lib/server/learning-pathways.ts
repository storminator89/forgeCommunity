import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { courseSqlTable } from '@/lib/server/course-sql-tables';
import { getDatabaseProvider } from '@/lib/database-provider';

export class LearningPathwayError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}
export class LearningPathwayConflictError extends LearningPathwayError {
  constructor() { super('Pathway changed concurrently; retry', 409); }
}

export async function lockPathwayCourses(tx: Prisma.TransactionClient, courseIds: string[]) {
  const ids = [...courseIds].sort();
  const table = courseSqlTable('Course');
  if (getDatabaseProvider() === 'sqlite') {
    // SQLite has no SELECT FOR UPDATE. Acquire its writer lock before checking
    // eligibility so course writes cannot commit between checking and sealing.
    const count = await tx.$executeRaw(Prisma.sql`UPDATE ${table} SET "title" = "title" WHERE "id" IN (${Prisma.join(ids)})`);
    if (count !== ids.length) throw new LearningPathwayError('A course is no longer available', 409);
  } else {
    // Prisma raw SQL needs the configured custom schema, supplied by
    // courseSqlTable. Stable ID order also limits PG deadlocks.
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM ${table}
      WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`);
    if (rows.length !== ids.length) throw new LearningPathwayError('A course is no longer available', 409);
  }
}

type ReadClient = Pick<Prisma.TransactionClient, 'learningPathway' | 'rewardLedger' | 'course' | 'enrollment'>;

/** This is a private projection. Historical completion records and client progress are never consulted. */
export async function privatePathwayViews(db: ReadClient, userId: string, onlyId?: string) {
  const pathways = await db.learningPathway.findMany({
    where: { sealedAt: { not: null }, ...(onlyId ? { id: onlyId } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: {
      courses: { orderBy: { position: 'asc' } },
      participants: { where: { userId }, include: { changes: { orderBy: { version: 'desc' }, take: 20 } } },
    },
  });
  const allCourseIds = [...new Set(pathways.flatMap(pathway => pathway.courses.map(course => course.courseId)))];
  const [liveCourses, activeRewards, enrollments] = await Promise.all([allCourseIds.length ? db.course.findMany({
    where: { id: { in: allCourseIds } }, select: { id: true, activePublicationId: true },
  }) : [], allCourseIds.length ? db.rewardLedger.findMany({
    where: { userId, eventType: 'COURSE_COMPLETED', sourceId: { in: allCourseIds }, revokedAt: null },
    select: { sourceId: true },
  }) : [], allCourseIds.length ? db.enrollment.findMany({
    where: { userId, courseId: { in: allCourseIds } }, select: { courseId: true },
  }) : []]);
  const available = new Set(liveCourses.filter(course => course.activePublicationId).map(course => course.id));
  const rewarded = new Set(activeRewards.map(reward => reward.sourceId));
  const enrolled = new Set(enrollments.map(enrollment => enrollment.courseId));
  return pathways.flatMap(pathway => {
    const participation = pathway.participants[0] ?? null;
    const unavailable = pathway.courses.some(course => !available.has(course.courseId));
    if (unavailable && !participation) return [];
    const participating = Boolean(participation && !participation.optedOutAt);
    const courses = pathway.courses.map(course => ({
      courseId: course.courseId, title: course.title, order: course.position,
      available: available.has(course.courseId), isEnrolled: enrolled.has(course.courseId),
      creditActive: participating && rewarded.has(course.courseId),
    }));
    return [{
      id: pathway.id, title: pathway.title, description: pathway.description, badgeLabel: pathway.badgeLabel,
      courses, unavailable, requiredCount: courses.length, creditedCount: courses.filter(course => course.creditActive).length,
      participation: participation ? {
        joinedAt: participation.joinedAt, optedOutAt: participation.optedOutAt,
        badgeActive: participation.badgeActive, badgeFirstAwardedAt: participation.badgeFirstAwardedAt,
      } : null,
      history: participation?.changes.map(change => ({ type: change.type, reason: change.reason, at: change.createdAt })) ?? [],
    }];
  });
}

/** Run inside the same serializable transaction that changes the course reward ledger. */
export async function reconcileUserPathways(tx: Prisma.TransactionClient, userId: string, courseId?: string) {
  const participations = await tx.learningPathwayParticipation.findMany({
    where: { userId, ...(courseId ? { pathway: { courses: { some: { courseId } } } } : {}) },
    include: { pathway: { include: { courses: { select: { courseId: true } } } } },
  });
  if (!participations.length) return;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, isTestAccount: true } });
  const eligibleUser = user?.role === 'USER' && !user.isTestAccount;
  const allCourseIds = [...new Set(participations.flatMap(row => row.pathway.courses.map(course => course.courseId)))];
  const activeRewards = eligibleUser && allCourseIds.length ? await tx.rewardLedger.findMany({
    where: { userId, eventType: 'COURSE_COMPLETED', sourceId: { in: allCourseIds }, revokedAt: null },
    select: { sourceId: true },
  }) : [];
  const rewarded = new Set(activeRewards.map(row => row.sourceId));
  for (const row of participations) {
    const qualifies = eligibleUser && !row.optedOutAt && row.pathway.courses.length >= 2 &&
      row.pathway.courses.every(course => rewarded.has(course.courseId));
    if (qualifies === row.badgeActive) continue;
    const now = new Date();
    const changed = await tx.learningPathwayParticipation.updateMany({
      where: { userId, pathwayId: row.pathwayId, stateVersion: row.stateVersion, badgeActive: row.badgeActive,
        optedOutAt: row.optedOutAt },
      data: { badgeActive: qualifies, stateVersion: { increment: 1 },
        ...(qualifies && !row.badgeFirstAwardedAt ? { badgeFirstAwardedAt: now } : {}),
      },
    });
    if (changed.count !== 1) throw new LearningPathwayConflictError();
    await tx.learningPathwayChange.create({ data: {
      userId, pathwayId: row.pathwayId, version: row.stateVersion + 1,
      type: qualifies ? row.badgeFirstAwardedAt ? 'REINSTATED' : 'AWARDED' : 'REVOKED',
      reason: qualifies ? null : !eligibleUser ? 'ACCOUNT_INELIGIBLE' : row.optedOutAt ? 'OPTED_OUT' : 'REWARD_INVALIDATED',
    } });
  }
}
