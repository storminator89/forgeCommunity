import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { Prisma } from '@/generated/prisma/client';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { activeAssetContentIds, activeAssetReference, courseAssetUrl, readCourseAsset } from '@/lib/server/course-assets';
import { completionState } from '@/lib/server/course-progress';
import { coursePathAccess, publicationPathNodes } from '@/lib/server/course-path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = {
  'Cache-Control': 'private, no-store',
  'Vary': 'Cookie',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'",
};

function missing() { return NextResponse.json({ error: 'Kursdatei nicht gefunden.' }, { status: 404, headers }); }

async function serve(props: { params: Promise<{ courseId: string; assetId: string }> }, includeBody: boolean) {
  const session = await getServerSession(authOptions);
  const { courseId, assetId } = await props.params;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(courseId) || !/^[A-Za-z0-9_-]{1,80}$/.test(assetId)) return missing();

  try {
    // Authority, enrollment and the active publication are one DB snapshot.
    // A draft or historical reference never grants learner access.
    const load = () => prisma.$transaction(async tx => {
      const [actor, course, asset] = await Promise.all([
        session?.user?.id ? tx.user.findUnique({ where: { id: session.user.id }, select: { role: true } }) : Promise.resolve(null),
        tx.course.findUnique({ where: { id: courseId }, select: { instructorId: true, activePublicationId: true, imageUrl: true } }),
        tx.courseAsset.findUnique({ where: { id: assetId }, select: { courseId: true, storageKey: true, contentType: true, byteSize: true } }),
      ]);
      if (!course || !asset || asset.courseId !== courseId) return null;
      const canAuthor = Boolean(actor && (course.instructorId === session?.user?.id || actor.role === 'ADMIN'));
      if (!canAuthor) {
        if (!course.activePublicationId) return null;
        const publication = await tx.coursePublication.findUnique({
          where: { id: course.activePublicationId }, select: { courseId: true, payload: true },
        });
        if (!publication || publication.courseId !== courseId) return null;
        let reference: 'cover' | 'content' | null = null;
        try { reference = activeAssetReference(JSON.parse(publication.payload), courseAssetUrl(courseId, assetId)); }
        catch { return null; }
        if (!reference) return null;
        if (reference === 'content') {
          if (!actor || !session?.user?.id) return null;
          const enrollment = await tx.enrollment.findUnique({
            where: { userId_courseId: { userId: session.user.id, courseId } }, select: { id: true },
          });
          if (!enrollment) return null;
          const nodes = publicationPathNodes(publication.payload);
          const access = coursePathAccess(nodes, (await completionState(tx, session.user.id, courseId)).completedContentIds);
          const referencedIds = activeAssetContentIds(JSON.parse(publication.payload), courseAssetUrl(courseId, assetId));
          if (!referencedIds.some(id => access.get(id)?.locked === false)) return null;
        } else if (course.imageUrl !== courseAssetUrl(courseId, assetId)) {
          return null;
        }
        // Active covers appear in the public directory, including to
        // anonymous viewers and the Next image optimizer. Require the live
        // projection as well as the active snapshot to name this exact URL.
      }
      const bytes = await readCourseAsset(asset);
      return { bytes, contentType: asset.contentType, byteSize: asset.byteSize };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    let result: Awaited<ReturnType<typeof load>> = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try { result = await load(); break; }
      catch (error) {
        // Retry only serialization conflicts, always from the initial
        // authority/publication read so a revocation wins the new snapshot.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt === 3) throw error;
      }
    }
    if (!result) return missing();
    return new NextResponse(includeBody ? new Uint8Array(result.bytes) : null, {
      headers: { ...headers, 'Content-Type': result.contentType, 'Content-Length': String(result.byteSize) },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT' || (error as NodeJS.ErrnoException)?.code === 'ELOOP') return missing();
    console.error('Failed to serve course asset:', error);
    return missing();
  }
}

export async function GET(_request: NextRequest, props: { params: Promise<{ courseId: string; assetId: string }> }) {
  return serve(props, true);
}

export async function HEAD(_request: NextRequest, props: { params: Promise<{ courseId: string; assetId: string }> }) {
  return serve(props, false);
}
