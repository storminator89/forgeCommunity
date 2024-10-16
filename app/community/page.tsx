"use client"

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { Button } from "@/components/ui/button"
import { UserNav } from "@/components/user-nav"
import { Sidebar } from "@/components/Sidebar"
import { ThemeToggle } from "@/components/theme-toggle"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ThumbsUp, MessageSquare, Trophy, Award, PlusCircle, Trash, Edit, ChevronDown, ChevronUp } from 'lucide-react'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

const ReactQuill = dynamic(() => import('react-quill'), { ssr: false })
import 'react-quill/dist/quill.snow.css'

interface User {
  id: string;
  name: string;
  image: string;
  points: number;
}

interface Post {
  id: string;
  title: string;
  content: string;
  authorId: string;
  author: {
    id: string;
    name: string;
    image: string | null;
  } | null;
  createdAt: string;
  votes: number;
  isLiked: boolean;
  comments: Comment[];
}

interface Comment {
  id: string;
  authorId: string;
  author: {
    id: string;
    name: string;
    image: string | null;
  } | null;
  content: string;
  createdAt: string;
  votes: number;
  isLiked: boolean;
}

const leaderboardUsers: User[] = [
  { id: '1', name: 'Max Mustermann', image: 'https://i.pravatar.cc/150?img=1', points: 1200 },
  { id: '2', name: 'Anna Schmidt', image: 'https://i.pravatar.cc/150?img=2', points: 980 },
  { id: '3', name: 'Lukas Weber', image: 'https://i.pravatar.cc/150?img=3', points: 850 },
  { id: '4', name: 'Sophie Becker', image: 'https://i.pravatar.cc/150?img=4', points: 720 },
  { id: '5', name: 'Tom Schulz', image: 'https://i.pravatar.cc/150?img=5', points: 650 },
]

const DEFAULT_AVATAR_URL = 'https://via.placeholder.com/150'

const modules = {
  toolbar: [
    [{ 'header': [1, 2, false] }],
    ['bold', 'italic', 'underline','strike', 'blockquote'],
    [{'list': 'ordered'}, {'list': 'bullet'}, {'indent': '-1'}, {'indent': '+1'}],
    ['link', 'image'],
    ['clean']
  ],
}

const formats = [
  'header',
  'bold', 'italic', 'underline', 'strike', 'blockquote',
  'list', 'bullet', 'indent',
  'link', 'image'
]

export default function Community() {
  const { data: session } = useSession()
  const [localPosts, setLocalPosts] = useState<Post[]>([])
  const [newPost, setNewPost] = useState({ title: '', content: '' })
  const [isEditing, setIsEditing] = useState(false)
  const [editingPost, setEditingPost] = useState<Post | null>(null)
  const [newComment, setNewComment] = useState<{ [key: string]: string }>({})
  const [commentingPostId, setCommentingPostId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [expandedComments, setExpandedComments] = useState<{ [key: string]: boolean }>({})

  useEffect(() => {
    console.log("Frontend Session:", session)
  }, [session])

  const fetchPosts = useCallback(async () => {
    try {
      const res = await fetch('/api/posts')
      if (!res.ok) throw new Error('Fehler beim Laden der Beiträge')
      const data = await res.json()
      const mappedPosts = data.map((post: any) => ({
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
      setStatusMessage({ type: 'error', message: 'Fehler beim Laden der Beiträge' })
    }
  }, [])

  useEffect(() => {
    fetchPosts()
  }, [fetchPosts])

  useEffect(() => {
    if (statusMessage) {
      const timer = setTimeout(() => setStatusMessage(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [statusMessage])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session) {
      setStatusMessage({ type: 'error', message: 'Bitte melde dich an, um einen Beitrag zu erstellen.' })
      return
    }

    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPost)
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Fehler beim Erstellen des Beitrags')
      }

      const createdPost = await res.json()
      const postWithLikes = {
        ...createdPost,
        votes: 0,
        isLiked: false,
        comments: []
      }
      setLocalPosts(prev => [postWithLikes, ...prev])
      setNewPost({ title: '', content: '' })
      setIsEditing(false)
      setStatusMessage({ type: 'success', message: 'Beitrag erfolgreich erstellt.' })
    } catch (error: any) {
      console.error("HandleSubmit Error:", error)
      setStatusMessage({ type: 'error', message: error.message })
    }
  }

  const handleToggleLikePost = async (postId: string) => {
    if (!session) {
      setStatusMessage({ type: 'error', message: 'Bitte melde dich an, um einen Like abzugeben.' })
      return
    }

    try {
      const res = await fetch(`/api/posts/${postId}/like`, { method: 'POST' })
      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Fehler beim Toggle-Like')
      }

      const data = await res.json()
      setLocalPosts(prev => prev.map(post => {
        if (post.id === postId) {
          return {
            ...post,
            votes: data.message === 'Like entfernt' ? post.votes - 1 : post.votes + 1,
            isLiked: data.message !== 'Like entfernt'
          }
        }
        return post
      }))
    } catch (error: any) {
      console.error("handleToggleLikePost Error:", error)
      setStatusMessage({ type: 'error', message: error.message })
    }
  }

  const handleToggleLikeComment = async (commentId: string, postId: string) => {
    if (!session) {
      setStatusMessage({ type: 'error', message: 'Bitte melde dich an, um einen Like abzugeben.' })
      return
    }

    try {
      const res = await fetch(`/api/comments/${commentId}/like`, { method: 'POST' })
      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Fehler beim Toggle-Like')
      }

      const data = await res.json()
      setLocalPosts(prev => prev.map(post => {
        if (post.id === postId) {
          const updatedComments = post.comments.map(comment => {
            if (comment.id === commentId) {
              return {
                ...comment,
                votes: data.message === 'Like entfernt' ? comment.votes - 1 : comment.votes + 1,
                isLiked: data.message !== 'Like entfernt'
              }
            }
            return comment
          })
          return { ...post, comments: updatedComments }
        }
        return post
      }))
    } catch (error: any) {
      console.error("handleToggleLikeComment Error:", error)
      setStatusMessage({ type: 'error', message: error.message })
    }
  }

  const handleComment = async (postId: string) => {
    if (!session) {
      setStatusMessage({ type: 'error', message: 'Bitte melde dich an, um einen Kommentar zu schreiben.' })
      return
    }

    const commentContent = newComment[postId]
    if (!commentContent || commentContent.trim() === '') return

    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: commentContent })
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Fehler beim Hinzufügen des Kommentars')
      }

      const createdComment = await res.json()
      const newCommentData: Comment = {
        id: createdComment.id,
        authorId: createdComment.authorId,
        author: createdComment.author,
        content: createdComment.content,
        createdAt: createdComment.createdAt,
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
      setStatusMessage({ type: 'success', message: 'Kommentar erfolgreich hinzugefügt.' })
    } catch (error: any) {
      console.error("handleComment Error:", error)
      setStatusMessage({ type: 'error', message: error.message })
    }
  }

  const handleDeletePost = async (postId: string) => {
    if (!session) {
      setStatusMessage({ type: 'error', message: 'Bitte melde dich an, um einen Beitrag zu löschen.' })
      return
    }

    if (!confirm('Möchtest du diesen Beitrag wirklich löschen?')) return

    try {
      const res = await fetch(`/api/posts/${postId}`, { method: 'DELETE' })
      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Fehler beim Löschen des Beitrags')
      }

      setLocalPosts(prev => prev.filter(post => post.id !== postId))
      setStatusMessage({ type: 'success', message: 'Beitrag erfolgreich gelöscht.' })
    } catch (error: any) {
      console.error("handleDeletePost Error:", error)
      setStatusMessage({ type: 'error', message: error.message })
    }
  }

  const handleEditPost = (post: Post) => {
    setEditingPost(post)
    setNewPost({ title: post.title, content: post.content })
    setIsEditing(true)
  }

  const handleUpdatePost = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session || !editingPost) {
      setStatusMessage({ type: 'error', message: 'Fehler beim Bearbeiten des Beitrags.' })
      return
    }

    try {
      const res = await fetch(`/api/posts/${editingPost.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPost)
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Fehler beim Aktualisieren des Beitrags')
      }

      const updatedPost = await res.json()
      setLocalPosts(prev => prev.map(post => post.id === updatedPost.id ? {
        ...post,
        title: updatedPost.title,
        content: updatedPost.content,
      } : post))
      setNewPost({ title: '', content: '' })
      setIsEditing(false)
      setEditingPost(null)
      setStatusMessage({ type: 'success', message: 'Beitrag erfolgreich aktualisiert.' })
    } catch (error: any) {
      console.error("handleUpdatePost Error:", error)
      setStatusMessage({ type: 'error', message: error.message })
    }
  }

  const toggleComments = (postId: string) => {
    setExpandedComments(prev => ({
      ...prev,
      [postId]: !prev[postId]
    }))
  }

  return (
    <div className="flex flex-col lg:flex-row h-screen overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-md z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Community</h2>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        {statusMessage && (
          <div className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 ${statusMessage.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} rounded-md mb-4`}>
            {statusMessage.message}
          </div>
        )}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-6">
                <AnimatePresence>
                  {!isEditing ? (
                    <motion.div
                      initial={{ opacity: 0, y: -20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      transition={{ duration: 0.3 }}
                    >
                      <Button 
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center"
                        onClick={() => { setIsEditing(true); setEditingPost(null); }}
                      >
                        <PlusCircle className="mr-2 h-5 w-5" />
                        Neuer Beitrag
                      </Button>
                    </motion.div>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 20 }}
                      transition={{ duration: 0.3 }}
                    >
                      <form onSubmit={editingPost ? handleUpdatePost : handleSubmit} className="space-y-4 bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                        <div>
                          <Label htmlFor="title">Titel</Label>
                          <Input
                            id="title"
                            value={newPost.title}
                            onChange={(e) => setNewPost({ ...newPost, title: e.target.value })}
                            placeholder="Gib deinem Beitrag einen Titel"
                            required
                          />
                        </div>
                        <div>
                          <Label htmlFor="content">Inhalt</Label>
                          <ReactQuill
                            theme="snow"
                            value={newPost.content}
                            onChange={(content) => setNewPost({ ...newPost, content })}
                            placeholder="Was möchtest du mitteilen?"
                            modules={modules}
                            formats={formats}
                          />
                        </div>
                        <div className="flex justify-end space-x-2 pt-4">
                          <Button type="button" variant="outline" onClick={() => { setIsEditing(false); setEditingPost(null); }}>Abbrechen</Button>
                          <Button type="submit">{editingPost ? 'Beitrag aktualisieren' : 'Beitrag veröffentlichen'}</Button>
                        </div>
                      </form>
                    </motion.div>
                  )}
                </AnimatePresence>
                <AnimatePresence>
                  {localPosts.map((post) => (
                    <motion.div
                      key={post.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      transition={{ duration: 0.3 }}
                    >
                      <Card className="overflow-hidden hover:shadow-lg transition-shadow duration-300">
                        <CardHeader className="flex justify-between items-center bg-blue-100 dark:bg-blue-900">
                          <CardTitle className="text-xl font-semibold text-blue-800 dark:text-blue-100">{post.title}</CardTitle>
                          {session?.user.id === post.authorId && (
                            <div className="flex space-x-2">
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => handleEditPost(post)}
                                aria-label="Beitrag bearbeiten"
                              >
                                <Edit className="h-4 w-4 text-blue-600 dark:text-blue-300" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => handleDeletePost(post.id)}
                                aria-label="Beitrag löschen"
                              >
                                <Trash className="h-4 w-4 text-red-500" />
                              </Button>
                            </div>
                          )}
                        </CardHeader>
                        <CardContent className="pt-4">
                          <div className="prose dark:prose-invert max-w-none mb-4" dangerouslySetInnerHTML={{ __html: post.content }} />
                        </CardContent>
                        <CardFooter className="bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                          <div className="w-full">
                            <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400 mb-2">
                              <div className="flex items-center space-x-2">
                                <Avatar className="h-8 w-8">
                                  {post.author ? (
                                    post.author.image ? (
                                      <AvatarImage src={post.author.image} />
                                    ) : (
                                      <AvatarImage src={DEFAULT_AVATAR_URL} />
                                    )
                                  ) : (
                                    <AvatarFallback>U</AvatarFallback>
                                  )}
                                  {post.author && !post.author.image && (
                                    <AvatarFallback>{post.author.name ? post.author.name[0] : 'U'}</AvatarFallback>
                                  )}
                                </Avatar>
                                <span className="font-medium text-gray-700 dark:text-gray-200">
                                  {post.author?.name || 'Unbekannt'}
                                </span>
                              </div>
                              <span>
                                {new Date(post.createdAt).toLocaleDateString('de-DE', { year: 'numeric', month: 'long', day: 'numeric' })}
                              </span>
                            </div>
                            <div className="flex items-center space-x-4 text-sm text-gray-500 dark:text-gray-400">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      onClick={() => handleToggleLikePost(post.id)}
                                      aria-label={post.isLiked ? 'Like entfernen' : 'Beitrag liken'}
                                      className="hover:bg-blue-100 dark:hover:bg-gray-700 transition-colors duration-200"
                                    >
                                      <ThumbsUp className={`h-4 w-4 mr-1 ${post.isLiked ? 'text-blue-600' : 'text-gray-500'}`} />
                                      <span>{post.votes}</span>
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{post.isLiked ? 'Like entfernen' : 'Beitrag liken'}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      onClick={() => toggleComments(post.id)}
                                      aria-label={expandedComments[post.id] ? 'Kommentare ausblenden' : 'Kommentare anzeigen'}
                                      className="hover:bg-blue-100 dark:hover:bg-gray-700 transition-colors duration-200"
                                    >
                                      <MessageSquare className="h-4 w-4 mr-1" />
                                      <span>{post.comments.length}</span>
                                      {expandedComments[post.id] ? <ChevronUp className="h-4 w-4 ml-1" /> : <ChevronDown className="h-4 w-4 ml-1" />}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{expandedComments[post.id] ? 'Kommentare ausblenden' : 'Kommentare anzeigen'}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          </div>
                        </CardFooter>
                        {expandedComments[post.id] && (
                          <div className="mt-4 space-y-2 p-4 bg-gray-100 dark:bg-gray-800">
                            <div className="bg-white dark:bg-gray-700 p-4 rounded-lg">
                              <Input
                                value={newComment[post.id] || ''}
                                onChange={(e) => setNewComment({ ...newComment, [post.id]: e.target.value })}
                                placeholder="Schreibe einen Kommentar..."
                                className="mb-2"
                              />
                              <Button onClick={() => handleComment(post.id)}>Kommentar abschicken</Button>
                            </div>
                            {post.comments.map((comment) => (
                              <Card key={comment.id} className="bg-white dark:bg-gray-700 p-2 rounded">
                                <CardContent>
                                  <div className="flex items-center space-x-2 mb-1">
                                    <Avatar className="h-6 w-6">
                                      {comment.author ? (
                                        comment.author.image ? (
                                          <AvatarImage src={comment.author.image} />
                                        ) : (
                                          <AvatarImage src={DEFAULT_AVATAR_URL} />
                                        )
                                      ) : (
                                        <AvatarFallback>U</AvatarFallback>
                                      )}
                                      {comment.author && !comment.author.image && (
                                        <AvatarFallback>{comment.author.name ? comment.author.name[0] : 'U'}</AvatarFallback>
                                      )}
                                    </Avatar>
                                    <span className="text-sm font-medium">
                                      {comment.author?.name || 'Unbekannt'}
                                    </span>
                                    <span className="text-xs text-gray-500">
                                      {new Date(comment.createdAt).toLocaleDateString('de-DE', { year: 'numeric', month: 'long', day: 'numeric' })} um {new Date(comment.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>
                                  <p className="text-sm mt-2">{comment.content}</p>
                                  <div className="flex items-center space-x-4 text-sm text-gray-500 dark:text-gray-400 mt-2">
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button 
                                            variant="ghost" 
                                            size="sm" 
                                            onClick={() => handleToggleLikeComment(comment.id, post.id)}
                                            aria-label={comment.isLiked ? 'Like entfernen' : 'Kommentar liken'}
                                            className="hover:bg-blue-100 dark:hover:bg-gray-600 transition-colors duration-200"
                                          >
                                            <ThumbsUp className={`h-4 w-4 mr-1 ${comment.isLiked ? 'text-blue-600' : 'text-gray-500'}`} />
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
                          </div>
                        )}
                      </Card>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
              <div className="space-y-6">
                <Card className="hover:shadow-lg transition-shadow duration-300">
                  <CardHeader>
                    <CardTitle className="flex items-center">
                      <Trophy className="h-6 w-6 text-yellow-500 mr-2" />
                      Leaderboard
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {leaderboardUsers.map((user, index) => (
                      <motion.div
                        key={user.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.1 }}
                        className="flex items-center justify-between py-2"
                      >
                        <div className="flex items-center">
                          <span className="font-bold mr-2">{index + 1}.</span>
                          <Avatar className="h-8 w-8 mr-2">
                            <AvatarImage src={user.image} />
                            <AvatarFallback>{user.name[0]}</AvatarFallback>
                          </Avatar>
                          <span>{user.name}</span>
                        </div>
                        <span className="font-semibold">{user.points} Punkte</span>
                      </motion.div>
                    ))}
                  </CardContent>
                </Card>
                <Card className="hover:shadow-lg transition-shadow duration-300">
                  <CardHeader>
                    <CardTitle className="flex items-center">
                      <Award className="h-6 w-6 text-purple-500 mr-2" />
                      Deine Statistiken
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span>Beiträge:</span>
                        <span className="font-semibold">{localPosts.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Likes erhalten:</span>
                        <span className="                        font-semibold">{localPosts.reduce((acc, post) => acc + post.votes, 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Kommentare:</span>
                        <span className="font-semibold">{localPosts.reduce((acc, post) => acc + post.comments.length, 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Gesamtpunkte:</span>
                        <span className="font-semibold">{leaderboardUsers.find(user => user.id === session?.user.id)?.points || 0}</span>
                      </div>
                    </div>
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