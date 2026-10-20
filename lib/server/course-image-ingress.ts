import 'server-only';

import { COURSE_IMAGE_MAX_BYTES } from './course-image-policy';
import { RequestBodyLimitError } from '@/lib/server/request-body';

export const COURSE_IMAGE_MAX_MULTIPART_BYTES = COURSE_IMAGE_MAX_BYTES + 256 * 1024;
const BODY_DEADLINE_MS = 15_000;

const ingressFailures = {
  UPLOAD_BUSY: { status: 503, message: 'Der Kursbild-Upload ist gerade ausgelastet. Bitte kurz warten.' },
  UPLOAD_TIMEOUT: { status: 408, message: 'Die Bildübertragung hat zu lange gedauert.' },
  UPLOAD_ABORTED: { status: 400, message: 'Die Bildübertragung wurde abgebrochen.' },
  MULTIPART_INVALID: { status: 400, message: 'Bitte genau eine Bilddatei und keine weiteren Felder hochladen.' },
} as const;

export class CourseImageIngressError extends Error {
  readonly status: number;

  constructor(public readonly errorCode: keyof typeof ingressFailures) {
    super(ingressFailures[errorCode].message);
    this.name = 'CourseImageIngressError';
    this.status = ingressFailures[errorCode].status;
  }
}

const uploadState = globalThis as typeof globalThis & {
  __forgeCourseImageUploadBusy?: boolean;
};

/** One admitted course upload per isolate, held through the writer's result
 * and exact-ID reconciliation. Not an aggregate Worker memory guarantee. */
export function acquireCourseImageUpload(): (() => void) | null {
  if (uploadState.__forgeCourseImageUploadBusy) return null;
  uploadState.__forgeCourseImageUploadBusy = true;
  let released = false;
  return () => {
    if (!released) uploadState.__forgeCourseImageUploadBusy = false;
    released = true;
  };
}

/** Call only after fresh current editor authorization and admission. Buffer
 * at most the multipart ceiling, with a single absolute ingress deadline.
 * Cancel the real reader, not an abandoned Promise.race read. The provider's
 * cancellation promise is never awaited. The bounded in-memory multipart
 * parser must finish within this same deadline before any writer is called.
 * No timeout races or retries a storage/database write. */
export async function readCourseImageFile(request: Request): Promise<File> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > COURSE_IMAGE_MAX_MULTIPART_BYTES) {
    throw new RequestBodyLimitError();
  }
  if (!/^multipart\/form-data\s*;/i.test(request.headers.get('content-type') ?? '') || !request.body) {
    throw new CourseImageIngressError('MULTIPART_INVALID');
  }

  const reader = request.body.getReader();
  const deadlineAt = Date.now() + BODY_DEADLINE_MS;
  const chunks: Uint8Array[] = [];
  let total = 0, expired = false, cancelling = false;
  const cancelReader = () => {
    if (cancelling) return;
    cancelling = true;
    void reader.cancel().catch(() => {});
  };
  const checkIngress = () => {
    if (expired || Date.now() >= deadlineAt) {
      expired = true;
      cancelReader();
      throw new CourseImageIngressError('UPLOAD_TIMEOUT');
    }
    if (request.signal.aborted) {
      cancelReader();
      throw new CourseImageIngressError('UPLOAD_ABORTED');
    }
  };
  const abort = () => cancelReader();
  request.signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { expired = true; cancelReader(); }, BODY_DEADLINE_MS);

  try {
    while (true) {
      checkIngress();
      const { done, value } = await reader.read();
      // A cancelled read is never mistaken for a complete valid body.
      checkIngress();
      if (done) break;
      total += value.byteLength;
      if (total > COURSE_IMAGE_MAX_MULTIPART_BYTES) { cancelReader(); throw new RequestBodyLimitError(); }
      chunks.push(value);
    }

    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    checkIngress();
    let form: FormData;
    try {
      form = await new Request(request.url, {
        method: request.method, headers: request.headers, body, signal: request.signal,
      }).formData();
    } catch {
      checkIngress();
      throw new CourseImageIngressError('MULTIPART_INVALID');
    }
    checkIngress();
    const entries = Array.from(form.entries());
    if (entries.length !== 1 || entries[0][0] !== 'file' || typeof entries[0][1] === 'string') {
      throw new CourseImageIngressError('MULTIPART_INVALID');
    }
    const file = entries[0][1];
    if (!Number.isSafeInteger(file.size) || file.size < 1) throw new CourseImageIngressError('MULTIPART_INVALID');
    if (file.size > COURSE_IMAGE_MAX_BYTES) throw new RequestBodyLimitError();
    return file;
  } catch (error) {
    // Concurrent timeout/abort keeps its own fixed public failure code.
    checkIngress();
    throw error;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}
