import { NextRequest, NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { normalizeChatImage } from '@/lib/server/chat-image-codec';
import { ChatImageError, CHAT_IMAGE_MAX_BYTES } from '@/lib/server/chat-image-policy';
import { acquireChatImageUpload, putChatImage } from '@/lib/server/chat-image-r2';
import { RequestBodyLimitError } from '@/lib/server/request-body';
import { requestWithChatImageBodyLimit } from '@/lib/server/chat-image-body';
import { consumeRateLimit, rateLimitHeaders, UPLOAD_RATE_LIMIT } from '@/lib/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MULTIPART_REQUEST_BYTES = CHAT_IMAGE_MAX_BYTES + 256 * 1024;

function failure(error: ChatImageError, headers: Record<string, string> = {}) {
  return NextResponse.json({ error: error.message, errorCode: error.errorCode }, {
    status: error.status,
    headers: { 'Cache-Control': 'private, no-store', ...headers },
  });
}

export async function POST(request: NextRequest) {
  let release: (() => void) | null = null;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return failure(new ChatImageError('UNAUTHORIZED'));

    const uploadRate = consumeRateLimit(`upload:user:${session.user.id}`, UPLOAD_RATE_LIMIT);
    if (!uploadRate.allowed) {
      return failure(new ChatImageError('UPLOAD_RATE_LIMIT'), rateLimitHeaders(uploadRate));
    }

    if (!env.DB) throw new Error('Chat database is unavailable.');
    const currentUser = await env.DB.withSession('first-primary')
      .prepare('SELECT id FROM User WHERE id = ?1').bind(session.user.id).first<{ id: string }>();
    if (!currentUser) return failure(new ChatImageError('UNAUTHORIZED'));

    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_REQUEST_BYTES) {
      return failure(new ChatImageError('IMAGE_TOO_LARGE'));
    }
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data;')) {
      return failure(new ChatImageError('IMAGE_INVALID'));
    }

    release = acquireChatImageUpload();
    if (!release) return failure(new ChatImageError('UPLOAD_BUSY'), { 'Retry-After': '1' });

    const limitedRequest = await requestWithChatImageBodyLimit(request, MAX_MULTIPART_REQUEST_BYTES);
    let formData: FormData;
    try {
      formData = await limitedRequest.formData();
    } catch {
      throw new ChatImageError('IMAGE_INVALID');
    }
    const files = formData.getAll('file');
    if (files.length !== 1 || typeof files[0] === 'string') throw new ChatImageError('IMAGE_INVALID');

    const canonicalPng = await normalizeChatImage(files[0]);
    const filePath = await putChatImage(canonicalPng, currentUser.id);
    return NextResponse.json({ success: true, filePath }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof RequestBodyLimitError) return failure(new ChatImageError('IMAGE_TOO_LARGE'));
    if (error instanceof ChatImageError) return failure(error);
    // Never serialize codec, storage, database, or parser exception messages.
    return failure(new ChatImageError('UPLOAD_FAILED'));
  } finally {
    release?.();
  }
}
