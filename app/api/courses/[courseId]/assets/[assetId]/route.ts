import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { loadD1CourseAsset } from '@/lib/server/d1-course-asset-reads';

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
    const result = await loadD1CourseAsset(session?.user?.id ?? null, courseId, assetId);
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
