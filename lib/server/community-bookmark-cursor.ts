import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CommunityBookmarkFilter } from '@/lib/community-bookmarks';
import { InvalidPaginationError } from './api-input';

type Boundary = { savedAt: Date; id: string };
function signature(payload: string, userId: string) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('Bookmark cursor requires the configured authentication secret');
  return createHmac('sha256', secret).update(`community-bookmarks\0${userId}\0${payload}`).digest();
}
export function encodeBookmarkCursor(row: Boundary, userId: string, filter: CommunityBookmarkFilter) {
  const payload = Buffer.from(JSON.stringify({ v: 1, filter, savedAt: row.savedAt.toISOString(), id: row.id })).toString('base64url');
  return `${payload}.${signature(payload, userId).toString('base64url')}`;
}
export function readBookmarkCursor(raw: string | null, userId: string, filter: CommunityBookmarkFilter): Boundary | null {
  if (raw === null) return null;
  if (!raw || raw.length > 768 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw)) throw new InvalidPaginationError();
  const [payload, mac] = raw.split('.');
  const bytes = Buffer.from(payload, 'base64url');
  const supplied = Buffer.from(mac, 'base64url');
  const expected = signature(payload, userId);
  if (bytes.toString('base64url') !== payload || supplied.toString('base64url') !== mac || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new InvalidPaginationError();
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || Object.keys(value).length !== 4 || value.v !== 1 || value.filter !== filter ||
        typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.id) || typeof value.savedAt !== 'string') throw new Error();
    const savedAt = new Date(value.savedAt);
    if (!Number.isFinite(savedAt.getTime()) || savedAt.toISOString() !== value.savedAt) throw new Error();
    return { savedAt, id: value.id };
  } catch { throw new InvalidPaginationError(); }
}
