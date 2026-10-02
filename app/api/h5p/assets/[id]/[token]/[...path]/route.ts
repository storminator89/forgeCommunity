import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyH5PAssetToken } from '@/lib/server/h5p-access';
import { h5pAssetMime, readH5PAsset } from '@/lib/server/h5p-storage';
import { H5PValidationError } from '@/lib/server/h5p-archive';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  // Also protect direct navigation to imported HTML/SVG: source URLs must never
  // create an unsandboxed document on the signed-in application's origin.
  'Content-Security-Policy': "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'",
};

export function OPTIONS() { return new NextResponse(null, { status: 204, headers }); }

export async function GET(request: NextRequest, props: { params: Promise<{ id: string; token: string; path: string[] }> }) {
  try {
    const { id, token, path } = await props.params;
    if (!verifyH5PAssetToken(id, token)) return NextResponse.json({ error: 'Invalid or expired H5P asset access' }, { status: 403, headers });
    if (!await prisma.h5PContent.findUnique({ where: { id }, select: { id: true } })) return NextResponse.json({ error: 'H5P content not found' }, { status: 404, headers });
    const asset = await readH5PAsset(id, path);
    const responseHeaders: Record<string, string> = { ...headers, 'Content-Type': h5pAssetMime(asset.filename), 'Accept-Ranges': 'bytes' };
    const range = request.headers.get('range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const total = asset.bytes.length;
      if (!match || (!match[1] && !match[2]) || !total) return new NextResponse(null, { status: 416, headers: { ...responseHeaders, 'Content-Range': `bytes */${total}` } });
      const start = match[1] ? Number(match[1]) : Math.max(0, total - Number(match[2]));
      const end = match[1] ? (match[2] ? Math.min(Number(match[2]), total - 1) : total - 1) : total - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= total || end < start) return new NextResponse(null, { status: 416, headers: { ...responseHeaders, 'Content-Range': `bytes */${total}` } });
      const slice = new Uint8Array(asset.bytes.subarray(start, end + 1));
      return new NextResponse(slice, { status: 206, headers: { ...responseHeaders, 'Content-Length': String(slice.length), 'Content-Range': `bytes ${start}-${end}/${total}` } });
    }
    return new NextResponse(new Uint8Array(asset.bytes), { headers: { ...responseHeaders, 'Content-Length': String(asset.bytes.length) } });
  } catch (error) {
    if (error instanceof H5PValidationError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return NextResponse.json({ error: 'H5P file not found' }, { status: 404, headers });
    console.error('Failed to serve H5P asset:', error);
    return NextResponse.json({ error: 'Failed to load H5P asset' }, { status: 500, headers });
  }
}
