/**
 * Small, runtime agnostic helpers shared by authentication boundaries.
 *
 * Origin checks intentionally allow requests without an Origin/Referer header
 * so non browser API clients can still use bearer or other explicit auth. A
 * browser request that supplies either header must point back to this app.
 */

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** UTF-8 length without depending on Node's Buffer (middleware can be Edge). */
export function utf8ByteLength(value: string): number {
  let length = 0;

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) length += 1;
    else if (codePoint <= 0x7ff) length += 2;
    else if (codePoint <= 0xffff) length += 3;
    else length += 4;
  }

  return length;
}

/** Reads a bounded request body as bytes; null means the limit was exceeded. */
export async function readRequestBytes(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const declaredLength = Number.parseInt(contentLength, 10);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return null;
    }
  }

  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      total += value.byteLength;
      if (total > maxBytes) {
        // Do not await cancellation: a tee or a platform backed stream may
        // wait for another consumer, defeating the request size guard.
        void reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

export function decodeUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder === 'function') {
    return new TextDecoder().decode(bytes);
  }

  // TextDecoder is available in Next.js runtimes. This fallback keeps small
  // test environments functional for ASCII form and JSON bodies.
  return String.fromCharCode(...bytes);
}

/**
 * Reads a small authentication request body without buffering an attacker
 * controlled amount of data. Returns null when the limit is exceeded.
 */
export async function readRequestBody(
  request: Request,
  maxBytes: number,
): Promise<string | null> {
  const bytes = await readRequestBytes(request, maxBytes);
  return bytes === null ? null : decodeUtf8(bytes);
}

function originFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Returns true when a request's browser origin is the same as the app origin.
 * A missing Origin and Referer is treated as an API client request.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();
  const suppliedOrigin = originFromUrl(origin);
  const suppliedRefererOrigin = originFromUrl(referer);

  // A cross site browser request can omit Origin for some simple requests;
  // Fetch Metadata still gives us a reliable signal in modern browsers.
  if (fetchSite === 'cross-site') return false;

  // The literal `null` origin is used by sandboxed documents and is not a
  // trustworthy same origin assertion.
  if (origin && (origin === 'null' || !suppliedOrigin)) {
    return false;
  }

  if (referer && !suppliedRefererOrigin) {
    return false;
  }

  const expectedOrigin =
    originFromUrl(process.env.NEXTAUTH_URL) ??
    originFromUrl(process.env.NEXT_PUBLIC_APP_URL) ??
    originFromUrl(request.url);

  if (!expectedOrigin) return false;

  if (suppliedOrigin && suppliedOrigin !== expectedOrigin) return false;
  if (suppliedRefererOrigin && suppliedRefererOrigin !== expectedOrigin) return false;

  return true;
}

export function isMutationMethod(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

/**
 * Extract the address supplied by the deployment's trusted reverse proxy.
 * Deployments must configure their proxy to overwrite these headers; without
 * that configuration an attacker can rotate values and evade IP limits.
 */
export function getClientAddress(headers: Headers): string {
  // Forwarded headers are user controlled unless the deployment explicitly
  // confirms that a trusted reverse proxy overwrites them. Failing closed to
  // one shared bucket is safer than letting clients rotate spoofed addresses.
  if (process.env.TRUST_PROXY !== 'true') return 'unknown';

  const forwarded = headers.get('x-forwarded-for');
  const firstForwarded = forwarded?.split(',')[0]?.trim();

  return (
    firstForwarded ||
    headers.get('x-real-ip')?.trim() ||
    'unknown'
  );
}
