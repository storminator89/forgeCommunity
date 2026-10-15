"use client"

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: editorial · macrostructure: conversation workbench · design-system: design.md · designed-as-app */

import { AppShell, AppHeader } from '@/components/app-shell';
import { useState, useEffect, useRef } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { PageState } from '@/components/page-state'
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

interface Post {
  id: string
  title: string
  content: string
  authorId: string
  author: {
    id: string
    name: string
    image: string | null
  } | null
  createdAt: string
  votes: number
  isLiked: boolean
  comments: Comment[]
}

interface Comment {
  id: string
  authorId: string
  author: {
    name: string
    image: string | null
  } | null
  content: string
  createdAt: string
  votes: number
  isLiked: boolean
}

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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

async function fetchWithErrorHandling(url: string, options?: RequestInit) {
  const response = await fetch(url, options)
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Ein Fehler ist aufgetreten')
  }
  return response.json()
}

function Community() {
  const { data: session } = useSession()
  const mainRef = useRef<HTMLElement>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [localPosts, setLocalPosts] = useState<Post[]>([])
  const [isEditing, setIsEditing] = useState(false)
  const [editingPost, setEditingPost] = useState<Post | null>(null)
  const [leaderboardUsers, setLeaderboardUsers] = useState<LeaderboardUser[]>([])
  const [isLeaderboardLoading, setIsLeaderboardLoading] = useState(true)
  const [rewardResult, setRewardResult] = useState<{ userId: string; data: RewardSummary | null; error: boolean } | null>(null)
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null)

  const postsRequestRef = useRef<AbortController | null>(null)
  const leaderboardRequestRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const userId = session?.user?.id
    if (!userId) return
    const controller = new AbortController()
    void fetchWithErrorHandling('/api/rewards/me', { signal: controller.signal })
      .then((data: RewardSummary) => { if (!controller.signal.aborted) setRewardResult({ userId, data, error: false }) })
      .catch((error) => { if (!controller.signal.aborted && !isAbortError(error)) setRewardResult({ userId, data: null, error: true }) })
    return () => controller.abort()
  }, [session?.user?.id])

  const activeRewardResult = rewardResult && session?.user?.id === rewardResult.userId ? rewardResult : null
  const rewardsLoading = !!session?.user?.id && !activeRewardResult
  const rewards = activeRewardResult?.data ?? null
  const rewardsError = activeRewardResult?.error ?? false

  // Effects
  useEffect(() => {
    let active = true
    const postsController = new AbortController()
    const leaderboardController = new AbortController()
    postsRequestRef.current = postsController
    leaderboardRequestRef.current = leaderboardController

    const loadPosts = async () => {
      try {
        const data = []
        for (let page = 1; ; page++) {
          const batch = await fetchWithErrorHandling(`/api/posts?page=${page}`, { signal: postsController.signal })
          data.push(...batch)
          if (batch.length < 50) break
        }
        if (!active || postsRequestRef.current !== postsController) return
        setLocalPosts(data)
      } catch (error) {
        if (!active || postsController.signal.aborted || postsRequestRef.current !== postsController || isAbortError(error)) return
        setNotification({ type: 'error', message: 'Fehler beim Laden der Beiträge.' })
      } finally {
        if (active && postsRequestRef.current === postsController) {
          postsRequestRef.current = null
          setIsLoading(false)
        }
      }
    }

    const loadLeaderboard = async () => {
      try {
        const data = await fetchWithErrorHandling('/api/leaderboard', { signal: leaderboardController.signal })
        if (!active || leaderboardRequestRef.current !== leaderboardController) return
        setLeaderboardUsers(data)
      } catch (error) {
        if (!active || leaderboardController.signal.aborted || leaderboardRequestRef.current !== leaderboardController || isAbortError(error)) return
        setNotification({ type: 'error', message: 'Fehler beim Laden des Leaderboards.' })
      } finally {
        if (active && leaderboardRequestRef.current === leaderboardController) {
          leaderboardRequestRef.current = null
          setIsLeaderboardLoading(false)
        }
      }
    }

    void loadPosts()
    void loadLeaderboard()

    return () => {
      active = false
      postsController.abort()
      leaderboardController.abort()
      if (postsRequestRef.current === postsController) postsRequestRef.current = null
      if (leaderboardRequestRef.current === leaderboardController) leaderboardRequestRef.current = null
    }
  }, [])

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [notification])

  // Action handlers
  const handleSubmitPost = async (title: string, content: string) => {
    if (!session) {
      setNotification({ type: 'error', message: 'Bitte melde dich an, um einen Beitrag zu erstellen.' })
      return
    }

    setIsLoading(true)
    try {
      const endpoint = editingPost ? `/api/posts/${editingPost.id}` : '/api/posts'
      const method = editingPost ? 'PUT' : 'POST'

      const response = await fetchWithErrorHandling(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content })
      })

      if (editingPost) {
        setLocalPosts(prev => prev.map(post =>
          post.id === editingPost.id ? { ...post, ...response } : post
        ))
      } else {
        setLocalPosts(prev => [response, ...prev])
      }

      setIsEditing(false)
      setEditingPost(null)
      setNotification({
        type: 'success',
        message: editingPost ? 'Beitrag aktualisiert!' : 'Beitrag erstellt!'
      })
    } catch (error) {
      setNotification({
        type: 'error',
        message: 'Fehler beim Erstellen/Aktualisieren des Beitrags.'
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleToggleLike = async (postId: string) => {
    if (!session) {
      setNotification({ type: 'error', message: 'Bitte melde dich an, um Likes zu vergeben.' })
      return
    }

    try {
      const response = await fetchWithErrorHandling(`/api/posts/${postId}/like`, {
        method: 'POST'
      })

      const isLikeAdded = response.message !== 'Like entfernt'
      setLocalPosts(prev => prev.map(post => {
        if (post.id === postId) {
          return {
            ...post,
            votes: isLikeAdded ? post.votes + 1 : post.votes - 1,
            isLiked: isLikeAdded
          }
        }
        return post
      }))

    } catch (error) {
      setNotification({ type: 'error', message: 'Fehler beim Liken.' })
    }
  }

  const handleDeletePost = async (postId: string) => {
    if (!session) {
      setNotification({ type: 'error', message: 'Bitte melde dich an, um Beiträge zu löschen.' })
      return
    }

    if (!window.confirm('Möchtest du diesen Beitrag wirklich löschen?')) return

    setIsLoading(true)
    try {
      await fetchWithErrorHandling(`/api/posts/${postId}`, { method: 'DELETE' })
      setLocalPosts(prev => prev.filter(post => post.id !== postId))
      setNotification({ type: 'success', message: 'Beitrag wurde gelöscht!' })
    } catch (error) {
      setNotification({ type: 'error', message: 'Fehler beim Löschen des Beitrags.' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleAddComment = async (postId: string, content: string) => {
    if (!session) {
      setNotification({ type: 'error', message: 'Bitte melde dich an, um zu kommentieren.' })
      return
    }

    setIsLoading(true)
    try {
      const response = await fetchWithErrorHandling(`/api/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      })

      setLocalPosts(prev => prev.map(post => {
        if (post.id === postId) {
          return { ...post, comments: [response, ...post.comments] }
        }
        return post
      }))

      setNotification({ type: 'success', message: 'Kommentar wurde hinzugefügt!' })
    } catch (error) {
      setNotification({ type: 'error', message: 'Fehler beim Hinzufügen des Kommentars.' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleLikeComment = async (commentId: string, postId: string) => {
    if (!session) {
      setNotification({ type: 'error', message: 'Bitte melde dich an, um Kommentare zu liken.' })
      return
    }

    try {
      const response = await fetchWithErrorHandling(`/api/posts/${postId}/comments/${commentId}/like`, {
        method: 'POST'
      })

      setLocalPosts(prev => prev.map(post => ({
        ...post,
        comments: post.comments.map(comment => {
          if (comment.id === commentId) {
            return {
              ...comment,
              votes: response.isLiked ? comment.votes + 1 : comment.votes - 1,
              isLiked: response.isLiked
            }
          }
          return comment
        })
      })))

    } catch (error) {
      setNotification({ type: 'error', message: 'Fehler beim Liken des Kommentars.' })
    }
  }

  // Calculate user stats
  const userStats = {
    posts: localPosts.filter(post => post.authorId === session?.user.id).length,
    receivedLikes: localPosts
      .filter(post => post.authorId === session?.user.id)
      .reduce((acc, post) => acc + post.votes, 0),
    comments: localPosts.reduce((acc, post) =>
      acc + ((post.comments || []).filter(comment => comment.authorId === session?.user.id).length), 0),
  }

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
              <p className="text-sm tabular-nums text-muted-foreground">{localPosts.length} {localPosts.length === 1 ? 'Beitrag' : 'Beiträge'}</p>
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
                      isLoading={isLoading}
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
                    <span className="text-sm tabular-nums text-muted-foreground">{localPosts.length} {localPosts.length === 1 ? 'Beitrag' : 'Beiträge'}</span>
                  </div>
                  <div className="mt-5 space-y-5">
                    {isLoading && localPosts.length === 0 && <PageState kind="loading" title="Beiträge werden geladen" />}
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
                          isLoading={isLoading}
                        />
                      ))}
                    </AnimatePresence>

                    {localPosts.length === 0 && !isLoading && (
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
                <StatsCard stats={userStats} rewards={rewards} rewardsLoading={rewardsLoading} rewardsError={rewardsError} isSignedIn={!!session} />
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


export default Community
