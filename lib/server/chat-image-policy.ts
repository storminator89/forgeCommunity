import 'server-only';

export const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const CHAT_IMAGE_MAX_PIXELS = 1_000_000;
export const CHAT_IMAGE_MAX_SIDE = 1600;

const failures = {
  IMAGE_TOO_LARGE: { status: 413, message: 'Die Bilddatei darf höchstens 5 MB groß sein.' },
  IMAGE_DIMENSIONS: { status: 413, message: 'Das vorbereitete Bild darf höchstens 1 Megapixel und 1600 Pixel je Seite haben.' },
  IMAGE_UNSUPPORTED: { status: 415, message: 'Bitte das Bild im Chat als PNG oder JPEG vorbereiten lassen.' },
  IMAGE_INVALID: { status: 422, message: 'Die Bilddatei ist beschädigt oder wird nicht unterstützt.' },
  UPLOAD_TIMEOUT: { status: 408, message: 'Der Bild-Upload hat zu lange gedauert. Bitte erneut versuchen.' },
  UPLOAD_BUSY: { status: 503, message: 'Ein Bild wird bereits verarbeitet. Bitte gleich erneut versuchen.' },
  UPLOAD_FAILED: { status: 500, message: 'Das Bild konnte nicht hochgeladen werden.' },
  UPLOAD_RATE_LIMIT: { status: 429, message: 'Zu viele Uploads. Bitte später erneut versuchen.' },
  UNAUTHORIZED: { status: 401, message: 'Nicht autorisiert.' },
} as const;

export type ChatImageErrorCode = keyof typeof failures;

/** Only this fixed catalog supplies public upload error messages and statuses. */
export class ChatImageError extends Error {
  readonly status: number;

  constructor(public readonly errorCode: ChatImageErrorCode) {
    super(failures[errorCode].message);
    this.name = 'ChatImageError';
    this.status = failures[errorCode].status;
  }
}
