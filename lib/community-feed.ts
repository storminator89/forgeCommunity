export interface CommunityComment {
  id: string
  authorId: string
  author: { name: string; image: string | null } | null
  content: string
  createdAt: string
  votes: number
  isLiked: boolean
}

export interface CommunityPost {
  id: string
  title: string
  content: string
  published?: boolean
  authorId: string
  author: { id: string; name: string; image: string | null } | null
  createdAt: string
  votes: number
  isLiked: boolean
  comments: CommunityComment[]
  commentCount?: number
  commentsNextCursor?: string | null
}

export interface CommunityStats {
  posts: number
  receivedLikes: number
  comments: number
}

export interface FeedPage {
  posts: CommunityPost[]
  nextCursor: string | null
}

export interface CommentsPage {
  comments: CommunityComment[]
  nextCursor: string | null
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export async function fetchCommunityJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(error?.message || error?.error || 'Ein Fehler ist aufgetreten')
  }
  return response.json()
}

// Keep existing rows when a page overlaps. They may contain a newer local edit,
// like or comment. Both the API and client use the same deterministic tie-break.
export function mergeCommunityRows<T extends { id: string; createdAt: string }>(existing: T[], incoming: T[]): T[] {
  const rows = new Map(incoming.map(row => [row.id, row]))
  for (const row of existing) rows.set(row.id, row)
  return [...rows.values()].sort((a, b) => {
    const dateOrder = Date.parse(b.createdAt) - Date.parse(a.createdAt)
    return dateOrder || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  })
}
