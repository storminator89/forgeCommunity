"use client"

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: editorial · macrostructure: conversation workbench · design-system: design.md · designed-as-app */

import { AppShell, AppHeader } from '@/components/app-shell';
import { useState, useEffect, useRef } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { PageState } from '@/components/page-state'
import type { Session } from 'next-auth'
import { useSession } from 'next-auth/react'
import { Button } from "@/components/ui/button"
import { UserNav } from "@/components/user-nav"
import { Sidebar } from "@/components/Sidebar"
import { ThemeToggle } from "@/components/theme-toggle"
import { PlusCircle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'


// Import our new components
import { PostForm } from '@/components/community/PostForm'
import { PostCard } from '@/components/community/PostCard'
import { LeaderboardCard } from '@/components/community/LeaderboardCard'
import { StatsCard } from '@/components/community/StatsCard'
import { useCommunityFeed } from '@/hooks/useCommunityFeed'
import { CommunityPost as Post, CommunityStats, fetchCommunityJson as fetchWithErrorHandling, isAbortError, mergeCommunityRows } from '@/lib/community-feed'

interface LeaderboardUser {
  name: string
  image: string | null
  points: number
}

interface RewardSummary {
  points: number
  completedCourses: number
  firstCourseCompleted: boolean
  history?: Array<{
    type: 'AWARDED' | 'REVOKED' | 'REINSTATED'
    reason: 'QUIZ_REVISED' | 'APPROVAL_WITHDRAWN' | 'LEARNING_CHANGED' | 'ACCOUNT_INELIGIBLE' | 'COURSE_REMOVED' | null
    pointsDelta: number
    at: string
    courseTitle: string
  }>
}

function Community({ session }: { session: Session | null }) {
  const mainRef = useRef<HTMLElement>(null)
  const feedStatusRef = useRef<HTMLParagraphElement>(null)
  const focusEndOfFeedRef = useRef(false)
  const { posts: localPosts, setPosts: setLocalPosts, isLoading, isLoadingMore, loadError: postsLoadError, nextCursor, cancelPage, removePost, loadComments, commentsLoading, commentsError, initialLoaded, linkedTargetLoading, linkedTargetError, retryLinkedTarget, loadMore, retry: retryPosts } = useCommunityFeed()
  useEffect(() => {
    if (focusEndOfFeedRef.current && !isLoadingMore && initialLoaded && !nextCursor) {
      focusEndOfFeedRef.current = false
      // The focused load-more button has just disappeared at the end of the
      // list. Keep keyboard users at the result, without stealing another focus.
      if (document.activeElement === document.body) feedStatusRef.current?.focus()
    }
  }, [isLoadingMore, initialLoaded, nextCursor])
  const [isMutating, setIsMutating] = useState(false)
  const [activity, setActivity] = useState<CommunityStats | null>(null)
  const [activityLoading, setActivityLoading] = useState(!!session?.user?.id)
  const [activityError, setActivityError] = useState(false)
  const [activityRefresh, setActivityRefresh] = useState(0)
  const [isEditing, setIsEditing] = useState(false)
  const [editingPost, setEditingPost] = useState<Post | null>(null)
  const [leaderboardUsers, setLeaderboardUsers] = useState<LeaderboardUser[]>([])
  const [isLeaderboardLoading, setIsLeaderboardLoading] = useState(true)
  const [rewardResult, setRewardResult] = useState<{ userId: string; data: RewardSummary | null; error: boolean } | null>(null)
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null)

  const mountedRef = useRef(false)
  const mutationRequestRef = useRef<AbortController | null>(null)
  const leaderboardRequestRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const userId = session?.user?.id
    if (!userId) return
    const controller = new AbortController()
    void fetchWithErrorHandling<RewardSummary>('/api/rewards/me', { signal: controller.signal })
      .then((data: RewardSummary) => { if (!controller.signal.aborted) setRewardResult({ userId, data, error: false }) })
      .catch((error) => { if (!controller.signal.aborted && !isAbortError(error)) setRewardResult({ userId, data: null, error: true }) })
    return () => controller.abort()
  }, [session?.user?.id])

  const activeRewardResult = rewardResult && session?.user?.id === rewardResult.userId ? rewardResult : null
  const rewardsLoading = !!session?.user?.id && !activeRewardResult
  const rewards = activeRewardResult?.data ?? null
  const rewardsError = activeRewardResult?.error ?? false

  useEffect(() => {
    mountedRef.current = true
    const controller = new AbortController()
    leaderboardRequestRef.current = controller
    void fetchWithErrorHandling<LeaderboardUser[]>('/api/leaderboard', { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setLeaderboardUsers(data) })
      .catch(error => {
        if (!controller.signal.aborted && !isAbortError(error)) setNotification({ type: 'error', message: 'Fehler beim Laden des Leaderboards.' })
      })
      .finally(() => { if (!controller.signal.aborted) setIsLeaderboardLoading(false) })
    return () => {
      mountedRef.current = false
      controller.abort()
      mutationRequestRef.current?.abort()
      mutationRequestRef.current = null
    }
  }, [])

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
    setIsMutating(true)
    return controller
  }

  const finishMutation = (controller: AbortController) => {
    if (mutationRequestRef.current !== controller || controller.signal.aborted) return
    mutationRequestRef.current = null
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
  const handleSubmitPost = async (title: string, content: string) => {
    if (!session) {
      setNotification({ type: 'error', message: 'Bitte melde dich an, um einen Beitrag zu erstellen.' })
      return
    }
    const controller = beginMutation()
    if (!controller) return
    try {
      const response = await fetchWithErrorHandling<Post>(editingPost ? `/api/posts/${editingPost.id}` : '/api/posts', {
        method: editingPost ? 'PUT' : 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, content }),
      })
      if (controller.signal.aborted) return
      if (editingPost) {
        // Keep explicitly loaded older comments when the edit response contains
        // only the bounded comment preview.
        setLocalPosts(previous => previous.map(post => post.id === editingPost.id ? { ...post, ...response, comments: post.comments, commentsNextCursor: post.commentsNextCursor } : post))
      } else {
        setLocalPosts(previous => mergeCommunityRows([response], previous))
        refreshActivity()
      }
      setIsEditing(false)
      setEditingPost(null)
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
      setLocalPosts(previous => previous.map(post => post.id === postId ? {
        ...post, comments: mergeCommunityRows([response], post.comments), commentCount: (post.commentCount ?? post.comments.length) + 1,
      } : post))
      refreshActivity()
      setNotification({ type: 'success', message: 'Kommentar wurde hinzugefügt!' })
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

  const feedCount = isLoading ? 'Wird geladen…' : postsLoadError && localPosts.length === 0 ? 'Nicht verfügbar' : `${localPosts.length} ${localPosts.length === 1 ? 'Beitrag geladen' : 'Beiträge geladen'}`

  const openComposer = () => {
    setEditingPost(null)
    setIsEditing(true)
    mainRef.current?.scrollTo?.({ top: 0, behavior: 'smooth' })
  }

  return (
    <AppShell>
      <Sidebar />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AnimatePresence>
          {notification && (
            <motion.div
              initial={{ opacity: 0, y: -20, x: '-50%' }}
              animate={{ opacity: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, y: -20, x: '-50%' }}
              className={`fixed top-6 left-1/2 transform -translate-x-1/2 max-w-[calc(100vw-2rem)] border bg-card px-4 py-3 rounded-xl shadow-sm z-[100] flex items-center space-x-2 ${notification.type === 'success'
                ? 'border-border text-foreground'
                : 'border-destructive/30 text-destructive'
                }`}
            >
              <span className="font-medium" role={notification.type === 'error' ? 'alert' : 'status'}>{notification.message}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <AppHeader>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <h1>Community</h1>
            <div className="flex shrink-0 items-center gap-2">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </AppHeader>

        <main ref={mainRef} id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto scroll-smooth">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b pb-6">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Austausch / Community</p>
                <p className="mt-2 max-w-[58ch] text-base leading-relaxed text-muted-foreground">Fragen stellen, Erfahrungen teilen und gemeinsam weiterkommen.</p>
              </div>
              <p className="text-sm tabular-nums text-muted-foreground">{feedCount}</p>
            </div>

            <div className="grid min-w-0 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,19rem)] lg:gap-12">
              <section aria-labelledby="community-feed-title" className="min-w-0">
                <AnimatePresence mode="wait">
                  {!isEditing ? (
                    <motion.button
                      key="new-post-button"
                      type="button"
                      className="flex min-h-20 w-full min-w-0 items-center gap-3 rounded-[14px] border border-input bg-card p-4 text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      aria-label="Neuen Beitrag erstellen"
                      onClick={openComposer}
                    >
                      <Avatar className="h-10 w-10 shrink-0"><AvatarImage src={session?.user?.image || ''} alt="" /><AvatarFallback className="bg-accent text-primary">{session?.user?.name?.[0] || 'F'}</AvatarFallback></Avatar>
                      <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                        Was möchtest du teilen{session?.user?.name ? `, ${session.user.name.split(' ')[0]}` : ''}?
                      </span>
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-accent text-primary"><PlusCircle className="h-5 w-5" aria-hidden="true" /></span>
                    </motion.button>
                  ) : (
                    <PostForm
                      onSubmit={handleSubmitPost}
                      initialTitle={editingPost?.title}
                      initialContent={editingPost?.content}
                      isEditing={!!editingPost}
                      isLoading={isLoading || isMutating}
                      onCancel={() => {
                        setIsEditing(false)
                        setEditingPost(null)
                      }}
                    />
                  )}
                </AnimatePresence>

                <div className="mt-9">
                  <div className="flex flex-wrap items-baseline justify-between gap-3 border-b pb-4">
                    <h2 id="community-feed-title" className="text-xl font-semibold tracking-tight">Aktuelle Beiträge</h2>
                    <span className="text-sm tabular-nums text-muted-foreground">{feedCount}</span>
                  </div>
                  <div className="mt-5 space-y-5">
                    {linkedTargetLoading && <p className="text-sm text-muted-foreground" role="status">Verlinkter Beitrag wird geladen…</p>}
                    {linkedTargetError && <PageState kind="error" title="Verlinkter Inhalt ist nicht verfügbar" description="Der Inhalt wurde möglicherweise gelöscht oder ist für dieses Konto nicht sichtbar." action={<Button type="button" variant="outline" onClick={() => void retryLinkedTarget()}>Verlinkten Inhalt erneut laden</Button>} />}
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
                            setEditingPost(post)
                            setIsEditing(true)
                            mainRef.current?.scrollTo?.({ top: 0, behavior: 'smooth' })
                          }}
                          onAddComment={handleAddComment}
                          onLikeComment={handleLikeComment}
                          onLoadComments={loadComments}
                          commentsLoading={!!commentsLoading[post.id]}
                          commentsError={!!commentsError[post.id]}
                          isLoading={isLoading || isMutating}
                        />
                      ))}
                    </AnimatePresence>
                    {localPosts.length > 0 && <div className="border-t pt-5">
                      {postsLoadError && <p className="mb-3 text-sm text-destructive" role="alert">Beiträge konnten nicht vollständig geladen werden. Deine geladenen Beiträge bleiben sichtbar.</p>}
                      {nextCursor || !initialLoaded ? <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={isLoadingMore || isMutating} onClick={event => {
                        focusEndOfFeedRef.current = document.activeElement === event.currentTarget
                        void (postsLoadError ? retryPosts() : loadMore())
                      }}>
                        {isLoadingMore ? 'Weitere Beiträge werden geladen…' : postsLoadError ? 'Weitere Beiträge erneut laden' : 'Weitere Beiträge laden'}
                      </Button> : <p className="text-sm text-muted-foreground">Ende der Liste.</p>}
                      <p ref={feedStatusRef} tabIndex={-1} className="mt-3 text-sm text-muted-foreground" role="status" aria-live="polite">{isLoadingMore ? 'Weitere Beiträge werden geladen…' : feedCount}</p>
                    </div>}

                    {localPosts.length === 0 && !isLoading && !postsLoadError && (
                      <div className="border-t py-12 text-center" role="status">
                        <PlusCircle className="mx-auto mb-4 h-8 w-8 text-muted-foreground" aria-hidden="true" />
                        <h3 className="text-lg font-semibold text-foreground">Keine Beiträge gefunden</h3>
                        <p className="mt-2 text-sm text-muted-foreground">Sei der Erste, der etwas teilt!</p>
                        <Button type="button" variant="outline" className="mt-5" onClick={openComposer}>Beitrag schreiben</Button>
                      </div>
                    )}
                  </div>
                </div>
              </section>

<aside aria-label="Deine Community im Überblick" className="min-w-0 space-y-9 lg:sticky lg:top-8">
                <StatsCard stats={activity} activityLoading={activityLoading} activityError={activityError} onRetryActivity={refreshActivity} rewards={rewards} rewardsLoading={rewardsLoading} rewardsError={rewardsError} isSignedIn={!!session} />
                <LeaderboardCard
                  users={leaderboardUsers}
                  isLoading={isLeaderboardLoading}
                />
              </aside>
            </div>
          </div>
        </main>
      </div>

    </AppShell>
  )
}


export default function CommunityPage() {
  const { data, status } = useSession()
  const session = status === 'authenticated' ? data : null

  // The posts response can include this viewer's unpublished posts and likes.
  // Reset the whole feed before a different account can see cached rows.
  return <Community key={`${session?.user?.id ?? 'anonymous'}:${session?.user?.role ?? 'USER'}`} session={session} />
}
