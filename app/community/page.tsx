"use client"

import { useState } from 'react'
import { users, posts } from '@/src/data/sampleData'
import { Button } from "@/components/ui/button"
import { UserNav } from "@/components/user-nav"
import { Sidebar } from "@/components/Sidebar"
import { ThemeToggle } from "@/components/theme-toggle"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

export default function Community() {
  const [localPosts, setLocalPosts] = useState(posts)
  const [newPost, setNewPost] = useState({ title: '', content: '' })
  const [isOpen, setIsOpen] = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    const post = {
      id: String(localPosts.length + 1),
      title: newPost.title,
      content: newPost.content,
      authorId: '1', // Assuming the current user has ID 1
      createdAt: new Date().toISOString()
    }
    setLocalPosts([post, ...localPosts])
    setNewPost({ title: '', content: '' })
    setIsOpen(false)
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
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="mb-6">
              <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogTrigger asChild>
                  <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white">Neuer Beitrag</Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                  <DialogHeader>
                    <DialogTitle>Neuen Beitrag erstellen</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleSubmit} className="space-y-4">
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
                      <Textarea
                        id="content"
                        value={newPost.content}
                        onChange={(e) => setNewPost({...newPost, content: e.target.value})}
                        placeholder="Was möchtest du mitteilen?"
                        rows={5}
                      />
                    </div>
                    <Button type="submit" className="w-full">Beitrag veröffentlichen</Button>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
            <div className="space-y-6">
              {localPosts.map((post) => (
                <div key={post.id} className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
                  <h3 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">{post.title}</h3>
                  <p className="text-gray-600 dark:text-gray-300 mb-4">{post.content}</p>
                  <div className="flex items-center space-x-3 text-sm text-gray-500 dark:text-gray-400">
                    <img src={users.find(u => u.id === post.authorId)?.image} alt="" className="w-8 h-8 rounded-full" />
                    <span className="font-medium text-gray-700 dark:text-gray-200">{users.find(u => u.id === post.authorId)?.name}</span>
                    <span>•</span>
                    <span>{new Date(post.createdAt).toLocaleDateString('de-DE', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}