import 'server-only';

import { ChatImageError } from '@/lib/server/chat-image-policy';
import { RequestBodyLimitError } from '@/lib/server/request-body';

const BODY_DEADLINE_MS = 15_000;

/** Bound the attacker-controlled body read while Chat admission is held.
 * Cancel the actual reader on timeout, never race and abandon a pending read.
 * Underlying source cancellation may never settle, so it is not awaited. */
export async function requestWithChatImageBodyLimit(request: Request, maxBytes: number) {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new RequestBodyLimitError();
  if (!request.body) return request;

  const reader = request.body.getReader();
  const deadlineAt = Date.now() + BODY_DEADLINE_MS;
  const chunks: Uint8Array[] = [];
  let total = 0, expired = false, cancelling = false;
  const cancelReader = () => {
    if (cancelling) return;
    cancelling = true;
    // ReadableStream cancellation closes pending read requests before waiting
    // for the underlying source's possibly unbounded cancellation promise.
    void reader.cancel().catch(() => {});
  };
  const requireTime = () => {
    if (expired || Date.now() >= deadlineAt) {
      expired = true;
      cancelReader();
      throw new ChatImageError('UPLOAD_TIMEOUT');
    }
  };
  const timer = setTimeout(() => { expired = true; cancelReader(); }, BODY_DEADLINE_MS);

  try {
    while (true) {
      requireTime();
      const { done, value } = await reader.read();
      // Timeout cancellation must not be interpreted as a successful EOF.
      // Absolute checks also cover fast reads that defer the timer callback.
      requireTime();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { cancelReader(); throw new RequestBodyLimitError(); }
      chunks.push(value);
    }

    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    requireTime();
    return new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: body.byteLength > 0 ? body : undefined,
      signal: request.signal,
    });
  } catch (error) {
    // A reader failure concurrent with expiry still has the fixed timeout code.
    requireTime();
    throw error;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
