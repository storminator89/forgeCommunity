import type { CommunityPost } from '@/lib/community-feed'

export type CommunityFilters = { mine: boolean; unanswered: boolean }
export const EMPTY_COMMUNITY_FILTERS: CommunityFilters = { mine: false, unanswered: false }

export class InvalidCommunityFilterError extends Error {
  constructor() { super('Ungültige Beitragsfilter. Erlaubt sind mine=1 und unanswered=1.') }
}

/** Only absent or a single canonical =1 flag is accepted. */
export function readCommunityFilters(params: URLSearchParams): CommunityFilters {
  const read = (name: string) => {
    const values = params.getAll(name)
    if (values.length > 1 || (values.length === 1 && values[0] !== '1')) throw new InvalidCommunityFilterError()
    return values.length === 1
  }
  return { mine: read('mine'), unanswered: read('unanswered') }
}

export function writeCommunityFilters(params: URLSearchParams, filters: CommunityFilters): void {
  for (const name of ['mine', 'unanswered'] as const) {
    if (filters[name]) params.set(name, '1')
    else params.delete(name)
  }
}

export function communityTopicHref(topic: string | null, filters: CommunityFilters): string {
  const params = new URLSearchParams()
  if (topic) params.set('tag', topic)
  writeCommunityFilters(params, filters)
  return `/community${params.size ? `?${params}` : ''}`
}

/** Missing deferred counts must never qualify as zero comments. */
export function matchesCommunityFilters(post: CommunityPost, topic: string | null, filters: CommunityFilters, viewerId?: string): boolean {
  if (topic && !post.tags?.some(tag => tag.name === topic)) return false
  if (filters.mine && (!viewerId || post.authorId !== viewerId)) return false
  const count = post.commentCount ?? (post.commentsDeferred || post.commentsNextCursor ? null : post.comments.length)
  return !filters.unanswered || (count === 0 && post.comments.length === 0)
}
