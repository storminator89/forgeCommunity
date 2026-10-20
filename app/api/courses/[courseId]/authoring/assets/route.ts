import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { assertCurrentD1CourseImageEditor, saveD1CourseImage } from '@/lib/server/d1-course-asset-write';
import { CourseImageError } from '@/lib/server/course-image-policy';
import { acquireCourseImageUpload, CourseImageIngressError, readCourseImageFile } from '@/lib/server/course-image-ingress';
import { consumeRateLimit, rateLimitHeaders, UPLOAD_RATE_LIMIT } from '@/lib/server/rate-limit';
import { RequestBodyLimitError } from '@/lib/server/request-body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'private, no-store' };

function failure(error: CourseImageError | CourseImageIngressError, headers: Record<string, string> = {}) {
  return NextResponse.json({ error: error.message, errorCode: error.errorCode }, {
    status: error.status, headers: { ...noStore, ...headers },
  });
}

export async function POST(request: NextRequest, props: { params: Promise<{ courseId: string }> }) {
  let release: (() => void) | null = null;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore });
    if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Ungültige Anfragequelle.' }, { status: 403, headers: noStore });

    const { courseId } = await props.params;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(courseId)) return NextResponse.json({ error: 'Kurs nicht gefunden.' }, { status: 404, headers: noStore });
    const actor = Object.freeze({ id: session.user.id });
    const uploadRate = consumeRateLimit(`upload:user:${actor.id}`, UPLOAD_RATE_LIMIT);
    if (!uploadRate.allowed) return NextResponse.json({ error: 'Zu viele Uploads.' }, {
      status: 429, headers: { ...noStore, ...rateLimitHeaders(uploadRate) },
    });

    // Never consume multipart on session authority alone. This fresh-primary
    // current User/Course check precedes admission and every body read.
    await assertCurrentD1CourseImageEditor(courseId, actor);
    release = acquireCourseImageUpload();
    if (!release) return failure(new CourseImageIngressError('UPLOAD_BUSY'), { 'Retry-After': '1' });

    const file = await readCourseImageFile(request);
    // Exactly once: the reviewed writer repeats fresh editor authority before
    // bounded decode and in its conditional INSERT, then reconciles only the
    // generated exact asset ID. Never race or automatically retry this write.
    const asset = await saveD1CourseImage(courseId, actor, file);
    return NextResponse.json(asset, { status: 201, headers: noStore });
  } catch (error) {
    if (error instanceof CourseImageError || error instanceof CourseImageIngressError) return failure(error);
    if (error instanceof RequestBodyLimitError) return failure(new CourseImageError('IMAGE_TOO_LARGE'));
    // Do not forward provider/parser/codec messages, bindings or private keys.
    return NextResponse.json({ error: 'Kursbild konnte nicht gespeichert werden.', errorCode: 'UPLOAD_FAILED' }, {
      status: 500, headers: noStore,
    });
  } finally {
    release?.();
  }
}
