"use client"

import { useState, useEffect } from 'react'
import { users, posts } from '@/src/data/sampleData'
import { Button } from "@/components/ui/button"
import { UserNav } from "@/components/user-nav"
import { Sidebar } from "@/components/Sidebar"
import { ThemeToggle } from "@/components/theme-toggle"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ThumbsUp, ThumbsDown, MessageSquare, Trophy, Award } from 'lucide-react'
import dynamic from 'next/dynamic'

// Dynamischer Import von react-quill, um SSR-Probleme zu vermeiden
const ReactQuill = dynamic(() => import('react-quill'), { ssr: false })
import 'react-quill/dist/quill.snow.css' // Quill Styles

interface Post {
  id: string;
  title: string;
  content: string;
  authorId: string;
  createdAt: string;
  votes: number;
  comments: Comment[];
}

interface Comment {
  id: string;
  authorId: string;
  content: string;
  createdAt: string;
}

interface User {
  id: string;
  name: string;
  image: string;
  points: number;
}

const leaderboardUsers: User[] = [
  { id: '1', name: 'Max Mustermann', image: 'https://i.pravatar.cc/150?img=1', points: 1200 },
  { id: '2', name: 'Anna Schmidt', image: 'https://i.pravatar.cc/150?img=2', points: 980 },
  { id: '3', name: 'Lukas Weber', image: 'https://i.pravatar.cc/150?img=3', points: 850 },
  { id: '4', name: 'Sophie Becker', image: 'https://i.pravatar.cc/150?img=4', points: 720 },
  { id: '5', name: 'Tom Schulz', image: 'https://i.pravatar.cc/150?img=5', points: 650 },
];

export default function Community() {
  const [localPosts, setLocalPosts] = useState<Post[]>([])
  const [newPost, setNewPost] = useState({ title: '', content: '' })
  const [isEditing, setIsEditing] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [commentingPostId, setCommentingPostId] = useState<string | null>(null)

  useEffect(() => {
    // Ensure each post has a comments array
    const postsWithComments = posts.map(post => ({
      ...post,
      votes: post.votes || 0,
      comments: post.comments || []
    }));
    setLocalPosts(postsWithComments as Post[]);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const post: Post = {
      id: String(localPosts.length + 1),
      title: newPost.title,
      content: newPost.content,
      authorId: '1', // Annahme: Der aktuelle Benutzer hat die ID 1
      createdAt: new Date().toISOString(),
      votes: 0,
      comments: []
    }
    setLocalPosts([post, ...localPosts])
    setNewPost({ title: '', content: '' })
    setIsEditing(false)
  }

  const handleVote = (postId: string, voteType: 'up' | 'down') => {
    setLocalPosts(localPosts.map(post => {
      if (post.id === postId) {
        return { ...post, votes: post.votes + (voteType === 'up' ? 1 : -1) }
      }
      return post
    }))
  }

  const handleComment = (postId: string) => {
    if (newComment.trim() === '') return
    setLocalPosts(localPosts.map(post => {
      if (post.id === postId) {
        const newCommentObj: Comment = {
          id: String(post.comments.length + 1),
          authorId: '1', // Annahme: Der aktuelle Benutzer hat die ID 1
          content: newComment,
          createdAt: new Date().toISOString()
        }
        return { ...post, comments: [...post.comments, newCommentObj] }
      }
      return post
    }))
    setNewComment('')
    setCommentingPostId(null)
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-sm z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Community</h2>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto bg-gray-100 dark:bg-gray-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-6">
                <div className="mb-6">
                  {!isEditing ? (
                    <Button 
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                      onClick={() => setIsEditing(true)}
                    >
                      Neuer Beitrag
                    </Button>
                  ) : (
                    <form onSubmit={handleSubmit} className="space-y-4 bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                      <div>
                        <Label htmlFor="title">Titel</Label>
                        <Input
                          id="title"
                          value={newPost.title}
                          onChange={(e) => setNewPost({...newPost, title: e.target.value})}
                          placeholder="Gib deinem Beitrag einen Titel"
                        />
                      </div>
                      <div>
                        <Label htmlFor="content">Inhalt</Label>
                        <ReactQuill
                          theme="snow"
                          value={newPost.content}
                          onChange={(content) => setNewPost({...newPost, content})}
                          placeholder="Was möchtest du mitteilen?"
                        />
                      </div>
                      <div className="flex justify-end space-x-2 pt-4">
                        <Button type="button" variant="outline" onClick={() => setIsEditing(false)}>Abbrechen</Button>
                        <Button type="submit">Beitrag veröffentlichen</Button>
                      </div>
                    </form>
                  )}
                </div>
                {localPosts.map((post) => (
                  <Card key={post.id}>
                    <CardHeader>
                      <CardTitle>{post.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-gray-600 dark:text-gray-300 mb-4" dangerouslySetInnerHTML={{ __html: post.content }} />
                      <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
                        <div className="flex items-center space-x-2">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={users.find(u => u.id === post.authorId)?.image} />
                            <AvatarFallback>{users.find(u => u.id === post.authorId)?.name[0]}</AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-gray-700 dark:text-gray-200">{users.find(u => u.id === post.authorId)?.name}</span>
                        </div>
                        <span>{new Date(post.createdAt).toLocaleDateString('de-DE', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                      </div>
                      <div className="mt-4 flex items-center space-x-4 text-sm text-gray-500 dark:text-gray-400">
                        <Button variant="ghost" size="sm" onClick={() => handleVote(post.id, 'up')}>
                          <ThumbsUp className="h-4 w-4 mr-1" />
                          <span>{post.votes}</span>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleVote(post.id, 'down')}>
                          <ThumbsDown className="h-4 w-4 mr-1" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setCommentingPostId(post.id)}>
                          <MessageSquare className="h-4 w-4 mr-1" />
                          <span>{post.comments.length}</span>
                        </Button>
                      </div>
                      {commentingPostId === post.id && (
                        <div className="mt-4">
                          <Input
                            value={newComment}
                            onChange={(e) => setNewComment(e.target.value)}
                            placeholder="Schreibe einen Kommentar..."
                            className="mb-2"
                          />
                          <Button onClick={() => handleComment(post.id)}>Kommentar abschicken</Button>
                        </div>
                      )}
                      {post.comments.length > 0 && (
                        <div className="mt-4 space-y-2">
                          {post.comments.map((comment) => (
                            <div key={comment.id} className="bg-gray-50 dark:bg-gray-700 p-2 rounded">
                              <div className="flex items-center space-x-2 mb-1">
                                <Avatar className="h-6 w-6">
                                  <AvatarImage src={users.find(u => u.id === comment.authorId)?.image} />
                                  <AvatarFallback>{users.find(u => u.id === comment.authorId)?.name[0]}</AvatarFallback>
                                </Avatar>
                                <span className="text-sm font-medium">{users.find(u => u.id === comment.authorId)?.name}</span>
                                <span className="text-xs text-gray-500">{new Date(comment.createdAt).toLocaleString()}</span>
                              </div>
                              <p className="text-sm">{comment.content}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center">
                      <Trophy className="h-6 w-6 text-yellow-500 mr-2" />
                      Leaderboard
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {leaderboardUsers.map((user, index) => (
                      <div key={user.id} className="flex items-center justify-between py-2">
                        <div className="flex items-center">
                          <span className="font-bold mr-2">{index + 1}.</span>
                          <Avatar className="h-8 w-8 mr-2">
                            <AvatarImage src={user.image} />
                            <AvatarFallback>{user.name[0]}</AvatarFallback>
                          </Avatar>
                          <span>{user.name}</span>
                        </div>
                        <span className="font-semibold">{user.points} Punkte</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <Card>
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
                        <span className="font-semibold">45</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Likes erhalten:</span>
                        <span className="font-semibold">230</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Kommentare:</span>
                        <span className="font-semibold">120</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Gesamtpunkte:</span>
                        <span className="font-semibold">1200</span>
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
  );
}