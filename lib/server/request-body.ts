import 'server-only';

export class RequestBodyLimitError extends Error {
  constructor(message = 'Request body is too large') {
    super(message);
    this.name = 'RequestBodyLimitError';
  }
}

/**
 * Consume a request body with a hard byte limit before handing it to a
 * multipart parser. Content-Length is advisory because chunked requests do
 * not provide it.
 */
export async function requestWithBodyLimit(request: Request, maxBytes: number) {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestBodyLimitError();
  }

  if (!request.body) return request;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = value as Uint8Array;
      total += chunk.byteLength;
      if (total > maxBytes) {
        // Cancellation can wait on a slow or malicious producer indefinitely.
        void reader.cancel().catch(() => {});
        throw new RequestBodyLimitError();
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: body.byteLength > 0 ? body : undefined,
    signal: request.signal,
  });
}
