export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { readJsonObject, readPage, requestErrorResponse } from '@/lib/server/api-input';
import { sanitizeHtmlPreviewServer, sanitizeTextServer } from '@/lib/server/sanitize-html';
import { isReportReason, isReportTargetType } from '@/lib/reporting';

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
    if (!userId) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
    if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Ungültige Anfragequelle' }, { status: 403 });

    const body = await readJsonObject(request, 2048);
    const { targetType, targetId, reason, details } = body;
    if (!isReportTargetType(targetType) || !isReportReason(reason) ||
        typeof targetId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(targetId) ||
        (details !== undefined && typeof details !== 'string')) {
      return NextResponse.json({ error: 'Ungültige Meldung' }, { status: 400 });
    }

    const safeDetails = typeof details === 'string' ? sanitizeTextServer(details) : '';
    if (safeDetails.length > 500 || (reason === 'OTHER' && safeDetails.length < 5)) {
      return NextResponse.json({ error: 'Bitte einen gültigen Hinweis eingeben (maximal 500 Zeichen)' }, { status: 400 });
    }

    const unique = { reporterId_targetType_targetId: { reporterId: userId, targetType, targetId } };
    const existing = await prisma.contentReport.findUnique({ where: unique, select: { id: true } });
    if (existing) return NextResponse.json({ id: existing.id, alreadyReported: true });

    const target = targetType === 'POST'
      ? await prisma.post.findUnique({ where: { id: targetId }, select: { authorId: true, published: true } })
      : await prisma.comment.findUnique({ where: { id: targetId }, select: {
          authorId: true, post: { select: { published: true } },
        } });
    if (!target || (targetType === 'POST' ? !('published' in target && target.published) :
      !('post' in target && target.post.published))) {
      return NextResponse.json({ error: 'Inhalt nicht gefunden' }, { status: 404 });
    }
    if (target.authorId === userId) {
      return NextResponse.json({ error: 'Eigene Inhalte können nicht gemeldet werden' }, { status: 400 });
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCount = await prisma.contentReport.count({ where: { reporterId: userId, createdAt: { gte: since } } });
    if (recentCount >= SOFT_REPORTS_PER_DAY) {
      return NextResponse.json({ error: 'Zu viele Meldungen. Bitte später erneut versuchen.' }, { status: 429 });
    }

    try {
      const report = await prisma.contentReport.create({ data: {
        reporterId: userId, targetType, targetId, reason, details: safeDetails || null,
      }, select: { id: true } });
      return NextResponse.json({ id: report.id, alreadyReported: false }, { status: 201 });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const duplicate = await prisma.contentReport.findUnique({ where: unique, select: { id: true } });
        if (duplicate) return NextResponse.json({ id: duplicate.id, alreadyReported: true });
      }
      throw error;
    }
  } catch (error) {
    const inputError = requestErrorResponse(error);
    if (inputError) return inputError;
    console.error('Report creation failed:', error);
    return NextResponse.json({ error: 'Meldung konnte nicht gespeichert werden' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
    const actor = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!hasModeratorRole(actor?.role)) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 403 });

    const status = new URL(request.url).searchParams.get('status') ?? 'OPEN';
    if (!['OPEN', 'DISMISSED', 'RESOLVED'].includes(status)) {
      return NextResponse.json({ error: 'Ungültiger Status' }, { status: 400 });
    }
    const page = readPage(request, 20);
    const where = { status };
    const [reports, total] = await Promise.all([
      prisma.contentReport.findMany({
        where, ...page, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true, targetType: true, targetId: true, reason: true, details: true,
          status: true, createdAt: true, reviewedAt: true, reviewedById: true, resolutionNote: true,
        },
      }),
      prisma.contentReport.count({ where }),
    ]);

    // Read live public content only. A report must not reveal a deleted target
    // or a post that became unpublished after the report was filed.
    const postIds = reports.filter((report) => report.targetType === 'POST').map((report) => report.targetId);
    const commentIds = reports.filter((report) => report.targetType === 'COMMENT').map((report) => report.targetId);
    const [posts, comments] = await Promise.all([
      postIds.length ? prisma.post.findMany({ where: { id: { in: postIds }, published: true },
        select: { id: true, title: true, content: true } }) : [],
      commentIds.length ? prisma.comment.findMany({ where: { id: { in: commentIds }, post: { published: true } },
        select: { id: true, content: true } }) : [],
    ]);
    const availablePosts = new Map(posts.map((post) => [post.id, post]));
    const availableComments = new Map(comments.map((comment) => [comment.id, comment]));

    const items = reports.map((report) => {
      const post = report.targetType === 'POST' ? availablePosts.get(report.targetId) : undefined;
      const comment = report.targetType === 'COMMENT' ? availableComments.get(report.targetId) : undefined;
      return {
        id: report.id,
        targetType: report.targetType,
        targetId: report.targetId,
        reason: report.reason,
        details: report.details,
        status: report.status,
        createdAt: report.createdAt,
        reviewedAt: report.reviewedAt,
        reviewedById: report.reviewedById,
        resolutionNote: report.resolutionNote,
        targetAvailable: Boolean(post || comment),
        targetTitle: post ? sanitizeTextServer(post.title).slice(0, 120) : null,
        targetPreview: post ? sanitizeHtmlPreviewServer(post.content, 240) :
          comment ? sanitizeHtmlPreviewServer(comment.content, 240) : null,
      };
    });
    return NextResponse.json({ items, total, page: page.skip / 20 + 1, pageSize: 20 },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const inputError = requestErrorResponse(error);
    if (inputError) return inputError;
    console.error('Report queue failed:', error);
    return NextResponse.json({ error: 'Meldungen konnten nicht geladen werden' }, { status: 500 });
  }
}
