"use client"

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: editorial · macrostructure: conversation workbench · design-system: design.md · designed-as-app */

import { HeroBanner, PageContainer, CommunityLandscape } from '@/components/discovery';
import { AppShell, AppHeader } from '@/components/app-shell';
import { useState, useEffect, useRef, useSyncExternalStore, useCallback } from 'react'
import Link from 'next/link'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { PageState } from '@/components/page-state'
import type { Session } from 'next-auth'
import { useSession } from 'next-auth/react'
import { Button } from "@/components/ui/button"
import { UserNav, useSignInHref } from "@/components/user-nav"
import { Sidebar } from "@/components/Sidebar"
import { ThemeToggle } from "@/components/theme-toggle"
import { PlusCircle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'


// Import our new components
import { PostForm } from '@/components/community/PostForm'
import { PostCard } from '@/components/community/PostCard'
import { LeaderboardCard, type LeaderboardState } from '@/components/community/LeaderboardCard'
import { StatsCard } from '@/components/community/StatsCard'
import { PersonalProgressDashboard } from '@/components/community/PersonalProgressDashboard'
import { FirstActionGuide } from '@/components/community/FirstActionGuide'
import { TopicNavigation } from '@/components/community/TopicNavigation'
import { FeedFilters } from '@/components/community/FeedFilters'
import { communityTopicHref, EMPTY_COMMUNITY_FILTERS, matchesCommunityFilters, readCommunityFilters, writeCommunityFilters, type CommunityFilters } from '@/lib/community-filters'
import { useCommunityFeed } from '@/hooks/useCommunityFeed'
import { usePrivateContributions } from '@/hooks/usePrivateContributions'
import { usePrivateRewards } from '@/hooks/usePrivateRewards'
import { CommunityPost as Post, CommunityStats, fetchCommunityJson as fetchWithErrorHandling, isAbortError, mergeCommunityRows } from '@/lib/community-feed'
import { validTopicName } from '@/lib/community-topics'
import { getPreferredScrollBehavior } from '@/lib/scroll-behavior'

interface LeaderboardUser {
  name: string
  image: string | null
  points: number
}

function isLeaderboardUsers(data: unknown): data is LeaderboardUser[] {
  return Array.isArray(data) && data.length <= 10 && data.every(user =>
    user !== null && typeof user === 'object' && typeof user.name === 'string' &&
    (user.image === null || typeof user.image === 'string') &&
    Number.isSafeInteger(user.points) && user.points >= 0)
}

function Community({ session, topic, filters, onSelectTopic, onSelectFilters, onClearFilters, onNavigationLock, navigationBlocked }: { session: Session | null; topic: string | null; filters: CommunityFilters; onSelectTopic: (topic: string | null) => void; onSelectFilters: (filters: CommunityFilters) => void; onClearFilters: () => void; onNavigationLock: (locked: boolean) => void; navigationBlocked: boolean }) {
  const contributions = usePrivateContributions(session?.user?.id)
  const rewards = usePrivateRewards(session?.user?.id)
  const mainRef = useRef<HTMLElement>(null)
  const feedStatusRef = useRef<HTMLParagraphElement>(null)
  const focusEndOfFeedRef = useRef(false)
  const { posts: localPosts, setPosts: setLocalPosts, isLoading, isLoadingMore, loadError: postsLoadError, nextCursor, cancelPage, removePost, loadComments, commentsLoading, commentsError, initialLoaded, linkedTargetLoading, linkedTargetError, retryLinkedTarget, loadMore, retry: retryPosts } = useCommunityFeed(topic, filters, session?.user?.id)
  useEffect(() => {
    if (focusEndOfFeedRef.current && !isLoadingMore && initialLoaded && !nextCursor) {
      focusEndOfFeedRef.current = false
      // The focused load-more button has just disappeared at the end of the
      // list. Keep keyboard users at the result, without stealing another focus.
      if (document.activeElement === document.body) feedStatusRef.current?.focus()
    }
  }, [isLoadingMore, initialLoaded, nextCursor])
  const [isMutating, setIsMutating] = useState(false)
  const [solutionSaving, setSolutionSaving] = useState<string | null>(null)
  const [solutionErrors, setSolutionErrors] = useState<Record<string, string>>({})
  const [activity, setActivity] = useState<CommunityStats | null>(null)
  const [activityLoading, setActivityLoading] = useState(!!session?.user?.id)
  const [activityError, setActivityError] = useState(false)
  const [activityRefresh, setActivityRefresh] = useState(0)
  const [isEditing, setIsEditing] = useState(false)
  const [editingPost, setEditingPost] = useState<Post | null>(null)
  const [leaderboardState, setLeaderboardState] = useState<LeaderboardState>({ status: 'loading' })
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null)

  const mountedRef = useRef(false)
  const mutationRequestRef = useRef<AbortController | null>(null)
  const leaderboardRequestRef = useRef<AbortController | null>(null)
  const composerOpenRef = useRef(false)
  const commentDraftsRef = useRef(new Set<symbol>())
  const [hasCommentDraft, setHasCommentDraft] = useState(false)
  const handleCommentDraftChange = useCallback((instance: symbol, dirty: boolean) => {
    if (dirty) commentDraftsRef.current.add(instance)
    else commentDraftsRef.current.delete(instance)
    if (!mountedRef.current) return
    const hasDrafts = commentDraftsRef.current.size > 0
    setHasCommentDraft(hasDrafts)
    onNavigationLock(composerOpenRef.current || !!mutationRequestRef.current || hasDrafts)
  }, [onNavigationLock])
  const setComposerOpen = (open: boolean) => {
    composerOpenRef.current = open
    setIsEditing(open)
    onNavigationLock(open || !!mutationRequestRef.current || commentDraftsRef.current.size > 0)
  }
  const topicHref = (next: string) => communityTopicHref(next, filters)

  useEffect(() => {
    mountedRef.current = true
    setHasCommentDraft(commentDraftsRef.current.size > 0)
    onNavigationLock(composerOpenRef.current || !!mutationRequestRef.current || commentDraftsRef.current.size > 0)
    return () => {
      mountedRef.current = false
      onNavigationLock(false)
      mutationRequestRef.current?.abort()
      mutationRequestRef.current = null
    }
  }, [])

  const loadLeaderboard = useCallback(async () => {
    // Lock synchronously: repeated clicks before React renders share one read.
    if (!mountedRef.current || leaderboardRequestRef.current) return
    const controller = new AbortController()
    leaderboardRequestRef.current = controller
    setLeaderboardState(previous => previous.status === 'error'
      ? { status: 'error', isRetrying: true }
      : { status: 'loading' })
    const isCurrent = () => mountedRef.current && leaderboardRequestRef.current === controller && !controller.signal.aborted
    try {
      const data = await fetchWithErrorHandling<unknown>('/api/leaderboard', { signal: controller.signal, cache: 'no-store' })
      if (!isLeaderboardUsers(data)) throw new Error('Ungültige Rangliste')
      if (isCurrent()) setLeaderboardState({ status: 'success', users: data.map(({ name, image, points }) => ({ name, image, points })) })
    } catch {
      if (isCurrent()) setLeaderboardState({ status: 'error', isRetrying: false })
    } finally {
      if (leaderboardRequestRef.current === controller) leaderboardRequestRef.current = null
    }
  }, [])

  useEffect(() => {
    void loadLeaderboard()
    return () => {
      // The existing viewer/role key and session-loading gate unmount this
      // account's view. Never let an obsolete read update a replacement view.
      leaderboardRequestRef.current?.abort()
      leaderboardRequestRef.current = null
    }
  }, [loadLeaderboard])

  useEffect(() => {
    if (!session?.user?.id) return
    const controller = new AbortController()
    void fetchWithErrorHandling<CommunityStats>('/api/posts/me/stats', { signal: controller.signal, cache: 'no-store' })
      .then(data => {
        if (![data.posts, data.receivedLikes, data.comments].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('Ungültige Aktivität')
        if (!controller.signal.aborted) setActivity(data)
      })
      .catch(error => {
        if (!controller.signal.aborted && !isAbortError(error)) { setActivity(null); setActivityError(true) }
      })
      .finally(() => { if (!controller.signal.aborted) setActivityLoading(false) })
    return () => controller.abort()
  }, [session?.user?.id, activityRefresh])

  const refreshActivity = () => {
    setActivityLoading(true)
    setActivityError(false)
    setActivityRefresh(value => value + 1)
  }

  const beginMutation = () => {
    if (!mountedRef.current || mutationRequestRef.current || isLoading) return null
    cancelPage()
    const controller = new AbortController()
    mutationRequestRef.current = controller
    onNavigationLock(composerOpenRef.current || !!mutationRequestRef.current || commentDraftsRef.current.size > 0)
    setIsMutating(true)
    return controller
  }

  const finishMutation = (controller: AbortController) => {
    if (mutationRequestRef.current !== controller || controller.signal.aborted) return
    mutationRequestRef.current = null
    onNavigationLock(composerOpenRef.current || !!mutationRequestRef.current || commentDraftsRef.current.size > 0)
    setIsMutating(false)
  }

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [notification])

  // Mutations abort a page read without advancing its cursor. A retry can safely
  // merge that page later without overwriting newer edits, likes or comments.
  const handleSubmitPost = async (title: string, content: string, tags: string[] = []) => {
    if (!session) {
      setNotification({ type: 'error', message: 'Bitte melde dich an, um einen Beitrag zu erstellen.' })
      return
    }
    const controller = beginMutation()
    if (!controller) return
    try {
      const response = await fetchWithErrorHandling<Post>(editingPost ? `/api/posts/${editingPost.id}` : '/api/posts', {
        method: editingPost ? 'PUT' : 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, content, tags }),
      })
      if (controller.signal.aborted) return
      if (editingPost) {
        if (!matchesCommunityFilters(response, topic, filters, session?.user?.id)) removePost(editingPost.id)
        // Keep explicitly loaded older comments when the edit response contains
        // only the bounded comment preview.
        setLocalPosts(previous => previous.flatMap(post => post.id === editingPost.id
          ? topic && !response.tags?.some(tag => tag.name === topic) ? [] : [{ ...post, ...response, comments: post.comments, commentsNextCursor: post.commentsNextCursor }]
          : [post]))
      } else {
        if (!topic || response.tags?.some(tag => tag.name === topic)) setLocalPosts(previous => mergeCommunityRows([response], previous))
        refreshActivity()
      }
      setComposerOpen(false)
      setEditingPost(null)
      contributions.refresh()
      setNotification({ type: 'success', message: editingPost ? 'Beitrag aktualisiert!' : 'Beitrag erstellt!' })
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error)) setNotification({ type: 'error', message: 'Fehler beim Erstellen/Aktualisieren des Beitrags.' })
    } finally { finishMutation(controller) }
  }

  const handleToggleLike = async (postId: string) => {
    if (!session) {
      setNotification({ type: 'error', message: 'Bitte melde dich an, um Likes zu vergeben.' })
      return
    }
    const controller = beginMutation()
    if (!controller) return
    try {
      const response = await fetchWithErrorHandling<{ message?: string }>(`/api/posts/${postId}/like`, { method: 'POST', signal: controller.signal })
      if (controller.signal.aborted) return
      const isLiked = response.message !== 'Like entfernt'
      setLocalPosts(previous => previous.map(post => post.id === postId ? { ...post, votes: Math.max(0, post.votes + (isLiked ? 1 : -1)), isLiked } : post))
      refreshActivity()
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error)) setNotification({ type: 'error', message: 'Fehler beim Liken.' })
    } finally { finishMutation(controller) }
  }

  const handleDeletePost = async (postId: string) => {
    if (!session) {
      setNotification({ type: 'error', message: 'Bitte melde dich an, um Beiträge zu löschen.' })
      return
    }
    if (!window.confirm('Möchtest du diesen Beitrag wirklich löschen?')) return
    const controller = beginMutation()
    if (!controller) return
    try {
      await fetchWithErrorHandling(`/api/posts/${postId}`, { method: 'DELETE', signal: controller.signal })
      if (controller.signal.aborted) return
      removePost(postId)
      refreshActivity()
      contributions.refresh()
      setNotification({ type: 'success', message: 'Beitrag wurde gelöscht!' })
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error)) setNotification({ type: 'error', message: 'Fehler beim Löschen des Beitrags.' })
    } finally { finishMutation(controller) }
  }

  const handleAddComment = async (postId: string, content: string) => {
    if (!session) {
      setNotification({ type: 'error', message: 'Bitte melde dich an, um zu kommentieren.' })
      throw new Error('Nicht authentifiziert')
    }
    const controller = beginMutation()
    if (!controller) throw new Error('Eine Aktion läuft bereits')
    try {
      const response = await fetchWithErrorHandling<Post['comments'][number]>(`/api/posts/${postId}/comments`, {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }),
      })
      if (controller.signal.aborted) return
      if (filters.unanswered) {
        const card = document.getElementById(`post-${postId}`)
        const restoreFocus = !!card?.contains(document.activeElement)
        // Also tombstone the row so an older overlapping detail read cannot reinsert it.
        removePost(postId)
        if (restoreFocus) window.requestAnimationFrame(() => {
          if (document.activeElement === document.body || card?.contains(document.activeElement)) document.getElementById('community-feed-title')?.focus()
        })
      } else setLocalPosts(previous => previous.map(post => post.id === postId ? {
        ...post, comments: mergeCommunityRows([response], post.comments), commentCount: (post.commentCount ?? post.comments.length) + 1,
      } : post))
      refreshActivity()
      setNotification({ type: 'success', message: filters.unanswered ? 'Kommentar hinzugefügt. Der Beitrag wird im Filter „Ohne Antworten“ nicht mehr angezeigt.' : 'Kommentar wurde hinzugefügt!' })
      contributions.refresh()
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error)) setNotification({ type: 'error', message: 'Fehler beim Hinzufügen des Kommentars.' })
      throw error
    } finally { finishMutation(controller) }
  }

  const handleLikeComment = async (commentId: string, postId: string) => {
    if (!session) {
      setNotification({ type: 'error', message: 'Bitte melde dich an, um Kommentare zu liken.' })
      return
    }
    const controller = beginMutation()
    if (!controller) return
    try {
      const response = await fetchWithErrorHandling<{ isLiked: boolean }>(`/api/posts/${postId}/comments/${commentId}/like`, { method: 'POST', signal: controller.signal })
      if (controller.signal.aborted) return
      setLocalPosts(previous => previous.map(post => ({ ...post, comments: post.comments.map(comment => comment.id === commentId ? {
        ...comment, votes: Math.max(0, comment.votes + (response.isLiked ? 1 : -1)), isLiked: response.isLiked,
      } : comment) })))
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error)) setNotification({ type: 'error', message: 'Fehler beim Liken des Kommentars.' })
    } finally { finishMutation(controller) }
  }

  const handleSelectSolution = async (postId: string, commentId: string | null) => {
    const post = localPosts.find(row => row.id === postId)
    if (!session?.user?.id || post?.authorId !== session.user.id) return
    const controller = beginMutation()
    if (!controller) return
    setSolutionSaving(postId)
    setSolutionErrors(previous => ({ ...previous, [postId]: '' }))
    const applyState = (current: Post) => setLocalPosts(previous => previous.map(row => row.id === postId ? {
      ...row, solutionRevision: current.solutionRevision, acceptedSolution: current.acceptedSolution,
      acceptedSolutionCount: current.acceptedSolutionCount, published: current.published,
    } : row))
    try {
      const response = await fetch(`/api/posts/${encodeURIComponent(postId)}/solution`, {
        method: 'PUT', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId, expectedRevision: post.solutionRevision ?? null }),
      })
      const result = await response.json()
      if (controller.signal.aborted) return
      if (result.post?.id === postId) applyState(result.post)
      if (!response.ok) throw new Error(result.error || 'Lösung konnte nicht gespeichert werden.')
      if (result.post?.id !== postId) throw new Error('Ungültiger Lösungsstand. Bitte erneut versuchen.')
      contributions.refresh()
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error)) setSolutionErrors(previous => ({
        ...previous, [postId]: error instanceof Error ? error.message : 'Lösung konnte nicht gespeichert werden.',
      }))
    } finally {
      if (!controller.signal.aborted) setSolutionSaving(null)
      finishMutation(controller)
    }
  }

  const feedCount = isLoading ? 'Wird geladen…' : postsLoadError && localPosts.length === 0 ? 'Nicht verfügbar' : `${localPosts.length} ${localPosts.length === 1 ? 'Beitrag geladen' : 'Beiträge geladen'}`

  const openComposer = () => {
    setEditingPost(null)
    setComposerOpen(true)
    mainRef.current?.scrollTo?.({ top: 0, behavior: getPreferredScrollBehavior() })
  }

  return (
    <AppShell>
      <Sidebar />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="app-header-row">
            <div className="app-header-title"><h1>Community</h1><p className="mt-1 text-sm text-muted-foreground">Austauschen. Lernen. Gemeinsam wachsen.</p></div>
            <div className="app-header-actions">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </AppHeader>

        <main ref={mainRef} id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto scroll-smooth">
          <PageContainer>
            {session?.user?.id && session.user.role === 'USER' && <FirstActionGuide userId={session.user.id} />}
            <div className="fc-community-layout">
              <section aria-labelledby="community-feed-title" className="min-w-0">
                <HeroBanner title="Gemeinsam mehr erreichen." description="Stelle Fragen, teile Wissen, diskutiere Ideen und vernetze dich mit anderen Mitgliedern." className="fc-community-hero"><CommunityLandscape /></HeroBanner>
                <PersonalProgressDashboard rewards={rewards} contributions={contributions}
                  isSignedIn={!!session?.user?.id} role={session?.user?.role} />
                {notification && (
                  <div className={`sticky top-0 z-10 mb-3 rounded-lg border bg-card px-4 py-3 text-sm font-medium ${notification.type === 'success' ? 'border-success/30 text-success' : 'border-destructive/30 text-destructive'}`}
                    role={notification.type === 'error' ? 'alert' : 'status'}>
                    {notification.message}
                  </div>
                )}

                <AnimatePresence mode="wait">
                  {!isEditing ? (
                    <motion.button
                      key="new-post-button"
                      type="button"
                      className="fc-composer fc-surface hover:border-primary/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      aria-label="Neuen Beitrag erstellen"
                      onClick={openComposer}
                    >
                      <Avatar className="h-10 w-10 shrink-0"><AvatarImage src={session?.user?.image || ''} alt="" /><AvatarFallback className="bg-coral-highlight text-coral-highlight-foreground">{session?.user?.name?.[0] || 'F'}</AvatarFallback></Avatar>
                      <span className="fc-composer-prompt min-w-0 [overflow-wrap:anywhere]">
                        Beitrag schreiben{session?.user?.name ? `, ${session.user.name.split(' ')[0]}` : ''}
                      </span>
                      <span className="fc-composer-action"><PlusCircle className="h-4 w-4" aria-hidden="true" />Beitrag schreiben</span>
                    </motion.button>
                  ) : (
                    <PostForm
                      onSubmit={handleSubmitPost}
                      initialTitle={editingPost?.title}
                      initialContent={editingPost?.content}
                      initialTags={editingPost ? editingPost.tags?.map(tag => tag.name) : topic && validTopicName(topic) ? [topic] : []}
                      isEditing={!!editingPost}
                      isLoading={isLoading || isMutating}
                      onCancel={() => {
                        setComposerOpen(false)
                        setEditingPost(null)
                      }}
                    />
                  )}
                </AnimatePresence>

                <TopicNavigation key={isEditing ? 'composing' : 'browsing'} selected={topic} onSelect={onSelectTopic} disabled={isEditing || isMutating} topicHref={topicHref} />
                <FeedFilters filters={filters} topic={topic} disabled={isEditing || isMutating} onChange={onSelectFilters} onClear={onClearFilters} />
                {navigationBlocked && <p className="mt-2 text-sm text-muted-foreground" role="status">{hasCommentDraft ? 'Sende oder leere deinen Kommentarentwurf, bevor du die Filter wechselst.' : 'Der Filterwechsel wurde angehalten. Schließe zuerst deinen Entwurf oder warte auf die laufende Aktion.'}</p>}

                <div className="mt-4">
                  <div className="mb-2 mt-7 flex flex-wrap items-center justify-between gap-2"><h2 id="community-feed-title" tabIndex={-1} className="text-xl font-semibold tracking-tight focus-visible:ring-2 focus-visible:ring-ring">Aktuelle Beiträge</h2><p className="text-xs tabular-nums text-muted-foreground">{feedCount}</p></div>
                  <div className="mt-4 space-y-5">
                    {linkedTargetLoading && <p className="text-sm text-muted-foreground" role="status">Verlinkter Beitrag wird geladen…</p>}
                    {linkedTargetError && <PageState kind="error" title="Verlinkter Inhalt ist nicht verfügbar" description="Der Inhalt wurde möglicherweise gelöscht, ist für dieses Konto nicht sichtbar oder passt nicht zu den ausgewählten Filtern." action={<Button type="button" variant="outline" onClick={() => void retryLinkedTarget()}>Verlinkten Inhalt erneut laden</Button>} />}
                    {isLoading && localPosts.length === 0 && <PageState kind="loading" title="Beiträge werden geladen" />}
                    {postsLoadError && !isLoading && localPosts.length === 0 && <PageState kind="error" title="Beiträge konnten nicht geladen werden" description="Prüfe deine Verbindung und versuche es erneut." action={<Button type="button" variant="outline" onClick={retryPosts}>Erneut versuchen</Button>} />}
                    <AnimatePresence>
                      {localPosts.map((post) => (
                        <PostCard
                          key={post.id}
                          post={post}
                          currentUserId={session?.user.id}
                          onLike={handleToggleLike}
                          onDelete={handleDeletePost}
                          onEdit={(post) => {
                            if (isEditing || isMutating) return
                            setEditingPost(post)
                            setComposerOpen(true)
                            mainRef.current?.scrollTo?.({ top: 0, behavior: getPreferredScrollBehavior() })
                          }}
                          onSelectTopic={onSelectTopic}
                          topicHref={topicHref}
                          topicNavigationDisabled={isEditing || isMutating}
                          onAddComment={handleAddComment}
                          onCommentDraftChange={handleCommentDraftChange}
                          onLikeComment={handleLikeComment}
                          onSelectSolution={handleSelectSolution}
                          solutionSaving={solutionSaving === post.id}
                          solutionError={solutionErrors[post.id]}
                          onLoadComments={loadComments}
                          commentsLoading={!!commentsLoading[post.id]}
                          commentsError={!!commentsError[post.id]}
                          isLoading={isLoading || isMutating}
                        />
                      ))}
                    </AnimatePresence>
                    {(localPosts.length > 0 || (initialLoaded && nextCursor)) && <div className="border-t pt-5">
                      {postsLoadError && <p className="mb-3 text-sm text-destructive" role="alert">Beiträge konnten nicht vollständig geladen werden. Deine geladenen Beiträge bleiben sichtbar.</p>}
                      {nextCursor || !initialLoaded ? <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={isLoadingMore || isMutating} onClick={event => {
                        focusEndOfFeedRef.current = document.activeElement === event.currentTarget
                        void (postsLoadError ? retryPosts() : loadMore())
                      }}>
                        {isLoadingMore ? 'Weitere Beiträge werden geladen…' : postsLoadError ? 'Weitere Beiträge erneut laden' : 'Weitere Beiträge laden'}
                      </Button> : null}
                      <p ref={feedStatusRef} tabIndex={-1} className={nextCursor || !initialLoaded ? 'sr-only' : 'mt-3 text-sm text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring'} role="status" aria-live="polite">
                        {isLoadingMore ? 'Weitere Beiträge werden geladen…' : <><span className="sr-only">{feedCount}. </span>{nextCursor || !initialLoaded ? 'Weitere Beiträge verfügbar.' : 'Ende der Liste.'}</>}
                      </p>
                    </div>}

                    {localPosts.length === 0 && !isLoading && !postsLoadError && (
                      <div className="border-t py-12 text-center" role="status">
                        <PlusCircle className="mx-auto mb-4 h-8 w-8 text-muted-foreground" aria-hidden="true" />
                        <h3 className="text-lg font-semibold text-foreground">{nextCursor ? 'Keine passenden Beiträge in der geladenen Liste' : 'Keine Beiträge gefunden'}</h3>
                        {(topic || filters.mine || filters.unanswered) ? <>
                          <p className="mt-2 text-sm text-muted-foreground">{nextCursor ? 'Lade weitere Beiträge oder setze die Filter zurück.' : <>Keine sichtbaren Beiträge passen zu den ausgewählten Filtern{topic ? ` im Thema „${topic}“` : ''}.</>}</p>
                          <Button type="button" variant="outline" className="mt-5" disabled={isEditing || isMutating} onClick={onClearFilters}>Alle Filter zurücksetzen</Button>
                        </> : <Button type="button" variant="outline" className="mt-5" onClick={openComposer}>Beitrag schreiben</Button>}
                      </div>
                    )}
                  </div>
                </div>
              </section>

<aside aria-label="Deine Community im Überblick" className="fc-community-aside">
                <StatsCard stats={activity} activityLoading={activityLoading} activityError={activityError} onRetryActivity={refreshActivity} isSignedIn={!!session?.user?.id} />
                <LeaderboardCard
                  users={leaderboardState.status === 'success' ? leaderboardState.users : []}
                  isLoading={leaderboardState.status === 'loading'}
                  error={leaderboardState.status === 'error' ? { isRetrying: leaderboardState.isRetrying, onRetry: () => { void loadLeaderboard() } } : undefined}
                />
              </aside>
            </div>
          </PageContainer>
        </main>
      </div>

    </AppShell>
  )
}


export default function CommunityPage() {
  const { data, status } = useSession()
  const session = status === 'authenticated' ? data : null
  const signInHref = useSignInHref()
  const navigationLocked = useRef(false)
  const activeNavigation = useRef<{ href: string; state: unknown } | null>(null)
  const [navigationBlocked, setNavigationBlocked] = useState(false)
  const setNavigationLock = useCallback((locked: boolean) => {
    if (locked && !navigationLocked.current) activeNavigation.current = { href: window.location.href, state: window.history.state }
    navigationLocked.current = locked
    if (!locked) setNavigationBlocked(false)
  }, [])
  const search = useSyncExternalStore(
    callback => {
      const current = () => ({ href: window.location.href, state: window.history.state })
      if (!activeNavigation.current) activeNavigation.current = current()
      const changed = (event: Event) => {
        const active = activeNavigation.current!
        const incoming = new URL(window.location.href)
        const held = new URL(active.href)
        if (navigationLocked.current && incoming.pathname === held.pathname && incoming.search !== held.search) {
          // Keep the draft mounted and stop the app router from restoring the
          // rejected query. The attempted same-page history entry is replaced.
          event.stopImmediatePropagation()
          window.history.replaceState(active.state, '', active.href)
          setNavigationBlocked(true)
          return
        }
        activeNavigation.current = current()
        callback()
      }
      window.addEventListener('popstate', changed, true)
      window.addEventListener('community-topic-change', changed)
      return () => { window.removeEventListener('popstate', changed, true); window.removeEventListener('community-topic-change', changed) }
    },
    () => navigationLocked.current && activeNavigation.current ? new URL(activeNavigation.current.href).search : window.location.search,
    () => '',
  )
  const params = new URLSearchParams(search)
  const topic = params.get('tag')
  let filters = EMPTY_COMMUNITY_FILTERS
  let invalidFilters = false
  try { filters = readCommunityFilters(params) } catch { invalidFilters = true }
  const focusAfterNavigation = useRef(false)
  useEffect(() => {
    if (focusAfterNavigation.current) {
      focusAfterNavigation.current = false
      document.getElementById('community-feed-title')?.focus()
    }
  }, [topic, filters.mine, filters.unanswered, invalidFilters])
  const selectFeed = (nextTopic: string | null, nextFilters: CommunityFilters) => {
    if (navigationLocked.current) { setNavigationBlocked(true); return }
    if (nextTopic === topic && nextFilters.mine === filters.mine && nextFilters.unanswered === filters.unanswered && !invalidFilters) return
    const url = new URL(window.location.href)
    if (nextTopic) url.searchParams.set('tag', nextTopic)
    else url.searchParams.delete('tag')
    writeCommunityFilters(url.searchParams, nextFilters)
    url.searchParams.delete('cursor')
    url.hash = ''
    focusAfterNavigation.current = true
    window.history.pushState(window.history.state, '', url)
    window.dispatchEvent(new Event('community-topic-change'))
  }
  const selectTopic = (next: string | null) => selectFeed(next, filters)

  // The session can resolve after the page first hydrates. Do not expose an
  // interactive anonymous composer that will be remounted (and lose edits)
  // when its account-scoped key changes to the signed-in viewer.
  if (status === 'loading') return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader><div className="app-header-row"><h1 className="app-header-title">Community</h1></div></AppHeader>
        <main id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-6 lg:px-8">
          <PageState kind="loading" title="Community wird geladen" />
        </main>
      </div>
    </AppShell>
  )

  if (!session?.user?.id) return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader><div className="app-header-row"><h1 className="app-header-title">Community</h1><div className="app-header-actions"><ThemeToggle /><UserNav /></div></div></AppHeader>
        <main id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl"><PageState title="Melde dich für die Community an" description="Stelle Fragen, teile Wissen und setze deinen Lernweg fort."
            action={<Button asChild><Link prefetch={false} href={signInHref}>Anmelden</Link></Button>} /></div>
        </main>
      </div>
    </AppShell>
  )

  // The posts response can include this viewer's unpublished posts and likes.
  // Reset the whole feed before a different account can see cached rows.
  if (invalidFilters) return <AppShell><Sidebar /><main id="page-content" className="min-w-0 flex-1 p-6"><PageState kind="error" title="Ungültige Beitragsfilter" description="Öffne einen gültigen Community-Link oder setze die Filter zurück." action={<Button type="button" variant="outline" onClick={() => selectFeed(null, EMPTY_COMMUNITY_FILTERS)}>Alle Filter zurücksetzen</Button>} /></main></AppShell>

  return <Community key={`${session?.user?.id ?? 'anonymous'}:${session?.user?.role ?? 'USER'}:${topic ?? ''}:${filters.mine}:${filters.unanswered}`} session={session} topic={topic} filters={filters} onSelectTopic={selectTopic} onSelectFilters={next => selectFeed(topic, next)} onClearFilters={() => selectFeed(null, EMPTY_COMMUNITY_FILTERS)} onNavigationLock={setNavigationLock} navigationBlocked={navigationBlocked} />
}
