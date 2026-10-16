export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { readJsonObject, readPage, requestErrorResponse } from '@/lib/server/api-input';
import { sanitizeHtmlPreviewServer, sanitizeTextServer } from '@/lib/server/sanitize-html';
import { isReportReason, isReportTargetType } from '@/lib/reporting';
import { createSpaceContentReport } from '@/lib/server/space-report';
import { spaceErrorResponse, spaceTransaction, SpaceApiError } from '@/lib/server/space-api';

// A best-effort abuse throttle, not a strict concurrent quota. The database
// unique key is the hard guarantee against repeat reports of one target.
const SOFT_REPORTS_PER_DAY = 5;

function hasModeratorRole(role: string | null | undefined) {
  return role === 'ADMIN' || role === 'MODERATOR';
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
    if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Ungültige Anfragequelle' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });

    const body = await readJsonObject(request, 2048);
    const { targetType, targetId, reason, details } = body;
    if (!isReportTargetType(targetType) || !isReportReason(reason) ||
        typeof targetId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(targetId) ||
        (details !== undefined && typeof details !== 'string')) {
      return NextResponse.json({ error: 'Ungültige Meldung' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } });
    }

    const safeDetails = typeof details === 'string' ? sanitizeTextServer(details) : '';
    if (safeDetails.length > 500 || (reason === 'OTHER' && safeDetails.length < 5)) {
      return NextResponse.json({ error: 'Bitte einen gültigen Hinweis eingeben (maximal 500 Zeichen)' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } });
    }

    if (targetType === 'SPACE_DISCUSSION' || targetType === 'SPACE_REPLY' || targetType === 'SPACE_MISSION_CONTRIBUTION') {
      return createSpaceContentReport({ userId, targetType, targetId, reason,
        details: safeDetails || null, since: new Date(Date.now() - 24 * 60 * 60 * 1000), softLimit: SOFT_REPORTS_PER_DAY });
    }

    const unique = { reporterId_targetType_targetId: { reporterId: userId, targetType, targetId } };
    const existing = await prisma.contentReport.findUnique({ where: unique, select: { id: true } });
    if (existing) return NextResponse.json({ id: existing.id, alreadyReported: true }, { headers: { 'Cache-Control': 'private, no-store' } });

    const target = targetType === 'POST'
      ? await prisma.post.findUnique({ where: { id: targetId }, select: { authorId: true, published: true } })
      : await prisma.comment.findUnique({ where: { id: targetId }, select: {
          authorId: true, post: { select: { published: true } },
        } });
    if (!target || (targetType === 'POST' ? !('published' in target && target.published) :
      !('post' in target && target.post.published))) {
      return NextResponse.json({ error: 'Inhalt nicht gefunden' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
    }
    if (target.authorId === userId) {
      return NextResponse.json({ error: 'Eigene Inhalte können nicht gemeldet werden' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } });
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCount = await prisma.contentReport.count({ where: { reporterId: userId, createdAt: { gte: since } } });
    if (recentCount >= SOFT_REPORTS_PER_DAY) {
      return NextResponse.json({ error: 'Zu viele Meldungen. Bitte später erneut versuchen.' }, { status: 429, headers: { 'Cache-Control': 'private, no-store' } });
    }

    try {
      const report = await prisma.contentReport.create({ data: {
        reporterId: userId, targetType, targetId, reason, details: safeDetails || null,
      }, select: { id: true } });
      return NextResponse.json({ id: report.id, alreadyReported: false }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const duplicate = await prisma.contentReport.findUnique({ where: unique, select: { id: true } });
        if (duplicate) return NextResponse.json({ id: duplicate.id, alreadyReported: true }, { headers: { 'Cache-Control': 'private, no-store' } });
      }
      throw error;
    }
  } catch (error) {
    const inputError = requestErrorResponse(error);
    if (inputError) {
      inputError.headers.set('Cache-Control', 'private, no-store');
      return inputError;
    }
    console.error('Report creation failed:', error);
    return NextResponse.json({ error: 'Meldung konnte nicht gespeichert werden' }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
    const status = new URL(request.url).searchParams.get('status') ?? 'OPEN';
    if (!['OPEN', 'DISMISSED', 'RESOLVED'].includes(status)) {
      return NextResponse.json({ error: 'Ungültiger Status' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } });
    }
    const page = readPage(request, 20);
    const result = await spaceTransaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
      if (!hasModeratorRole(actor?.role)) throw new SpaceApiError('Nicht autorisiert', 403);
      // Scope before LIMIT/OFFSET and COUNT; a moderator must not infer the
      // existence of private reports through totals or pagination holes.
      const where: Prisma.ContentReportWhereInput = actor?.role === 'ADMIN' ? { status }
        : { status, scopeSpaceId: null, targetType: { in: ['POST', 'COMMENT'] } };
      const [reports, total] = await Promise.all([
        tx.contentReport.findMany({ where, ...page, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true, targetType: true, targetId: true, scopeSpaceId: true, reason: true,
            details: true, status: true, createdAt: true, reviewedAt: true, reviewedById: true, resolutionNote: true } }),
        tx.contentReport.count({ where }),
      ]);

      // Public targets still require live publication. Space previews are
      // visible only in an ADMIN snapshot and must match the stored scope.
      const postIds = reports.filter(report => report.targetType === 'POST').map(report => report.targetId);
      const commentIds = reports.filter(report => report.targetType === 'COMMENT').map(report => report.targetId);
      const discussionIds = actor.role === 'ADMIN' ? reports.filter(report => report.targetType === 'SPACE_DISCUSSION').map(report => report.targetId) : [];
      const replyIds = actor.role === 'ADMIN' ? reports.filter(report => report.targetType === 'SPACE_REPLY').map(report => report.targetId) : [];
      const missionContributionIds = actor.role === 'ADMIN' ? reports.filter(report => report.targetType === 'SPACE_MISSION_CONTRIBUTION').map(report => report.targetId) : [];
      const [posts, comments, discussions, replies, missionContributions] = await Promise.all([
        postIds.length ? tx.post.findMany({ where: { id: { in: postIds }, published: true },
          select: { id: true, title: true, content: true } }) : Promise.resolve([]),
        commentIds.length ? tx.comment.findMany({ where: { id: { in: commentIds }, post: { published: true } },
          select: { id: true, content: true } }) : Promise.resolve([]),
        discussionIds.length ? tx.spaceDiscussion.findMany({ where: { id: { in: discussionIds } },
          select: { id: true, spaceId: true, title: true, content: true, hiddenAt: true } }) : Promise.resolve([]),
        replyIds.length ? tx.spaceReply.findMany({ where: { id: { in: replyIds } },
          select: { id: true, content: true, hiddenAt: true,
            discussion: { select: { id: true, spaceId: true, title: true, hiddenAt: true } } } }) : Promise.resolve([]),
        missionContributionIds.length ? tx.spaceMissionContribution.findMany({ where: { id: { in: missionContributionIds }, mission: { space: { visibility: 'PRIVATE' } } },
          select: { id: true, content: true, hiddenAt: true, withdrawnAt: true,
            mission: { select: { id: true, spaceId: true, title: true } } } }) : Promise.resolve([]),
      ]);
      const availablePosts = new Map(posts.map(post => [post.id, post]));
      const availableComments = new Map(comments.map(comment => [comment.id, comment]));
      const availableDiscussions = new Map(discussions.map(discussion => [discussion.id, discussion]));
      const availableReplies = new Map(replies.map(reply => [reply.id, reply]));
      const availableMissionContributions = new Map(missionContributions.map(item => [item.id, item]));

      const items = reports.map(report => {
        const post = report.targetType === 'POST' ? availablePosts.get(report.targetId) : undefined;
        const comment = report.targetType === 'COMMENT' ? availableComments.get(report.targetId) : undefined;
        const candidateDiscussion = report.targetType === 'SPACE_DISCUSSION' ? availableDiscussions.get(report.targetId) : undefined;
        const discussion = candidateDiscussion?.spaceId === report.scopeSpaceId ? candidateDiscussion : undefined;
        const candidateReply = report.targetType === 'SPACE_REPLY' ? availableReplies.get(report.targetId) : undefined;
        const reply = candidateReply?.discussion.spaceId === report.scopeSpaceId ? candidateReply : undefined;
        const candidateMissionContribution = report.targetType === 'SPACE_MISSION_CONTRIBUTION' ? availableMissionContributions.get(report.targetId) : undefined;
        const missionContribution = candidateMissionContribution?.mission.spaceId === report.scopeSpaceId ? candidateMissionContribution : undefined;
        return {
          id: report.id, targetType: report.targetType, targetId: report.targetId,
          scopeSpaceId: report.scopeSpaceId, targetDiscussionId: reply?.discussion.id ?? null,
          targetMissionId: missionContribution?.mission.id ?? null,
          targetWithdrawn: Boolean(missionContribution?.withdrawnAt),
          reason: report.reason, details: report.details, status: report.status,
          createdAt: report.createdAt, reviewedAt: report.reviewedAt,
          reviewedById: report.reviewedById, resolutionNote: report.resolutionNote,
          targetAvailable: Boolean(post || comment || discussion || reply || missionContribution),
          targetHidden: discussion ? Boolean(discussion.hiddenAt) : reply ? Boolean(reply.hiddenAt || reply.discussion.hiddenAt) : Boolean(missionContribution?.hiddenAt),
          targetTitle: post ? sanitizeTextServer(post.title).slice(0, 120) :
            discussion ? sanitizeTextServer(discussion.title).slice(0, 120) :
            reply ? sanitizeTextServer(reply.discussion.title).slice(0, 120) :
            missionContribution ? sanitizeTextServer(missionContribution.mission.title).slice(0, 120) : null,
          targetPreview: post ? sanitizeHtmlPreviewServer(post.content, 240) :
            comment ? sanitizeHtmlPreviewServer(comment.content, 240) :
            discussion ? sanitizeHtmlPreviewServer(discussion.content, 240) :
            reply ? sanitizeHtmlPreviewServer(reply.content, 240) :
            missionContribution ? sanitizeHtmlPreviewServer(missionContribution.content, 240) : null,
        };
      });
      return { items, total, page: page.skip / 20 + 1, pageSize: 20 };
    });
    return NextResponse.json(result,
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return spaceErrorResponse(error, 'Meldungen konnten nicht geladen werden');
  }
}
