"use client"

import { useState, useEffect, useCallback } from 'react'
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

function Community() {
  const { data: session } = useSession()
  const [isLoading, setIsLoading] = useState(false)
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

  // Fetch functions
  const fetchWithErrorHandling = async (url: string, options?: RequestInit) => {
    try {
      const response = await fetch(url, options)
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Ein Fehler ist aufgetreten')
      }
      return await response.json()
    } catch (error: any) {
      console.error("Fehler:", error.message)
      throw error
    }
  }

  const fetchPosts = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await fetchWithErrorHandling('/api/posts')
      setLocalPosts(data)
    } catch (error) {
      setNotification({ type: 'error', message: 'Fehler beim Laden der Beiträge.' })
    } finally {
      setIsLoading(false)
    }
  }, [])

  const fetchLeaderboard = useCallback(async () => {
    try {
      const data = await fetchWithErrorHandling('/api/leaderboard')
      setLeaderboardUsers(data)
    } catch (error) {
      setNotification({ type: 'error', message: 'Fehler beim Laden des Leaderboards.' })
    } finally {
      setIsLeaderboardLoading(false)
    }
  }, [])

  // Effects
  useEffect(() => {
    fetchPosts()
    fetchLeaderboard()
  }, [fetchPosts, fetchLeaderboard])

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
    <div className="flex flex-col lg:flex-row h-screen overflow-hidden bg-background dark:bg-gray-900 transition-colors duration-300">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        <AnimatePresence>
          {notification && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className={`fixed top-4 right-4 p-4 rounded-md shadow-lg z-50 ${notification.type === 'success' ? 'bg-green-500' : 'bg-red-500'
                } text-white`}
            >
              {notification.message}
            </motion.div>
          )}
        </AnimatePresence>

        <header className="bg-background dark:bg-gray-800 shadow-md sticky top-0 z-40 transition-colors duration-300">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <h2 className="text-3xl font-bold text-foreground dark:text-white">Community</h2>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-8">
                <AnimatePresence mode="wait">
                  {!isEditing ? (
                    <motion.div
                      key="new-post-button"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                    >
                      <Button
                        className="w-full bg-primary hover:bg-primary-dark text-white flex items-center justify-center p-4 rounded-lg shadow-lg transition-transform transform hover:scale-105 duration-200 active:scale-95"
                        onClick={() => setIsEditing(true)}
                        disabled={isLoading}
                      >
                        <PlusCircle className="mr-2 h-5 w-5" />
                        Neuer Beitrag
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
                      }}
                      onAddComment={handleAddComment}
                      onLikeComment={handleLikeComment}
                      isLoading={isLoading}
                    />
                  ))}
                </AnimatePresence>
              </div>

              <div className="space-y-8">
                <LeaderboardCard
                  users={leaderboardUsers}
                  isLoading={isLeaderboardLoading}
                />
                <StatsCard stats={userStats} />
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
    </div>
  )
}

export default Community
