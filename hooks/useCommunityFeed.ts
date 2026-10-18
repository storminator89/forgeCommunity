'use client'

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { CommunityPost, CommentsPage, FeedPage, fetchCommunityJson, isAbortError, mergeCommunityRows } from '@/lib/community-feed'

import { EMPTY_COMMUNITY_FILTERS, matchesCommunityFilters, writeCommunityFilters, type CommunityFilters } from '@/lib/community-filters'

export function useCommunityFeed(tag: string | null = null, filters: CommunityFilters = EMPTY_COMMUNITY_FILTERS, viewerId?: string) {
  const { mine, unanswered } = filters
  const [posts, setStoredPosts] = useState<CommunityPost[]>([])
  // Every page, detail read and local mutation must preserve the selected list.
  const setPosts: Dispatch<SetStateAction<CommunityPost[]>> = useCallback(update => {
    setStoredPosts(previous => (typeof update === 'function' ? update(previous) : update)
      .filter(post => matchesCommunityFilters(post, tag, { mine, unanswered }, viewerId)))
  }, [tag, mine, unanswered, viewerId])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [initialLoaded, setInitialLoaded] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [commentsLoading, setCommentsLoading] = useState<Record<string, boolean>>({})
  const [commentsError, setCommentsError] = useState<Record<string, boolean>>({})
  const [linkedTargetLoading, setLinkedTargetLoading] = useState(false)
  const [linkedTargetError, setLinkedTargetError] = useState(false)
  const linkedTargetRequest = useRef<AbortController | null>(null)
  const postsRef = useRef(posts)
  const pageRequest = useRef<AbortController | null>(null)
  const commentRequests = useRef(new Map<string, AbortController>())
  const deletedIds = useRef(new Set<string>())
  const mounted = useRef(false)

  const cancelPage = useCallback(() => {
    pageRequest.current?.abort()
    pageRequest.current = null
    setIsLoadingMore(false)
  }, [])

  const requestPage = useCallback(async (cursor: string | null) => {
    if (pageRequest.current || !mounted.current) return
    const controller = new AbortController()
    pageRequest.current = controller
    try {
      const params = new URLSearchParams({ feed: '1' })
      if (tag) params.set('tag', tag)
      if (cursor) params.set('cursor', cursor)
      writeCommunityFilters(params, { mine, unanswered })
      const page = await fetchCommunityJson<FeedPage>(`/api/posts?${params}`, { signal: controller.signal, cache: 'no-store' })
      if (!Array.isArray(page.posts) || !(page.nextCursor === null || typeof page.nextCursor === 'string')) throw new Error('Ungültige Antwort')
      if (controller.signal.aborted || !mounted.current || pageRequest.current !== controller) return
      setPosts(previous => mergeCommunityRows(previous, page.posts.filter(post => !deletedIds.current.has(post.id))))
      setNextCursor(page.nextCursor)
      setInitialLoaded(true)
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && !isAbortError(error) && pageRequest.current === controller) setLoadError(true)
    } finally {
      if (mounted.current && pageRequest.current === controller) {
        pageRequest.current = null
        setIsLoading(false)
        setIsLoadingMore(false)
      }
    }
  }, [tag, mine, unanswered, viewerId, setPosts])

  useEffect(() => { postsRef.current = posts }, [posts])

  const loadLinkedTarget = useCallback((): Promise<void> => {
    linkedTargetRequest.current?.abort()
    linkedTargetRequest.current = null
    const match = /^#(post|comment)-([A-Za-z0-9_-]{1,256})$/.exec(window.location.hash)
    if (!match || !mounted.current) return Promise.resolve()
    const [, type, id] = match
    if (type === 'post' ? postsRef.current.some(post => post.id === id) : postsRef.current.some(post => post.comments.some(comment => comment.id === id))) return Promise.resolve()
    const controller = new AbortController()
    linkedTargetRequest.current = controller
    return fetchCommunityJson<CommunityPost>(type === 'post' ? `/api/posts/${encodeURIComponent(id)}` : `/api/posts/linked-comment/${encodeURIComponent(id)}`, { signal: controller.signal, cache: 'no-store' })
      .then(post => {
        if (!post.id || !Array.isArray(post.comments)) throw new Error('Ungültiger Beitrag')
        if (controller.signal.aborted || !mounted.current || deletedIds.current.has(post.id)) return
        if (!matchesCommunityFilters(post, tag, { mine, unanswered }, viewerId)) {
          setPosts(previous => previous.filter(row => row.id !== post.id))
          setLinkedTargetError(true)
          return
        }
        setPosts(previous => {
          const existing = previous.find(row => row.id === post.id)
          const linkedPost = existing ? {
            ...post, ...existing,
            comments: mergeCommunityRows(existing.comments, post.comments),
            // A detail/link read contains the real preview. Do not leave an
            // already hydrated discussion marked as deferred.
            commentsDeferred: false,
            commentsNextCursor: existing.commentsDeferred ? post.commentsNextCursor : existing.commentsNextCursor,
          } : post
          return mergeCommunityRows([linkedPost], previous)
        })
      })
      .catch(error => {
        if (mounted.current && !controller.signal.aborted && !isAbortError(error)) setLinkedTargetError(true)
      })
      .finally(() => {
        if (mounted.current && linkedTargetRequest.current === controller) {
          linkedTargetRequest.current = null
          setLinkedTargetLoading(false)
        }
      })
  }, [tag, mine, unanswered, viewerId, setPosts])

  useEffect(() => {
    mounted.current = true
    setStoredPosts([])
    postsRef.current = []
    deletedIds.current.clear()
    setNextCursor(null)
    setIsLoading(true)
    setIsLoadingMore(false)
    setLoadError(false)
    setInitialLoaded(false)
    setCommentsLoading({})
    setCommentsError({})
    setLinkedTargetLoading(!!window.location.hash)
    setLinkedTargetError(false)
    void requestPage(null)
    void loadLinkedTarget().finally(() => { if (mounted.current) setLinkedTargetLoading(false) })
    const followHash = () => {
      setLinkedTargetError(false)
      setLinkedTargetLoading(true)
      void loadLinkedTarget().finally(() => { if (mounted.current) setLinkedTargetLoading(false) })
    }
    window.addEventListener('hashchange', followHash)
    const requests = commentRequests.current
    return () => {
      mounted.current = false
      window.removeEventListener('hashchange', followHash)
      linkedTargetRequest.current?.abort()
      pageRequest.current?.abort()
      pageRequest.current = null
      for (const controller of requests.values()) controller.abort()
      requests.clear()
    }
  }, [requestPage, loadLinkedTarget])

  const removePost = (id: string) => {
    deletedIds.current.add(id)
    commentRequests.current.get(id)?.abort()
    commentRequests.current.delete(id)
    setPosts(previous => previous.filter(post => post.id !== id))
  }

  const loadComments = async (postId: string) => {
    const post = posts.find(row => row.id === postId)
    if (!post || (!post.commentsDeferred && !post.commentsNextCursor) || commentRequests.current.has(postId) || !mounted.current) return
    const controller = new AbortController()
    commentRequests.current.set(postId, controller)
    setCommentsLoading(previous => ({ ...previous, [postId]: true }))
    setCommentsError(previous => ({ ...previous, [postId]: false }))
    try {
      const page = await fetchCommunityJson<CommentsPage>(`/api/posts/${encodeURIComponent(postId)}/comments?feed=1${post.commentsDeferred ? '&preview=1' : `&cursor=${encodeURIComponent(post.commentsNextCursor!)}`}`, { signal: controller.signal, cache: 'no-store' })
      if (!Array.isArray(page.comments) || !(page.nextCursor === null || typeof page.nextCursor === 'string')) throw new Error('Ungültige Antwort')
      if (controller.signal.aborted || !mounted.current || commentRequests.current.get(postId) !== controller) return
      setPosts(previous => previous.map(row => row.id === postId ? {
        ...row, comments: mergeCommunityRows(row.comments, page.comments), commentsNextCursor: page.nextCursor,
        commentsDeferred: false,
      } : row))
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && !isAbortError(error)) setCommentsError(previous => ({ ...previous, [postId]: true }))
    } finally {
      if (mounted.current && commentRequests.current.get(postId) === controller) {
        commentRequests.current.delete(postId)
        setCommentsLoading(previous => ({ ...previous, [postId]: false }))
      }
    }
  }

  const beginPage = () => {
    if (pageRequest.current || !mounted.current) return
    setLoadError(false)
    if (nextCursor) setIsLoadingMore(true)
    else setIsLoading(true)
    return requestPage(nextCursor)
  }

  const retryLinkedTarget = () => {
    setLinkedTargetError(false)
    setLinkedTargetLoading(true)
    return loadLinkedTarget().finally(() => { if (mounted.current) setLinkedTargetLoading(false) })
  }

  return { posts, setPosts, isLoading, isLoadingMore, loadError, nextCursor, initialLoaded, cancelPage, removePost, loadComments, commentsLoading, commentsError, linkedTargetLoading, linkedTargetError, retryLinkedTarget, loadMore: beginPage, retry: beginPage }
}
