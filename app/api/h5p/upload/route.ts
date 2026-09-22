import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/options";
import { requestWithBodyLimit, RequestBodyLimitError } from '@/lib/server/request-body';
import { consumeRateLimit, rateLimitHeaders, UPLOAD_RATE_LIMIT } from '@/lib/server/rate-limit';

const MAX_H5P_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_MULTIPART_REQUEST_BYTES = MAX_H5P_FILE_SIZE_BYTES + 256 * 1024;

function isZipHeader(bytes: Uint8Array) {
  return bytes.length >= 4 && (
    (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) ||
    (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x05 && bytes[3] === 0x06) ||
    (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x07 && bytes[3] === 0x08)
  );
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (session.user.role !== 'ADMIN' && session.user.role !== 'INSTRUCTOR') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const uploadRate = consumeRateLimit(`upload:user:${session.user.id}`, UPLOAD_RATE_LIMIT);
    if (!uploadRate.allowed) {
      return NextResponse.json({ error: 'Too many uploads' }, { status: 429, headers: rateLimitHeaders(uploadRate) });
    }

    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_REQUEST_BYTES) {
      return NextResponse.json({ error: 'H5P file is too large' }, { status: 413 });
    }

    const limitedRequest = await requestWithBodyLimit(request, MAX_MULTIPART_REQUEST_BYTES);
    const formData = await limitedRequest.formData();
    const h5pFile = formData.get('h5p');

    if (!h5pFile || typeof h5pFile !== 'object' || typeof (h5pFile as File).arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'No H5P file provided' }, { status: 400 });
    }

    const file = h5pFile as File;

    if (typeof file.name !== 'string' || typeof file.size !== 'number' || !file.name.toLowerCase().endsWith('.h5p')) {
      return NextResponse.json({ error: 'Only .h5p files are allowed' }, { status: 400 });
    }
    if (file.size > MAX_H5P_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: 'H5P file is too large' }, { status: 413 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_H5P_FILE_SIZE_BYTES || !isZipHeader(bytes)) {
      return NextResponse.json({ error: 'Invalid H5P archive' }, { status: 400 });
    }

    // No H5P storage/runtime is configured yet. Do not report a fake ID after
    // accepting an archive; the future integration must also validate archive
    // paths before extraction (reject absolute paths and `..` components).
    return NextResponse.json({ error: 'H5P upload is not configured' }, { status: 501 });
  } catch (error) {
    console.error('Error uploading H5P file:', error);
    return NextResponse.json({ error: 'Failed to upload H5P file' }, { status: error instanceof RequestBodyLimitError ? 413 : 500 });
  }
}
