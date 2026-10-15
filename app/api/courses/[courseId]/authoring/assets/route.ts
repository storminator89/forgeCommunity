import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { CourseAssetError, saveCourseAsset } from '@/lib/server/course-assets';
import { ImageUploadValidationError } from '@/lib/server/image-upload';
import { consumeRateLimit, rateLimitHeaders, UPLOAD_RATE_LIMIT } from '@/lib/server/rate-limit';
import { requestWithBodyLimit, RequestBodyLimitError } from '@/lib/server/request-body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MULTIPART_REQUEST_BYTES = 5 * 1024 * 1024 + 256 * 1024;
const noStore = { 'Cache-Control': 'private, no-store' };

export async function POST(request: NextRequest, props: { params: Promise<{ courseId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Ungültige Anfragequelle.' }, { status: 403, headers: noStore });

  const { courseId } = await props.params;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(courseId)) return NextResponse.json({ error: 'Kurs nicht gefunden.' }, { status: 404, headers: noStore });
  const uploadRate = consumeRateLimit(`upload:user:${session.user.id}`, UPLOAD_RATE_LIMIT);
  if (!uploadRate.allowed) return NextResponse.json({ error: 'Zu viele Uploads.' }, { status: 429, headers: { ...noStore, ...rateLimitHeaders(uploadRate) } });

  try {
    const formData = await (await requestWithBodyLimit(request, MAX_MULTIPART_REQUEST_BYTES)).formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'Keine Bilddatei hochgeladen.' }, { status: 400, headers: noStore });
    }
    const asset = await saveCourseAsset(courseId, { id: session.user.id }, file);
    return NextResponse.json(asset, { status: 201, headers: noStore });
  } catch (error) {
    if (error instanceof CourseAssetError || error instanceof ImageUploadValidationError) {
      return NextResponse.json({ error: error.message }, { status: error instanceof CourseAssetError ? error.status : 400, headers: noStore });
    }
    if (error instanceof RequestBodyLimitError) return NextResponse.json({ error: 'Datei ist zu gross.' }, { status: 413, headers: noStore });
    console.error('Failed to upload course asset:', error);
    return NextResponse.json({ error: 'Kursbild konnte nicht gespeichert werden.' }, { status: 500, headers: noStore });
  }
}
