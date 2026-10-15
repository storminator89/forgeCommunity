import 'server-only';

const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);

export type NotificationCursor = { id: string; createdAt: Date };

/** A row-independent keyset survives a notification deleted between pages. */
export function encodeNotificationCursor(row: NotificationCursor, viewerId: string): string {
  return `v1.${Buffer.from(JSON.stringify({ userId: viewerId, id: row.id, createdAt: row.createdAt.toISOString() })).toString('base64url')}`;
}

export function decodeNotificationCursor(raw: string, viewerId: string): NotificationCursor | null {
  if (!raw.startsWith('v1.') || raw.length > 1024) return null;
  try {
    const encoded = raw.slice(3);
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
    const buffer = Buffer.from(encoded, 'base64url');
    if (buffer.toString('base64url') !== encoded) return null;
    const value = JSON.parse(buffer.toString('utf8')) as Record<string, unknown>;
    if (value.userId !== viewerId || !validId(value.id) || typeof value.createdAt !== 'string') return null;
    const createdAt = new Date(value.createdAt);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== value.createdAt) return null;
    return { id: value.id, createdAt };
  } catch { return null; }
}
