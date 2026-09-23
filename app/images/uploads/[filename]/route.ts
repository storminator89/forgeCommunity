import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';

import { getPublicImageUploadPath } from '@/lib/server/image-upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONTENT_TYPES: Record<string, string> = {
  gif: 'image/gif',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export async function GET(
  _request: Request,
  props: { params: Promise<{ filename: string }> },
) {
  const { filename } = await props.params;
  const filePath = getPublicImageUploadPath(filename);
  if (!filePath) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const bytes = await readFile(filePath);
    const extension = filename.split('.').pop()?.toLowerCase() || '';
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': CONTENT_TYPES[extension] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
