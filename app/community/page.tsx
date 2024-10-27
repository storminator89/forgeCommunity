"use client"

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { Button } from "@/components/ui/button"
import { UserNav } from "@/components/user-nav"
import { Sidebar } from "@/components/Sidebar"
import { ThemeToggle } from "@/components/theme-toggle"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  ThumbsUp,
  MessageSquare,
  Trophy,
  Award,
  PlusCircle,
  Trash,
  Edit,
  ChevronDown,
  ChevronUp,
  Loader2,
  Menu
} from 'lucide-react'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Skeleton } from "@/components/ui/skeleton"

// Dynamisches Importieren von ReactQuill mit Ladezustand
const ReactQuill = dynamic(() => import('react-quill'), {
  ssr: false,
  loading: () => <Skeleton className="h-[200px]" />
})
import 'react-quill/dist/quill.snow.css'

// Konstanten
const ANIMATION_DURATION = 0.3
const DEFAULT_AVATAR_URL = 'https://via.placeholder.com/150'

// Editor Konfiguration
const EDITOR_MODULES = {
  toolbar: [
    [{ 'header': [1, 2, false] }],
    ['bold', 'italic', 'underline', 'strike', 'blockquote'],
    [{ 'list': 'ordered' }, { 'list': 'bullet' }, { 'indent': '-1' }, { 'indent': '+1' }],
    ['link', 'image'],
    ['clean']
  ],
}

const EDITOR_FORMATS = [
  'header',
  'bold', 'italic', 'underline', 'strike', 'blockquote',
  'list', 'bullet', 'indent',
  'link', 'image'
]

// Animation Variants (einmalig definiert)
const fadeInUpVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
  transition: { duration: ANIMATION_DURATION }
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  },
  exit: { opacity: 0 }
}

// Interfaces
interface User {
  id: string
  name: string
  image: string
  points: number
}

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
    id: string
    name: string
    image: string | null
  } | null
  content: string
  createdAt: string
  votes: number
  isLiked: boolean
}

// Mock Daten für Leaderboard
const leaderboardUsers: User[] = [
  { id: '1', name: 'Max Mustermann', image: 'https://i.pravatar.cc/150?img=1', points: 1200 },
  { id: '2', name: 'Anna Schmidt', image: 'https://i.pravatar.cc/150?img=2', points: 980 },
  { id: '3', name: 'Lukas Weber', image: 'https://i.pravatar.cc/150?img=3', points: 850 },
  { id: '4', name: 'Sophie Becker', image: 'https://i.pravatar.cc/150?img=4', points: 720 },
  { id: '5', name: 'Tom Schulz', image: 'https://i.pravatar.cc/150?img=5', points: 650 },
]

function Community() {
  // Hooks und State
  const { data: session } = useSession()
  const [isLoading, setIsLoading] = useState(false)
  const [localPosts, setLocalPosts] = useState<Post[]>([])
  const [newPost, setNewPost] = useState({ title: '', content: '' })
  const [isEditing, setIsEditing] = useState(false)
  const [editingPost, setEditingPost] = useState<Post | null>(null)
  const [newComment, setNewComment] = useState<{ [key: string]: string }>({})
  const [commentingPostId, setCommentingPostId] = useState<string | null>(null)
  const [expandedComments, setExpandedComments] = useState<{ [key: string]: boolean }>({})
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Optimierte Fetch-Funktion mit Error Handling
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

  // Posts laden
  const fetchPosts = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await fetchWithErrorHandling('/api/posts')
      const mappedPosts: Post[] = data.map((post: any) => ({
        ...post,
        votes: post.votes,
        isLiked: post.isLiked,
        comments: post.comments.map((comment: any) => ({
          ...comment,
          votes: comment.votes,
          isLiked: comment.isLiked,
        })),
      }))
      setLocalPosts(mappedPosts)
    } catch (error) {
      console.error("Fehler beim Laden der Beiträge:", error)
      setNotification({ type: 'error', message: 'Fehler beim Laden der Beiträge.' })
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPosts()
  }, [fetchPosts])

  // Scroll zum bearbeiteten Post
  useEffect(() => {
    if (editingPost && scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [editingPost])

  // Benachrichtigung entfernen nach 3 Sekunden
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [notification])

  // Post erstellen/aktualisieren
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session) {
      console.error("Nicht angemeldet: Bitte melde dich an, um einen Beitrag zu erstellen.")
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
        body: JSON.stringify(newPost)
      })

      if (editingPost) {
        setLocalPosts(prev => prev.map(post =>
          post.id === editingPost.id ? { ...post, ...response } : post
        ))
      } else {
        setLocalPosts(prev => [{ ...response, votes: 0, isLiked: false, comments: [] }, ...prev])
      }

      setNewPost({ title: '', content: '' })
      setIsEditing(false)
      setEditingPost(null)

      setNotification({ type: 'success', message: editingPost ? 'Beitrag aktualisiert!' : 'Beitrag erstellt!' })
    } catch (error) {
      console.error("Fehler beim Erstellen/Aktualisieren des Beitrags:", error)
      setNotification({ type: 'error', message: 'Fehler beim Erstellen/Aktualisieren des Beitrags.' })
    } finally {
      setIsLoading(false)
    }
  }

  // Like-Funktionalität
  const handleToggleLike = async (postId: string, type: 'post' | 'comment', commentId?: string) => {
    if (!session) {
      console.error("Nicht angemeldet: Bitte melde dich an, um Likes zu vergeben.")
      setNotification({ type: 'error', message: 'Bitte melde dich an, um Likes zu vergeben.' })
      return
    }

    try {
      const endpoint = type === 'post'
        ? `/api/posts/${postId}/like`
        : `/api/comments/${commentId}/like`

      const response = await fetchWithErrorHandling(endpoint, { method: 'POST' })

      if (type === 'post') {
        setLocalPosts(prev => prev.map(post => {
          if (post.id === postId) {
            return {
              ...post,
              votes: response.message === 'Like entfernt' ? post.votes - 1 : post.votes + 1,
              isLiked: response.message !== 'Like entfernt'
            }
          }
          return post
        }))
      } else {
        setLocalPosts(prev => prev.map(post => {
          if (post.id === postId) {
            const updatedComments = post.comments.map(comment => {
              if (comment.id === commentId) {
                return {
                  ...comment,
                  votes: response.message === 'Like entfernt' ? comment.votes - 1 : comment.votes + 1,
                  isLiked: response.message !== 'Like entfernt'
                }
              }
              return comment
            })
            return { ...post, comments: updatedComments }
          }
          return post
        }))
      }
    } catch (error) {
      console.error("Fehler beim Toggle Like:", error)
      setNotification({ type: 'error', message: 'Fehler beim Liken.' })
    }
  }

  // Kommentar hinzufügen
  const handleComment = async (postId: string) => {
    if (!session) {
      console.error("Nicht angemeldet: Bitte melde dich an, um zu kommentieren.")
      setNotification({ type: 'error', message: 'Bitte melde dich an, um zu kommentieren.' })
      return
    }

    const commentContent = newComment[postId]
    if (!commentContent?.trim()) {
      console.error("Der Kommentar darf nicht leer sein.")
      setNotification({ type: 'error', message: 'Der Kommentar darf nicht leer sein.' })
      return
    }

    setIsLoading(true)
    try {
      const response = await fetchWithErrorHandling(`/api/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: commentContent })
      })

      const newCommentData: Comment = {
        ...response,
        votes: 0,
        isLiked: false
      }

      setLocalPosts(prev => prev.map(post => {
        if (post.id === postId) {
          return { ...post, comments: [newCommentData, ...post.comments] }
        }
        return post
      }))

      setNewComment(prev => ({ ...prev, [postId]: '' }))
      setCommentingPostId(null)

      setNotification({ type: 'success', message: 'Kommentar wurde hinzugefügt!' })
    } catch (error) {
      console.error("Fehler beim Hinzufügen des Kommentars:", error)
      setNotification({ type: 'error', message: 'Fehler beim Hinzufügen des Kommentars.' })
    } finally {
      setIsLoading(false)
    }
  }

  // Post löschen
  const handleDeletePost = async (postId: string) => {
    if (!session) {
      console.error("Nicht angemeldet: Bitte melde dich an, um Beiträge zu löschen.")
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
      console.error("Fehler beim Löschen des Beitrags:", error)
      setNotification({ type: 'error', message: 'Fehler beim Löschen des Beitrags.' })
    } finally {
      setIsLoading(false)
    }
  }

  // Kommentare ein-/ausblenden
  const toggleComments = (postId: string) => {
    setExpandedComments(prev => ({
      ...prev,
      [postId]: !prev[postId]
    }))
  }

  // Render-Funktionen für bessere Übersichtlichkeit
  const renderPostForm = () => (
    <motion.div
      initial="hidden"
      animate="visible"
      exit="hidden"
      variants={fadeInUpVariants}
      ref={scrollRef}
    >
      <form onSubmit={handleSubmit} className="space-y-6 bg-background dark:bg-gray-800 p-8 rounded-lg shadow-lg transition-colors duration-300">
        {/* Titel */}
        <div>
          <Label htmlFor="title" className="block text-sm font-medium text-foreground">Titel</Label>
          <Input
            id="title"
            value={newPost.title}
            onChange={(e) => setNewPost({ ...newPost, title: e.target.value })}
            placeholder="Gib deinem Beitrag einen Titel"
            required
            disabled={isLoading}
            className={`mt-1 block w-full p-3 border ${
              !newPost.title ? 'border-red-500' : 'border-border'
            } rounded-md shadow-sm focus:ring-primary focus:border-primary dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 transition-colors duration-200`}
            aria-invalid={!newPost.title}
            aria-describedby="title-error"
          />
          {!newPost.title && (
            <span id="title-error" className="text-red-500 text-xs">
              Titel ist erforderlich.
            </span>
          )}
        </div>

        {/* Inhalt */}
        <div>
          <Label htmlFor="content" className="block text-sm font-medium text-foreground">Inhalt</Label>
          <ReactQuill
            theme="snow"
            value={newPost.content}
            onChange={(content) => setNewPost({ ...newPost, content })}
            placeholder="Was möchtest du mitteilen?"
            modules={EDITOR_MODULES}
            formats={EDITOR_FORMATS}
            readOnly={isLoading} // 'disabled' durch 'readOnly' ersetzt
            className="mt-1"
          />
        </div>

        {/* Buttons */}
        <div className="flex justify-end space-x-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setIsEditing(false)
              setEditingPost(null)
            }}
            disabled={isLoading}
            className="px-4 py-2 border border-border rounded-md text-foreground hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200"
          >
            Abbrechen
          </Button>
          <Button
            type="submit"
            disabled={isLoading}
            className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark flex items-center transition-transform transform active:scale-95 duration-200"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Wird verarbeitet...
              </>
            ) : (
              editingPost ? 'Beitrag aktualisieren' : 'Beitrag veröffentlichen'
            )}
          </Button>
        </div>
      </form>
    </motion.div>
  )

  // Render der Hauptkomponente
  return (
    <div className="flex flex-col lg:flex-row h-screen overflow-hidden bg-background dark:bg-gray-900 transition-colors duration-300">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Benachrichtigung */}
        <AnimatePresence>
          {notification && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className={`fixed top-4 right-4 p-4 rounded-md shadow-lg z-50 ${
                notification.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
              }`}
            >
              {notification.message}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Header */}
        <header className="bg-background dark:bg-gray-800 shadow-md sticky top-0 z-40 transition-colors duration-300">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <h2 className="text-3xl font-bold text-foreground dark:text-white transition-colors duration-300">Community</h2>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>

        {/* Hauptinhalt */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Hauptbereich */}
              <motion.div
                className="lg:col-span-2 space-y-8"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <AnimatePresence mode="wait">
                  {!isEditing ? (
                    <motion.div
                      key="new-post-button"
                      variants={fadeInUpVariants}
                      transition={{ duration: 0.5 }}
                    >
                      <Button
                        className="w-full bg-primary hover:bg-primary-dark text-white flex items-center justify-center p-4 rounded-lg shadow-lg transition-transform transform hover:scale-105 duration-200 active:scale-95"
                        onClick={() => {
                          setIsEditing(true)
                          setEditingPost(null)
                        }}
                        disabled={isLoading}
                      >
                        <PlusCircle className="mr-2 h-5 w-5" />
                        Neuer Beitrag
                      </Button>
                    </motion.div>
                  ) : (
                    renderPostForm()
                  )}
                </AnimatePresence>

                {/* Posts Liste */}
                <AnimatePresence>
                  {isLoading && !localPosts.length ? (
                    // Skeleton Loading
                    Array.from({ length: 3 }).map((_, index) => (
                      <motion.div
                        key={`skeleton-${index}`}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ delay: index * 0.1 }}
                      >
                        <Skeleton className="h-[250px] w-full mb-6 rounded-lg" />
                      </motion.div>
                    ))
                  ) : (
                    <motion.div
                      className="space-y-8"
                      variants={containerVariants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                    >
                      {localPosts.map((post) => (
                        <motion.div
                          key={post.id}
                          variants={fadeInUpVariants}
                          className="mb-8"
                        >
                          <Card className="overflow-hidden hover:shadow-2xl transition-shadow duration-300 bg-background dark:bg-gray-800 rounded-lg border border-border dark:border-gray-700">
                            {/* Card Header */}
                            <CardHeader className="flex flex-col lg:flex-row justify-between items-start lg:items-center bg-gray-100 dark:bg-gray-700 p-4 rounded-t-lg transition-colors duration-300">
                              <CardTitle className="text-xl font-semibold text-foreground dark:text-white">
                                {post.title}
                              </CardTitle>
                              {session?.user.id === post.authorId && (
                                <div className="flex space-x-2 mt-2 lg:mt-0">
                                  {/* Bearbeiten Button */}
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => {
                                            setEditingPost(post)
                                            setNewPost({ title: post.title, content: post.content })
                                            setIsEditing(true)
                                          }}
                                          className="hover:bg-gray-200 dark:hover:bg-gray-600 p-2 rounded-full transition-colors duration-200"
                                          disabled={isLoading}
                                          aria-label="Beitrag bearbeiten"
                                        >
                                          <Edit className="h-4 w-4 text-primary" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>Beitrag bearbeiten</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>

                                  {/* Löschen Button */}
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => handleDeletePost(post.id)}
                                          className="hover:bg-red-200 dark:hover:bg-red-600 p-2 rounded-full transition-colors duration-200"
                                          disabled={isLoading}
                                          aria-label="Beitrag löschen"
                                        >
                                          <Trash className="h-4 w-4 text-red-500" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>Beitrag löschen</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </div>
                              )}
                            </CardHeader>

                            {/* Card Content */}
                            <CardContent className="pt-4 px-4">
                              <div
                                className="prose dark:prose-invert max-w-none mb-4"
                                dangerouslySetInnerHTML={{ __html: post.content }}
                              />
                            </CardContent>

                            {/* Card Footer */}
                            <CardFooter className="bg-gray-100 dark:bg-gray-700 border-t border-gray-200 dark:border-gray-600 p-4 rounded-b-lg transition-colors duration-300">
                              <div className="w-full">
                                {/* Autor und Datum */}
                                <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-300 mb-3">
                                  <div className="flex items-center space-x-3">
                                    <Avatar className="h-8 w-8">
                                      <AvatarImage
                                        src={post.author?.image || DEFAULT_AVATAR_URL}
                                        alt={post.author?.name || 'Anonym'}
                                        className="object-cover"
                                      />
                                      <AvatarFallback>
                                        {post.author?.name?.[0] || 'A'}
                                      </AvatarFallback>
                                    </Avatar>
                                    <span className="font-medium text-foreground dark:text-white">
                                      {post.author?.name || 'Anonym'}
                                    </span>
                                  </div>
                                  <span>
                                    {new Date(post.createdAt).toLocaleDateString('de-DE', {
                                      year: 'numeric',
                                      month: 'long',
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit'
                                    })}
                                  </span>
                                </div>

                                {/* Aktionen */}
                                <div className="flex items-center space-x-4">
                                  {/* Like Button */}
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => handleToggleLike(post.id, 'post')}
                                          className={`hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center space-x-1 rounded-md p-2 transition-colors duration-200 ${
                                            post.isLiked ? 'text-primary' : 'text-gray-500'
                                          }`}
                                          disabled={isLoading}
                                          aria-label={post.isLiked ? 'Like entfernen' : 'Beitrag liken'}
                                        >
                                          <ThumbsUp className="h-4 w-4" />
                                          <span>{post.votes}</span>
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>{post.isLiked ? 'Like entfernen' : 'Beitrag liken'}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>

                                  {/* Kommentar Button */}
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => toggleComments(post.id)}
                                          className="hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center space-x-1 rounded-md p-2 transition-colors duration-200"
                                          aria-label={expandedComments[post.id] ? 'Kommentare ausblenden' : 'Kommentare anzeigen'}
                                        >
                                          <MessageSquare className="h-4 w-4" />
                                          <span>{post.comments.length}</span>
                                          {expandedComments[post.id] ? (
                                            <ChevronUp className="h-4 w-4" />
                                          ) : (
                                            <ChevronDown className="h-4 w-4" />
                                          )}
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>
                                          {expandedComments[post.id] ?
                                            'Kommentare ausblenden' :
                                            'Kommentare anzeigen'
                                          }
                                        </p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </div>

                                {/* Kommentare Bereich */}
                                <AnimatePresence>
                                  {expandedComments[post.id] && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: 'auto', opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={{ duration: 0.3 }}
                                      className="mt-4 space-y-4"
                                    >
                                      {/* Kommentarformular */}
                                      <div className="bg-background dark:bg-gray-700 p-4 rounded-lg shadow-inner">
                                        <Input
                                          value={newComment[post.id] || ''}
                                          onChange={(e) => setNewComment({
                                            ...newComment,
                                            [post.id]: e.target.value
                                          })}
                                          placeholder="Schreibe einen Kommentar..."
                                          className="mb-3"
                                          disabled={isLoading}
                                          aria-label="Kommentar schreiben"
                                        />
                                        <Button
                                          onClick={() => handleComment(post.id)}
                                          disabled={isLoading}
                                          className="w-full bg-green-600 hover:bg-green-700 text-white rounded-md flex items-center justify-center p-3 transition-colors duration-200"
                                        >
                                          {isLoading ? (
                                            <>
                                              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                              Wird gesendet...
                                            </>
                                          ) : (
                                            'Kommentar abschicken'
                                          )}
                                        </Button>
                                      </div>

                                      {/* Kommentare Liste */}
                                      {post.comments.map((comment) => (
                                        <Card key={comment.id} className="bg-background dark:bg-gray-700 p-3 rounded-lg shadow-sm">
                                          <CardContent>
                                            <div className="flex items-center space-x-3 mb-2">
                                              <Avatar className="h-6 w-6">
                                                <AvatarImage
                                                  src={comment.author?.image || DEFAULT_AVATAR_URL}
                                                  alt={comment.author?.name || 'Anonym'}
                                                  className="object-cover"
                                                />
                                                <AvatarFallback>
                                                  {comment.author?.name?.[0] || 'A'}
                                                </AvatarFallback>
                                              </Avatar>
                                              <span className="text-sm font-medium text-foreground dark:text-white">
                                                {comment.author?.name || 'Anonym'}
                                              </span>
                                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                                {new Date(comment.createdAt).toLocaleDateString('de-DE', {
                                                  year: 'numeric',
                                                  month: 'long',
                                                  day: 'numeric',
                                                  hour: '2-digit',
                                                  minute: '2-digit'
                                                })}
                                              </span>
                                            </div>
                                            <p className="text-sm text-foreground dark:text-gray-200 leading-relaxed">{comment.content}</p>
                                            <div className="flex items-center mt-2">
                                              <TooltipProvider>
                                                <Tooltip>
                                                  <TooltipTrigger asChild>
                                                    <Button
                                                      variant="ghost"
                                                      size="sm"
                                                      onClick={() => handleToggleLike(post.id, 'comment', comment.id)}
                                                      className={`hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center space-x-1 rounded-md p-2 transition-colors duration-200 ${
                                                        comment.isLiked ? 'text-primary' : 'text-gray-500'
                                                      }`}
                                                      disabled={isLoading}
                                                      aria-label={comment.isLiked ? 'Like entfernen' : 'Kommentar liken'}
                                                    >
                                                      <ThumbsUp className="h-4 w-4" />
                                                      <span>{comment.votes}</span>
                                                    </Button>
                                                  </TooltipTrigger>
                                                  <TooltipContent>
                                                    <p>{comment.isLiked ? 'Like entfernen' : 'Kommentar liken'}</p>
                                                  </TooltipContent>
                                                </Tooltip>
                                              </TooltipProvider>
                                            </div>
                                          </CardContent>
                                        </Card>
                                      ))}
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            </CardFooter>
                          </Card>
                        </motion.div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>

              {/* Sidebar-Komponenten */}
              <div className="space-y-8">
                {/* Leaderboard Card */}
                <Card className="hover:shadow-xl transition-shadow duration-300 bg-background dark:bg-gray-800 rounded-lg border border-border dark:border-gray-700">
                  <CardHeader className="p-4 border-b border-border dark:border-gray-600">
                    <CardTitle className="flex items-center text-lg font-semibold text-foreground dark:text-white">
                      <Trophy className="h-6 w-6 text-yellow-500 mr-2" />
                      Leaderboard
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    <AnimatePresence>
                      {leaderboardUsers.map((user, index) => (
                        <motion.div
                          key={user.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 20 }}
                          transition={{ delay: index * 0.05 }}
                          className="flex items-center justify-between py-2 px-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors duration-200"
                        >
                          <div className="flex items-center space-x-3">
                            <div className="w-8 text-center">
                              {index === 0 && <Trophy className="h-5 w-5 text-yellow-500" />}
                              {index === 1 && <Trophy className="h-5 w-5 text-gray-400" />}
                              {index === 2 && <Trophy className="h-5 w-5 text-amber-700" />}
                              {index > 2 && <span className="font-bold">{index + 1}.</span>}
                            </div>
                            <Avatar className="h-8 w-8">
                              <AvatarImage
                                src={user.image}
                                alt={user.name}
                                className="object-cover"
                              />
                              <AvatarFallback className="bg-gray-300 dark:bg-gray-600">
                                {user.name[0]}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium text-foreground dark:text-white truncate max-w-[120px]">
                              {user.name}
                            </span>
                          </div>
                          <div className="flex items-center space-x-1">
                            <span className="font-semibold text-primary dark:text-primary-light">{user.points}</span>
                            <span className="text-sm text-gray-500 dark:text-gray-400">Punkte</span>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </CardContent>
                </Card>

                {/* Statistiken Card */}
                <Card className="hover:shadow-xl transition-shadow duration-300 bg-background dark:bg-gray-800 rounded-lg border border-border dark:border-gray-700">
                  <CardHeader className="p-4 border-b border-border dark:border-gray-600">
                    <CardTitle className="flex items-center text-lg font-semibold text-foreground dark:text-white">
                      <Award className="h-6 w-6 text-purple-500 mr-2" />
                      Deine Statistiken
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    <motion.div
                      className="space-y-4"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.2 }}
                    >
                      {/* Beiträge */}
                      <div className="flex justify-between items-center p-3 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-200">
                        <div className="flex items-center space-x-2">
                          <PlusCircle className="h-5 w-5 text-blue-500" />
                          <span className="text-sm font-medium text-foreground dark:text-white">Beiträge</span>
                        </div>
                        <span className="font-semibold text-primary bg-gray-200 dark:bg-gray-600 px-3 py-1 rounded-full">
                          {localPosts.filter(post => post.authorId === session?.user.id).length}
                        </span>
                      </div>

                      {/* Likes erhalten */}
                      <div className="flex justify-between items-center p-3 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-200">
                        <div className="flex items-center space-x-2">
                          <ThumbsUp className="h-5 w-5 text-green-500" />
                          <span className="text-sm font-medium text-foreground dark:text-white">Likes erhalten</span>
                        </div>
                        <span className="font-semibold text-green-600 bg-gray-200 dark:bg-gray-600 px-3 py-1 rounded-full">
                          {localPosts
                            .filter(post => post.authorId === session?.user.id)
                            .reduce((acc, post) => acc + post.votes, 0)}
                        </span>
                      </div>

                      {/* Kommentare */}
                      <div className="flex justify-between items-center p-3 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-200">
                        <div className="flex items-center space-x-2">
                          <MessageSquare className="h-5 w-5 text-orange-500" />
                          <span className="text-sm font-medium text-foreground dark:text-white">Kommentare</span>
                        </div>
                        <span className="font-semibold text-orange-600 bg-gray-200 dark:bg-gray-600 px-3 py-1 rounded-full">
                          {localPosts.reduce((acc, post) =>
                            acc + post.comments.filter(
                              comment => comment.authorId === session?.user.id
                            ).length, 0)}
                        </span>
                      </div>

                      {/* Gesamtpunkte */}
                      <div className="flex justify-between items-center p-3 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-200">
                        <div className="flex items-center space-x-2">
                          <Award className="h-5 w-5 text-purple-500" />
                          <span className="text-sm font-medium text-foreground dark:text-white">Gesamtpunkte</span>
                        </div>
                        <span className="font-semibold text-purple-600 bg-gray-200 dark:bg-gray-600 px-3 py-1 rounded-full">
                          {leaderboardUsers.find(
                            user => user.id === session?.user.id
                          )?.points || 0}
                        </span>
                      </div>
                    </motion.div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

export default Community
