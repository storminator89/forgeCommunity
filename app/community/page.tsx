"use client"

import { PageIntro } from '@/components/page-intro';
import { AppShell, AppHeader } from '@/components/app-shell';
import { useState, useEffect, useCallback, useRef } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { PageState } from '@/components/page-state'
import { useSession } from 'next-auth/react'
import { Button } from "@/components/ui/button"
import { UserNav } from "@/components/user-nav"
import { Sidebar } from "@/components/Sidebar"
import { ThemeToggle } from "@/components/theme-toggle"
import { PlusCircle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { PointsAnimation } from "@/components/PointsAnimation"


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
  id: string
  name: string
  image: string | null
  points: number
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
  const [isLoading, setIsLoading] = useState(true)
  const [localPosts, setLocalPosts] = useState<Post[]>([])
  const [isEditing, setIsEditing] = useState(false)
  const [editingPost, setEditingPost] = useState<Post | null>(null)
  const [leaderboardUsers, setLeaderboardUsers] = useState<LeaderboardUser[]>([])
  const [isLeaderboardLoading, setIsLeaderboardLoading] = useState(true)
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null)

  const [pointsAnimation, setPointsAnimation] = useState({
    isVisible: false,
    points: 0
  })

  const postsRequestRef = useRef<AbortController | null>(null)
  const leaderboardRequestRef = useRef<AbortController | null>(null)

  const fetchLeaderboard = useCallback(async () => {
    leaderboardRequestRef.current?.abort()
    const controller = new AbortController()
    leaderboardRequestRef.current = controller
    setIsLeaderboardLoading(true)

    try {
      const data = await fetchWithErrorHandling('/api/leaderboard', { signal: controller.signal })
      if (leaderboardRequestRef.current !== controller) return
      setLeaderboardUsers(data)
    } catch (error) {
      if (controller.signal.aborted || leaderboardRequestRef.current !== controller || isAbortError(error)) return
      setNotification({ type: 'error', message: 'Fehler beim Laden des Leaderboards.' })
    } finally {
      if (leaderboardRequestRef.current === controller) {
        leaderboardRequestRef.current = null
        setIsLeaderboardLoading(false)
      }
    }
  }, [])

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
        showPointsAndUpdateLeaderboard(10) // Points for new post
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

      if (isLikeAdded) {
        showPointsAndUpdateLeaderboard(1) // Points for new like
      }
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

      showPointsAndUpdateLeaderboard(5) // Points for new comment
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

  const showPointsAndUpdateLeaderboard = (points: number) => {
    setPointsAnimation({ isVisible: true, points })
    fetchLeaderboard()
  }

  // Calculate user stats
  const userStats = {
    posts: localPosts.filter(post => post.authorId === session?.user.id).length,
    receivedLikes: localPosts
      .filter(post => post.authorId === session?.user.id)
      .reduce((acc, post) => acc + post.votes, 0),
    comments: localPosts.reduce((acc, post) =>
      acc + ((post.comments || []).filter(comment => comment.authorId === session?.user.id).length), 0),
    totalPoints: leaderboardUsers.find(user => user.id === session?.user.id)?.points || 0
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
              className={`fixed top-6 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-full shadow-2xl z-[100] flex items-center space-x-2 ${notification.type === 'success'
                ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white'
                : 'bg-gradient-to-r from-red-500 to-rose-600 text-white'
                }`}
            >
              <span className="font-medium" role={notification.type === 'error' ? 'alert' : 'status'}>{notification.message}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <AppHeader>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">Community Hub</h2>
              <p className="text-sm text-muted-foreground hidden sm:block">Tausche dich aus und sammle Punkte</p>
            </div>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </AppHeader>

        <main id="page-content" tabIndex={-1} className="flex-1 overflow-y-auto scroll-smooth">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <PageIntro eyebrow="Deine Community" title="Gute Ideen beginnen im Austausch." description="Teile Erfahrungen, stelle Fragen und bring gemeinsam mit anderen neue Ideen voran." />
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Main Content Feed - 8 cols */}
              <div className="lg:col-span-8 space-y-6">
                <AnimatePresence mode="wait">
                  {!isEditing ? (
                    <motion.div
                      key="new-post-button"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="bg-card rounded-2xl p-4 shadow-sm border border-border flex items-center space-x-4 cursor-pointer hover:border-primary/30 transition-colors"
                      role="button" tabIndex={0} aria-label="Neuen Beitrag erstellen"
                      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setIsEditing(true) } }}
                      onClick={() => setIsEditing(true)}
                    >
                      <Avatar className="h-10 w-10"><AvatarImage src={session?.user?.image || ''} alt="" /><AvatarFallback className="bg-accent text-primary">{session?.user?.name?.[0] || 'F'}</AvatarFallback></Avatar>
                      <div className="flex-1 bg-muted rounded-full px-4 py-2.5 text-muted-foreground text-sm hover:bg-accent transition-colors">
                        Was möchtest du teilen{session?.user?.name ? `, ${session.user.name.split(' ')[0]}` : ''}?
                      </div>
                      <Button aria-label="Hinzufügen" variant="ghost" size="icon" className="text-primary">
                        <PlusCircle className="h-6 w-6" />
                      </Button>
                    </motion.div>
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

                <div className="space-y-6">
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
                          // Scroll to top to see form
                          window.scrollTo({ top: 0, behavior: 'smooth' })
                        }}
                        onAddComment={handleAddComment}
                        onLikeComment={handleLikeComment}
                        isLoading={isLoading}
                      />
                    ))}
                  </AnimatePresence>

                  {localPosts.length === 0 && !isLoading && (
                    <div className="text-center py-12">
                      <div className="bg-muted dark:bg-card w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                        <PlusCircle className="h-8 w-8 text-muted-foreground" />
                      </div>
                      <h3 className="text-lg font-medium text-foreground">Keine Beiträge gefunden</h3>
                      <p className="text-muted-foreground mt-2">Sei der Erste, der etwas teilt!</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Sidebar - 4 cols - Sticky */}
              <div className="lg:col-span-4 space-y-6 lg:sticky lg:top-8">
                <StatsCard stats={userStats} />
                <LeaderboardCard
                  users={leaderboardUsers}
                  isLoading={isLeaderboardLoading}
                />
              </div>
            </div>
          </div>
        </main>
      </div>

      <PointsAnimation
        points={pointsAnimation.points}
        isVisible={pointsAnimation.isVisible}
        onComplete={() => setPointsAnimation({ isVisible: false, points: 0 })}
      />
    </AppShell>
  )
}


export default Community
