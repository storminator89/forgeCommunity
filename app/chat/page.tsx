// app/chat/page.tsx
"use client"

import { AppShell, AppHeader } from '@/components/app-shell';
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
  const [isSending, setIsSending] = useState(false)
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
    if (!currentChannel || isSending || (!newMessage.trim() && !selectedImage)) return
    setIsSending(true)
    try {
      await sendMessage(newMessage, selectedImage || undefined)
      setNewMessage('')
      setSelectedImage(null)
      setImagePreview(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } finally {
      setIsSending(false)
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

  if (!session || loading || error) {
    return (
      <AppShell>
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <AppHeader><div className="flex items-center justify-between gap-3"><h1>Community-Chat</h1><div className="flex items-center gap-2"><ThemeToggle /><UserNav /></div></div></AppHeader>
          <main id="page-content" tabIndex={-1} className="flex flex-1 items-center justify-center p-6 text-center">
            <div role={error ? 'alert' : 'status'} className="rounded-xl border bg-card p-8">
              <p className={error ? 'text-destructive' : 'text-muted-foreground'}>{error ? `Fehler: ${error}` : !session ? 'Bitte melde dich an, um den Chat zu nutzen.' : 'Chat wird geladen …'}</p>
            </div>
          </main>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-lg font-semibold">
                {currentChannel ? `# ${currentChannel.name}` : 'Wähle einen Channel'}
              </h1>
              {currentChannel && (
                <div className="hidden md:flex items-center space-x-2 text-muted-foreground">
                  <span className="text-sm">{currentChannel._count.members} Mitglieder</span>
                </div>
              )}
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </AppHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          <div className="flex max-h-48 shrink-0 flex-col border-b bg-card md:max-h-none md:w-60 md:border-b-0 md:border-r">
            <div className="flex items-center justify-between px-4 py-2 md:py-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Channels <span className="ml-1">{channels.length}</span></h3>
              {session.user.role === 'ADMIN' && (
                <Dialog open={isCreateChannelOpen} onOpenChange={setIsCreateChannelOpen}>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Neuen Channel erstellen">
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
                      <Button onClick={handleCreateChannel} disabled={!newChannelName.trim()} className="w-full">
                        Channel erstellen
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <nav aria-label="Chat-Channels" className="flex flex-wrap gap-1 px-3 pb-3 md:block md:space-y-1">
              {channels.map((channel) => (
                <div key={channel.id} className="group flex min-w-0 items-center rounded-lg border border-border/60 md:border-0">
                  <button
                    type="button"
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${currentChannel?.id === channel.id ? 'bg-accent font-semibold text-primary' : 'text-muted-foreground'}`}
                    aria-current={currentChannel?.id === channel.id ? 'page' : undefined}
                    onClick={() => setCurrentChannel(channel)}
                  >
                    <Hash className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="max-w-40 truncate">{channel.name}</span>
                  </button>
                    {session.user.role === 'ADMIN' && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                            aria-label={`Channel ${channel.name} löschen`}
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
              ))}
              </nav>
              {channels.length === 0 && <p className="px-4 pb-4 text-sm text-muted-foreground">Noch keine Channels vorhanden.</p>}
            </ScrollArea>
          </div>

          <main id="page-content" tabIndex={-1} className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ScrollArea className="min-h-0 flex-1 p-4">
              {messages.length === 0 && (
                <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center">
                  <Hash className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                  <h3 className="font-semibold">{currentChannel ? `Willkommen in # ${currentChannel.name}` : 'Wähle einen Channel'}</h3>
                  <p className="text-sm text-muted-foreground">{currentChannel ? 'Starte die Unterhaltung mit einer Nachricht.' : 'Öffne einen Channel, um die Unterhaltung zu sehen.'}</p>
                </div>
              )}
              {messages.map((message) => (
                <div key={message.id} className="mb-4">
                  <div className="flex items-start space-x-3">
                    <Avatar>
                      <AvatarImage src={message.author.image ?? undefined} />
                      <AvatarFallback>
                        {message.author.name?.[0] ?? '?'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="break-words font-semibold">
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
                            aria-label="Nachricht bearbeiten"
                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleSaveEdit(); if (e.key === 'Escape') handleCancelEdit() }}
                            className="flex-1"
                          />
                          <Button size="icon" aria-label="Änderung speichern" onClick={handleSaveEdit}>
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" aria-label="Bearbeitung abbrechen" onClick={handleCancelEdit}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="group flex items-start">
                          <div className="min-w-0 flex-1 space-y-2">
                            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">
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
                                    unoptimized
                                    className="h-auto max-w-full rounded-lg object-contain cursor-pointer"
                                    onClick={() => setSelectedImageForModal(message.imageUrl ?? null)}
                                  />
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="absolute top-2 right-2 opacity-100 transition-opacity md:opacity-0 md:group-hover/image:opacity-100 md:group-focus-within/image:opacity-100"
                                    aria-label="Nachrichtenbild vergrößern"
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
                              className="shrink-0 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                              aria-label="Nachricht bearbeiten"
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
                      aria-label="Bild entfernen"
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
                  aria-label="Nachricht"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); handleSendMessage() } }}
                  className="min-w-0"
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
                  aria-label="Bild anhängen"
                  className="shrink-0"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!currentChannel}
                >
                  <ImageIcon className="h-4 w-4" />
                </Button>
                <Button
                  onClick={handleSendMessage}
                  aria-label="Nachricht senden"
                  aria-busy={isSending}
                  className="shrink-0"
                  disabled={isSending || !currentChannel || (!newMessage.trim() && !selectedImage)}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </main>
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
    </AppShell>
  )
}
