export interface SpaceSummary {
  id: string;
  name: string;
  description: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  discussionCount: number;
  isMember: boolean;
  canManage: boolean;
  canWrite?: boolean;
}

export interface SpaceAuthor { id: string; name: string | null; image: string | null }
export interface SpaceDiscussion {
  id: string;
  spaceId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: SpaceAuthor;
  replyCount: number;
  hiddenAt: string | null;
}
export interface SpaceReply {
  id: string;
  discussionId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: SpaceAuthor;
  hiddenAt: string | null;
}
export interface SpacePage<T> { items: T[]; nextCursor: string | null }

export class SpaceHttpError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'SpaceHttpError'; }
}

export function isSpaceAbort(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

export async function spaceJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, cache: 'no-store' });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
      ? data.error : 'Die Anfrage konnte nicht abgeschlossen werden.';
    throw new SpaceHttpError(response.status, message);
  }
  return data as T;
}

export function spaceUrl(spaceId: string) {
  return `/community/spaces/${encodeURIComponent(spaceId)}`;
}
export function discussionUrl(spaceId: string, discussionId: string) {
  return `${spaceUrl(spaceId)}/discussions/${encodeURIComponent(discussionId)}`;
}
export function apiSpaceUrl(spaceId: string) {
  return `/api/spaces/${encodeURIComponent(spaceId)}`;
}
export function spaceDate(date: string) {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Recheck all currently displayed pages, preserving depth while dropping newly hidden rows. */
export async function revalidateSpacePages<T>(base: string, visibleCount: number, request: <R>(path: string) => Promise<R>) {
  const items: T[] = [];
  let nextCursor: string | null = null;
  do {
    const path: string = nextCursor ? `${base}?cursor=${encodeURIComponent(nextCursor)}` : base;
    const page: SpacePage<T> = await request<SpacePage<T>>(path);
    items.push(...page.items);
    nextCursor = page.nextCursor;
  } while (nextCursor && items.length < visibleCount);
  return { items, nextCursor };
}
