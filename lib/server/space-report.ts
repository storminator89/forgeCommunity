import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { NextResponse } from 'next/server';
import { readableSpaceWhere, resolveSpaceViewer } from '@/lib/server/space-access';
import { spaceErrorResponse, spaceTransaction, SpaceApiError } from '@/lib/server/space-api';
import { privateMissionAccess, visibleMissionContributions } from '@/lib/server/space-missions';

type SpaceTarget = 'SPACE_DISCUSSION' | 'SPACE_REPLY' | 'SPACE_MISSION_CONTRIBUTION';

/** Visibility is checked before duplicate lookup, including on retries. */
export async function createSpaceContentReport(input: {
  userId: string; targetType: SpaceTarget; targetId: string;
  reason: string; details: string | null; since: Date; softLimit: number;
}) {
  const { userId, targetType, targetId, reason, details, since, softLimit } = input;
  const key = { reporterId_targetType_targetId: { reporterId: userId, targetType, targetId } };

  const checkAndFindExisting = async (tx: Prisma.TransactionClient) => {
    const viewer = await resolveSpaceViewer(userId, tx);
    if (!viewer.userId) throw new SpaceApiError('Inhalt nicht gefunden', 404);
    const visible = readableSpaceWhere(viewer);
    const missionContribution = targetType === 'SPACE_MISSION_CONTRIBUTION'
      ? await tx.spaceMissionContribution.findFirst({ where: { id: targetId,
        mission: { space: { AND: [visible, { visibility: 'PRIVATE' }] } } },
        select: { authorId: true, missionId: true, mission: { select: { spaceId: true } } } }) : null;
    if (targetType === 'SPACE_MISSION_CONTRIBUTION') {
      if (!missionContribution) throw new SpaceApiError('Inhalt nicht gefunden', 404);
      await privateMissionAccess(missionContribution.mission.spaceId, userId, tx);
      if (!viewer.isAdmin && !(await visibleMissionContributions(missionContribution.mission.spaceId, missionContribution.missionId, tx)).some(row => row.id === targetId)) {
        throw new SpaceApiError('Inhalt nicht gefunden', 404);
      }
      if (missionContribution.authorId === userId) throw new SpaceApiError('Eigene Inhalte können nicht gemeldet werden', 400);
      const existing = await tx.contentReport.findUnique({ where: key, select: { id: true } });
      return { scopeSpaceId: missionContribution.mission.spaceId, existing };
    }
    const target = targetType === 'SPACE_DISCUSSION'
      ? await tx.spaceDiscussion.findFirst({ where: { id: targetId, space: visible,
          ...(viewer.isAdmin ? {} : { hiddenAt: null }) },
          select: { authorId: true, spaceId: true } })
      : await tx.spaceReply.findFirst({ where: { id: targetId,
          ...(viewer.isAdmin ? {} : { hiddenAt: null }),
          discussion: { space: visible, ...(viewer.isAdmin ? {} : { hiddenAt: null }) } },
          select: { authorId: true, discussion: { select: { spaceId: true } } } });
    if (!target) throw new SpaceApiError('Inhalt nicht gefunden', 404);
    const scopeSpaceId = 'spaceId' in target ? target.spaceId : target.discussion.spaceId;
    if (target.authorId === userId) throw new SpaceApiError('Eigene Inhalte können nicht gemeldet werden', 400);
    const existing = await tx.contentReport.findUnique({ where: key, select: { id: true } });
    return { scopeSpaceId, existing };
  };

  try {
    let result: { id: string; alreadyReported: boolean };
    try {
      result = await spaceTransaction(async tx => {
        const { scopeSpaceId, existing } = await checkAndFindExisting(tx);
        if (existing) return { id: existing.id, alreadyReported: true };
        const recentCount = await tx.contentReport.count({ where: { reporterId: userId, createdAt: { gte: since } } });
        if (recentCount >= softLimit) throw new SpaceApiError('Zu viele Meldungen. Bitte später erneut versuchen.', 429);
        const created = await tx.contentReport.create({ data: {
          reporterId: userId, targetType, targetId, scopeSpaceId, reason, details,
        }, select: { id: true } });
        return { id: created.id, alreadyReported: false };
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      result = await spaceTransaction(async tx => {
        const { existing } = await checkAndFindExisting(tx);
        if (!existing) throw error;
        return { id: existing.id, alreadyReported: true };
      });
    }
    return NextResponse.json(result, { status: result.alreadyReported ? 200 : 201,
      headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return spaceErrorResponse(error, 'Meldung konnte nicht gespeichert werden');
  }
}
