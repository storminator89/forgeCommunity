import 'server-only';

// HELD foundation: no active route imports this module.
export const COURSE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const COURSE_IMAGE_MAX_PIXELS = 1_000_000;
export const COURSE_IMAGE_MAX_SIDE = 1600;
export const COURSE_IMAGE_CONTENT_TYPE = 'image/png' as const;

const failures = {
  IMAGE_TOO_LARGE: { status: 413, message: 'Die Bilddatei darf höchstens 5 MiB groß sein.' },
  IMAGE_DIMENSIONS: { status: 413, message: 'Das vorbereitete Bild darf höchstens 1 Megapixel und 1600 Pixel je Seite haben.' },
  IMAGE_UNSUPPORTED: { status: 415, message: 'Bitte ein vorbereitetes, statisches PNG-Bild verwenden.' },
  IMAGE_INVALID: { status: 422, message: 'Die Bilddatei ist beschädigt oder wird nicht unterstützt.' },
  IDENTITY_INVALID: { status: 400, message: 'Ungültige Kursdatei-Zuordnung.' },
  STORAGE_UNAVAILABLE: { status: 503, message: 'Der Kursdatei-Speicher ist gerade nicht verfügbar.' },
  STORAGE_READ_FAILED: { status: 503, message: 'Die Kursdatei konnte gerade nicht gelesen werden.' },
  AUTHOR_REQUIRED: { status: 404, message: 'Kurs nicht gefunden oder kein aktueller Bearbeitungszugriff.' },
  DATABASE_UNAVAILABLE: { status: 503, message: 'Der Kursdatei-Eintrag konnte gerade nicht geprüft werden.' },
  UPLOAD_REJECTED: { status: 409, message: 'Das Kursbild konnte wegen einer gleichzeitigen Änderung nicht gespeichert werden.' },
  UPLOAD_UNCERTAIN: { status: 503, message: 'Der Speicherstatus des Kursbilds ist unklar. Den Upload nicht automatisch wiederholen.' },
} as const;

export type CourseImageErrorCode = keyof typeof failures;

/** Provider errors, object paths and database details never become messages. */
export class CourseImageError extends Error {
  readonly status: number;

  constructor(public readonly errorCode: CourseImageErrorCode) {
    super(failures[errorCode].message);
    this.name = 'CourseImageError';
    this.status = failures[errorCode].status;
  }
}

/** Fresh allowlisted headers; never echo arbitrary R2 HTTP metadata. This is
 * response policy only and grants no authorization to read an object. */
export function courseImagePrivateHeaders(byteSize: number): Record<string, string> {
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > COURSE_IMAGE_MAX_BYTES) {
    throw new CourseImageError('IMAGE_INVALID');
  }
  return {
    'Content-Type': COURSE_IMAGE_CONTENT_TYPE,
    'Content-Length': String(byteSize),
    'Cache-Control': 'private, no-store',
    'Vary': 'Cookie',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'",
  };
}
