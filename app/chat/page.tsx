// app/chat/page.tsx
"use client"

import { useState, useEffect, useRef } from 'react'
import { Sidebar } from "@/components/Sidebar"
import { UserNav } from "@/components/user-nav"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ImageModal } from "@/components/ui/image-modal"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { useChat } from '@/contexts/ChatContext'
import { useSession } from 'next-auth/react'
import { Hash, Send, Plus, Pencil, Check, X, Trash2, Image as ImageIcon, Maximize2 } from 'lucide-react'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { ChatMessage } from '@/types/chat'
import Image from 'next/image'

export default function ChatPage() {
  const { data: session } = useSession()
  const {
    channels,
    currentChannel,
    messages,
    setCurrentChannel,
    sendMessage,
    editMessage,
    createChannel,
    deleteChannel,
    loading,
    error
  } = useChat()

  const [newMessage, setNewMessage] = useState('')
  const [newChannelName, setNewChannelName] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false)
  const [editingMessage, setEditingMessage] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [selectedImageForModal, setSelectedImageForModal] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    if (editingMessage && editInputRef.current) {
      editInputRef.current.focus()
    }
  }, [editingMessage])

  useEffect(() => {
    return () => {
      if (imagePreview) {
        URL.revokeObjectURL(imagePreview)
      }
    }
  }, [imagePreview])

  const handleSendMessage = async () => {
    if (newMessage.trim() !== '' || selectedImage) {
      await sendMessage(newMessage, selectedImage || undefined)
      setNewMessage('')
      setSelectedImage(null)
      setImagePreview(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedImage(file)
      setImagePreview(URL.createObjectURL(file))
    }
  }

  const handleCreateChannel = async () => {
    if (newChannelName.trim() !== '') {
      await createChannel({ name: newChannelName, isPrivate })
      setNewChannelName('')
      setIsPrivate(false)
      setIsCreateChannelOpen(false)
    }
  }

  const handleStartEdit = (message: ChatMessage) => {
    setEditingMessage(message.id)
    setEditContent(message.content)
  }

  const handleSaveEdit = async () => {
    if (editingMessage && editContent.trim() !== '') {
      await editMessage({ messageId: editingMessage, content: editContent })
      setEditingMessage(null)
      setEditContent('')
    }
  }

  const handleCancelEdit = () => {
    setEditingMessage(null)
    setEditContent('')
  }

  const cancelImageUpload = () => {
    setSelectedImage(null)
    setImagePreview(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const canEditMessage = (message: ChatMessage) => {
    return session?.user?.id === message.author.id || session?.user?.role === 'ADMIN'
  }

  if (!session) {
    return <div className="flex items-center justify-center h-screen">
      <p>Bitte melden Sie sich an, um den Chat zu nutzen.</p>
    </div>
  }

  if (loading) {
    return <div className="flex items-center justify-center h-screen">
      <p>Laden...</p>
    </div>
  }

  if (error) {
    return <div className="flex items-center justify-center h-screen">
      <p>Fehler: {error}</p>
    </div>
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar className="hidden md:block" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="border-b">
          <div className="h-16 px-4 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <h2 className="text-lg font-semibold">
                {currentChannel ? `# ${currentChannel.name}` : 'Wähle einen Channel'}
              </h2>
              {currentChannel && (
                <div className="hidden md:flex items-center space-x-2 text-muted-foreground">
                  <span className="text-sm">{currentChannel._count.members} Mitglieder</span>
                </div>
              )}
            </div>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          <div className="w-64 border-r bg-muted/50 hidden md:flex flex-col">
            <div className="p-4 flex justify-between items-center">
              <h3 className="font-semibold">Channels</h3>
              {session.user.role === 'ADMIN' && (
                <Dialog open={isCreateChannelOpen} onOpenChange={setIsCreateChannelOpen}>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <Plus className="h-5 w-5" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Neuen Channel erstellen</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="name">Channel Name</Label>
                        <Input
                          id="name"
                          value={newChannelName}
                          onChange={(e) => setNewChannelName(e.target.value)}
                          placeholder="Channel Name eingeben"
                        />
                      </div>
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="private"
                          checked={isPrivate}
                          onCheckedChange={setIsPrivate}
                        />
                        <Label htmlFor="private">Privater Channel</Label>
                      </div>
                      <Button onClick={handleCreateChannel} className="w-full">
                        Channel erstellen
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
            </div>
            <ScrollArea className="flex-1">
              {channels.map((channel) => (
                <div
                  key={channel.id}
                  className={`group px-4 py-2 cursor-pointer hover:bg-accent ${currentChannel?.id === channel.id ? 'bg-accent' : ''
                    }`}
                  onClick={() => setCurrentChannel(channel)} // Click-Handler auf dem äußeren div
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Hash className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{channel.name}</span>
                    </div>
                    {session.user.role === 'ADMIN' && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()} // Verhindert Bubble-Up zum Parent
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Channel löschen</AlertDialogTitle>
                            <AlertDialogDescription>
                              Möchten Sie wirklich den Channel &quot;{channel.name}&quot; löschen?
                              Diese Aktion kann nicht rückgängig gemacht werden.
                              Alle Nachrichten in diesem Channel werden ebenfalls gelöscht.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel onClick={(e) => e.stopPropagation()}>
                              Abbrechen
                            </AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteChannel(channel.id);
                              }}
                            >
                              Löschen
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>
              ))}
            </ScrollArea>
          </div>

          <div className="flex-1 flex flex-col">
            <ScrollArea className="flex-1 p-4">
              {messages.map((message) => (
                <div key={message.id} className="mb-4">
                  <div className="flex items-start space-x-3">
                    <Avatar>
                      <AvatarImage src={message.author.image ?? undefined} />
                      <AvatarFallback>
                        {message.author.name?.[0] ?? '?'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold">
                          {message.author.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(message.createdAt), 'PPp', { locale: de })}
                        </span>
                        {message.isEdited && (
                          <span className="text-xs text-muted-foreground">(bearbeitet)</span>
                        )}
                      </div>
                      {editingMessage === message.id ? (
                        <div className="flex items-center space-x-2">
                          <Input
                            ref={editInputRef}
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleSaveEdit()}
                            className="flex-1"
                          />
                          <Button size="icon" onClick={handleSaveEdit}>
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={handleCancelEdit}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="group flex items-start">
                          <div className="flex-1 space-y-2">
                            <p className="text-sm leading-relaxed">
                              {message.content}
                            </p>
                            {message.imageUrl && (
                              <div className="relative inline-block group/image">
                                <div className="relative max-w-lg">
                                  <Image
                                    src={message.imageUrl ?? ''}
                                    alt="Nachrichtenbild"
                                    width={512}
                                    height={512}
                                    className="rounded-lg object-contain cursor-pointer"
                                    onClick={() => setSelectedImageForModal(message.imageUrl ?? null)}
                                  />
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="absolute top-2 right-2 opacity-0 group-hover/image:opacity-100 transition-opacity"
                                    onClick={() => setSelectedImageForModal(message.imageUrl ?? null)}
                                  >
                                    <Maximize2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                          {canEditMessage(message) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => handleStartEdit(message)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </ScrollArea>

            <div className="p-4 border-t space-y-4">
              {imagePreview && (
                <div className="relative inline-block">
                  <div className="relative w-32 h-32">
                    <Image
                      src={imagePreview}
                      alt="Vorschau"
                      fill
                      className="object-contain rounded-lg"
                    />
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute top-1 right-1"
                      onClick={cancelImageUpload}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
              <div className="flex items-center space-x-2">
                <Input
                  type="text"
                  placeholder="Nachricht schreiben..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  disabled={!currentChannel}
                />
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleImageSelect}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!currentChannel}
                >
                  <ImageIcon className="h-4 w-4" />
                </Button>
                <Button
                  onClick={handleSendMessage}
                  disabled={!currentChannel || (!newMessage.trim() && !selectedImage)}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Image Modal */}
      {selectedImageForModal && (
        <ImageModal
          isOpen={!!selectedImageForModal}
          onClose={() => setSelectedImageForModal(null)}
          imageUrl={selectedImageForModal}
        />
      )}
    </div>
  )
}
