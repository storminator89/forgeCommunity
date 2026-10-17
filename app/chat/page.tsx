// app/chat/page.tsx
"use client"

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: editorial · macrostructure: split conversation · design-system: design.md · designed-as-app */

import { AppShell, AppHeader } from '@/components/app-shell';
import { Suspense, useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Sidebar } from "@/components/Sidebar"
import { UserNav } from "@/components/user-nav"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { useSession } from '@/lib/sites-auth/react'
import { Hash, Send, Plus, Pencil, Check, X, Trash2, Image as ImageIcon, PanelLeft } from 'lucide-react'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { ChatMessage } from '@/types/chat'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { ChatImagePreparationError, normalizeChatImage } from '@/lib/chat-image-normalize'

interface ImageModalSelection {
  imageUrl: string
  opener: HTMLButtonElement
}

export default function ChatPage() {
  const { data, status } = useSession()
  const session = status === 'authenticated' ? data : null
  const accountKey = `${session?.user?.id ?? 'anonymous'}:${session?.user?.role ?? 'none'}`
  return <Suspense fallback={<div role="status" className="p-6">Chat wird geladen …</div>}><ChatPageContent key={accountKey} /></Suspense>
}

function ChatPageContent() {
  const searchParams = useSearchParams()
  const linkedChannelId = searchParams.get('channelId')
  const linkedMessageId = searchParams.get('messageId')
  const linkedTarget = useMemo(() => linkedChannelId && linkedMessageId &&
    /^[A-Za-z0-9_-]{1,100}$/.test(linkedChannelId) && /^[A-Za-z0-9_-]{1,100}$/.test(linkedMessageId)
      ? { channelId: linkedChannelId, messageId: linkedMessageId }
      : null, [linkedChannelId, linkedMessageId])
  const { data, status } = useSession()
  const session = status === 'authenticated' ? data : null
  const {
    channels,
    currentChannel,
    messages,
    hasOlderMessages,
    loadingOlderMessages,
    loadedChannelId,
    hasNewerMessages,
    loadOlderMessages,
    markRead,
    setCurrentChannel,
    sendMessage,
    editMessage,
    createChannel,
    deleteChannel,
    loading,
    error,
    sendError,
    clearError
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
  const [isPreparingImage, setIsPreparingImage] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [selectedImageForModal, setSelectedImageForModal] = useState<ImageModalSelection | null>(null)
  const [showChannelsMobile, setShowChannelsMobile] = useState(false)
  const [linkedMessage, setLinkedMessage] = useState<ChatMessage | null>(null)
  const [linkedErrorKey, setLinkedErrorKey] = useState<string | null>(null)
  const messageLogRef = useRef<HTMLDivElement>(null)
  const followLatestRef = useRef(true)
  const previousChannelRef = useRef<string | null>(null)
  const olderScrollAnchorRef = useRef<{ channelId: string; oldestId: string; scrollTop: number; scrollHeight: number } | null>(null)
  const focusedLinkedMessageRef = useRef<string | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imagePreparationRef = useRef(0)
  const preparingImageRef = useRef(false)
  const sendingRef = useRef(false)
  const pageActiveRef = useRef(false)
  const closingImageModalRef = useRef<ImageModalSelection | null>(null)
  const selectedImageRef = useRef<File | null>(null)
  const messageDraftRef = useRef('')

  useLayoutEffect(() => {
    pageActiveRef.current = true
    return () => {
      // Invalidate pending work during the account/unmount commit, before an
      // old bitmap promise or retained event callback can update a new draft.
      pageActiveRef.current = false
      closingImageModalRef.current = null
      imagePreparationRef.current++
      preparingImageRef.current = false
      selectedImageRef.current = null
      messageDraftRef.current = ''
    }
  }, [])

  useEffect(() => {
    if (!linkedTarget || loading || !session) return
    const channel = channels.find(item => item.id === linkedTarget.channelId)
    if (!channel) return
    if (currentChannel?.id !== channel.id) setCurrentChannel(channel)
  }, [linkedTarget, loading, session, channels, currentChannel?.id, setCurrentChannel])

  useEffect(() => {
    if (!linkedTarget || currentChannel?.id !== linkedTarget.channelId) return
    const controller = new AbortController()
    void fetch(`/api/chat/messages/${encodeURIComponent(linkedTarget.messageId)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Linked message unavailable')
        return response.json() as Promise<ChatMessage>
      })
      .then(message => {
        if (controller.signal.aborted) return
        if (message.id !== linkedTarget.messageId || message.channelId !== linkedTarget.channelId) throw new Error('Wrong linked message')
        setLinkedMessage(message)
        setLinkedErrorKey(null)
      })
      .catch(() => { if (!controller.signal.aborted) setLinkedErrorKey(`${linkedTarget.channelId}:${linkedTarget.messageId}`) })
    return () => controller.abort()
  }, [linkedTarget, currentChannel?.id])

  const targetMessage = linkedMessage
  const displayedMessages: ChatMessage[] = targetMessage && targetMessage.channelId === currentChannel?.id && targetMessage.id === linkedTarget?.messageId && !messages.some(message => message.id === targetMessage.id)
    ? [...messages, targetMessage].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id))
    : messages

  const latestPersistedMessage = [...messages].reverse().find(message => !message.id.startsWith('temp-'))
  const latestPersistedId = latestPersistedMessage?.id ?? null
  const canMarkLatest = currentChannel && loadedChannelId === currentChannel.id && !loading &&
    !hasNewerMessages && !showChannelsMobile &&
    (displayedMessages.length === 0 || displayedMessages[displayedMessages.length - 1]?.id === latestPersistedId)

  const markVisibleLatestRead = useCallback(() => {
    if (!canMarkLatest || document.visibilityState !== 'visible' || !document.hasFocus()) return
    const log = messageLogRef.current
    if (!log || !log.isConnected || log.scrollHeight - log.scrollTop - log.clientHeight >= 80) return
    const logRect = log.getBoundingClientRect()
    if (logRect.width <= 0 || logRect.height <= 0 || logRect.bottom <= 0 || logRect.top >= window.innerHeight) return
    if (latestPersistedId) {
      const last = document.getElementById(`chat-message-${latestPersistedId}`)
      if (!last || !log.contains(last)) return
      const lastRect = last.getBoundingClientRect()
      // Seeing an earlier part of a tall last message is insufficient. The
      // bottom of the newest persisted message must actually be in view.
      if (lastRect.bottom > logRect.bottom + 1 || lastRect.bottom <= logRect.top) return
    }
    void markRead(currentChannel.id, latestPersistedId)
  }, [canMarkLatest, currentChannel, latestPersistedId, markRead])

  useEffect(() => {
    markVisibleLatestRead()
    const retryInterval = setInterval(markVisibleLatestRead, 10000)
    window.addEventListener('focus', markVisibleLatestRead)
    window.addEventListener('resize', markVisibleLatestRead)
    document.addEventListener('visibilitychange', markVisibleLatestRead)
    return () => {
      clearInterval(retryInterval)
      window.removeEventListener('focus', markVisibleLatestRead)
      window.removeEventListener('resize', markVisibleLatestRead)
      document.removeEventListener('visibilitychange', markVisibleLatestRead)
    }
  }, [markVisibleLatestRead])

  useLayoutEffect(() => {
    const log = messageLogRef.current
    if (!log) return
    if (previousChannelRef.current !== (currentChannel?.id ?? null)) {
      previousChannelRef.current = currentChannel?.id ?? null
      olderScrollAnchorRef.current = null
      followLatestRef.current = true
    }
    const anchor = olderScrollAnchorRef.current
    if (anchor && anchor.channelId === currentChannel?.id) {
      if (messages[0]?.id !== anchor.oldestId) {
        log.scrollTop = anchor.scrollTop + log.scrollHeight - anchor.scrollHeight
        olderScrollAnchorRef.current = null
      } else if (!loadingOlderMessages) {
        olderScrollAnchorRef.current = null
      }
      return
    }
    if (linkedTarget && currentChannel?.id === linkedTarget.channelId) return
    if (followLatestRef.current) log.scrollTop = log.scrollHeight
  }, [messages, loadingOlderMessages, linkedTarget, currentChannel?.id])

  const handleLoadOlder = () => {
    const log = messageLogRef.current
    const oldest = messages[0]
    if (!log || !currentChannel || !oldest || loadingOlderMessages) return
    olderScrollAnchorRef.current = {
      channelId: currentChannel.id,
      oldestId: oldest.id,
      scrollTop: log.scrollTop,
      scrollHeight: log.scrollHeight,
    }
    void loadOlderMessages()
  }

  useEffect(() => {
    if (!linkedTarget || currentChannel?.id !== linkedTarget.channelId ||
        !(messages.some(message => message.id === linkedTarget.messageId) || linkedMessage?.id === linkedTarget.messageId)) return
    const focusKey = `${linkedTarget.channelId}:${linkedTarget.messageId}`
    if (focusedLinkedMessageRef.current === focusKey) return
    const element = document.getElementById(`chat-message-${linkedTarget.messageId}`)
    element?.scrollIntoView({ block: 'center' })
    element?.focus({ preventScroll: true })
    if (element) focusedLinkedMessageRef.current = focusKey
  }, [linkedTarget, currentChannel?.id, linkedMessage?.id, messages])

  const linkedError = Boolean(linkedTarget && (
    linkedErrorKey === `${linkedTarget.channelId}:${linkedTarget.messageId}` ||
    (!loading && session && !channels.some(channel => channel.id === linkedTarget.channelId))
  ))

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
    const content = messageDraftRef.current
    const image = selectedImageRef.current
    if (!pageActiveRef.current || !currentChannel || sendingRef.current || preparingImageRef.current || (!content.trim() && !image)) return
    // State disables the controls after render; refs close the same-event-turn
    // gap and keep retained handlers from sending a superseded image or draft.
    sendingRef.current = true
    setIsSending(true)
    try {
      const sent = await sendMessage(content, image || undefined)
      if (sent && pageActiveRef.current) {
        messageDraftRef.current = ''
        selectedImageRef.current = null
        setNewMessage('')
        setSelectedImage(null)
        setImagePreview(null)
        setImageError(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    } finally {
      sendingRef.current = false
      if (pageActiveRef.current) setIsSending(false)
    }
  }

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Allow the same file to be selected again after a preparation failure.
    e.target.value = ''
    if (!file || !pageActiveRef.current || sendingRef.current || preparingImageRef.current) return
    const preparation = ++imagePreparationRef.current
    preparingImageRef.current = true
    setIsPreparingImage(true)
    setImageError(null)
    try {
      const normalized = await normalizeChatImage(file)
      if (!pageActiveRef.current || preparation !== imagePreparationRef.current) return
      const preview = URL.createObjectURL(normalized)
      selectedImageRef.current = normalized
      setSelectedImage(normalized)
      setImagePreview(preview)
    } catch (error) {
      if (!pageActiveRef.current || preparation !== imagePreparationRef.current) return
      const message = error instanceof ChatImagePreparationError ? error.message : 'Das Bild konnte nicht vorbereitet werden. Bitte wähle ein anderes Bild.'
      setImageError(selectedImageRef.current ? `${message} Das bisherige Bild bleibt ausgewählt.` : message)
    } finally {
      if (pageActiveRef.current && preparation === imagePreparationRef.current) {
        preparingImageRef.current = false
        setIsPreparingImage(false)
      }
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
    if (!pageActiveRef.current || sendingRef.current) return
    imagePreparationRef.current++
    preparingImageRef.current = false
    selectedImageRef.current = null
    setIsPreparingImage(false)
    setImageError(null)
    setSelectedImage(null)
    setImagePreview(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const canEditMessage = (message: ChatMessage) => {
    return session?.user?.id === message.author.id || session?.user?.role === 'ADMIN'
  }

  if (!session || loading) {
    return (
      <AppShell data-page-family="chat">
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <AppHeader><div className="app-header-row"><h1 className="app-header-title">Chat</h1><div className="app-header-actions"><ThemeToggle /><UserNav /></div></div></AppHeader>
          <main id="page-content" tabIndex={-1} className="flex flex-1 items-center justify-center p-6 text-center">
            <div role="status" className="rounded-xl border bg-card p-8">
              <p className="text-muted-foreground">{!session ? 'Bitte melde dich an, um den Chat zu nutzen.' : 'Chat wird geladen …'}</p>
            </div>
          </main>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell data-page-family="chat">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="app-header-row">
            <h1 className="app-header-title">Chat</h1>
            <div className="app-header-actions">
              <Button type="button" variant="ghost" size="icon" className="md:hidden" aria-label={showChannelsMobile ? 'Zur Unterhaltung' : 'Channels öffnen'} aria-controls="chat-channel-list" aria-expanded={showChannelsMobile} onClick={() => setShowChannelsMobile(value => !value)}><PanelLeft className="h-5 w-5" aria-hidden="true" /></Button>
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </AppHeader>

        {error && <div role="alert" className="mx-4 my-2 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-card px-4 py-3 text-sm text-destructive sm:mx-6">
          <p className="min-w-0 flex-1">{sendError === error ? sendError : 'Chat konnte nicht geladen oder geändert werden. Bitte versuche es erneut.'}</p>
          <Button type="button" variant="outline" onClick={clearError}>Meldung schließen</Button>
          {channels.length === 0 && <Button type="button" variant="outline" onClick={() => window.location.reload()}>Chat neu laden</Button>}
        </div>}

        <div id="page-content" role="main" tabIndex={-1} className="flex min-h-0 flex-1 overflow-hidden">
          <aside id="chat-channel-list" aria-label="Chat-Channels" className={cn('fc-chat-channels min-h-0 min-w-0 flex-col bg-card', showChannelsMobile ? 'flex flex-1' : 'hidden', 'md:flex md:w-64 md:flex-none')}>
            <div className="flex min-h-16 items-center justify-between border-b px-4 py-2">
              <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Channels <span className="ml-1 tabular-nums">{channels.length}</span></h2>
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
            <nav aria-label="Chat-Channels" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3">
              {channels.map((channel) => (
                <div key={channel.id} className="group flex min-w-0 items-center rounded-[10px]">
                  <button
                    type="button"
                    className={`relative flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-[10px] px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${currentChannel?.id === channel.id ? 'bg-accent/70 font-semibold text-foreground before:absolute before:bottom-2 before:left-0 before:top-2 before:w-0.5 before:rounded-full before:bg-primary' : 'text-muted-foreground'}`}
                    aria-current={currentChannel?.id === channel.id ? 'page' : undefined}
                    aria-label={channel.hasUnread ? `${channel.name}, ungelesene Nachrichten` : channel.name}
                    onClick={() => { setCurrentChannel(channel); setShowChannelsMobile(false) }}
                  >
                    <Hash className={cn('h-4 w-4 shrink-0', currentChannel?.id === channel.id && 'text-primary')} aria-hidden="true" />
                    <span className="min-w-0 truncate">{channel.name}</span>
                    {channel.hasUnread && <span aria-hidden="true" className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
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
              {channels.length === 0 && <p className="px-4 pb-4 text-sm text-muted-foreground">Noch keine Channels vorhanden.</p>}
            </nav>
          </aside>

          <section aria-label="Unterhaltung" className={cn('fc-chat-conversation min-h-0 min-w-0 flex-1 flex-col', showChannelsMobile ? 'hidden' : 'flex', 'md:flex')}>
            <div className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
              <div className="min-w-0">
                <h2 className="min-w-0 truncate text-base font-semibold tracking-tight">{currentChannel ? '# ' + currentChannel.name : 'Unterhaltung'}</h2>
                {currentChannel && <p className="text-xs text-muted-foreground">{currentChannel._count.members} Mitglieder</p>}
              </div>
              <Button type="button" variant="outline" size="sm" className="md:hidden" onClick={() => setShowChannelsMobile(true)}>Channels</Button>
            </div>
            <div ref={messageLogRef} role="log" aria-label="Nachrichten" className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6" onScroll={event => {
              const log = event.currentTarget
              followLatestRef.current = log.scrollHeight - log.scrollTop - log.clientHeight < 80
              markVisibleLatestRead()
            }}>
              {linkedError && <p role="status" className="mb-4 rounded-lg border p-3 text-sm text-muted-foreground">Die verlinkte Nachricht ist nicht mehr verfügbar.</p>}
              {hasOlderMessages && <div className="mb-3 flex justify-center"><Button type="button" size="sm" variant="outline" disabled={loadingOlderMessages} onClick={handleLoadOlder}>{loadingOlderMessages ? 'Lade Nachrichten…' : 'Ältere Nachrichten laden'}</Button></div>}
              {displayedMessages.length === 0 && (
                <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center" role="status">
                  <Hash className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                  <h3 className="font-semibold">{currentChannel ? `Willkommen in # ${currentChannel.name}` : 'Wähle einen Channel'}</h3>
                  <p className="text-sm text-muted-foreground">{currentChannel ? 'Starte die Unterhaltung mit einer Nachricht.' : 'Öffne einen Channel, um die Unterhaltung zu sehen.'}</p>
                  {!currentChannel && <Button type="button" variant="outline" className="mt-3 md:hidden" onClick={() => setShowChannelsMobile(true)}>Channels ansehen</Button>}
                </div>
              )}
              {displayedMessages.map((message) => (
                <article id={`chat-message-${message.id}`} tabIndex={-1} key={message.id} className={cn('fc-chat-message py-4 first:pt-0', linkedTarget?.messageId === message.id && 'rounded-lg bg-accent/50 px-3 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring')}>
                  <div className="flex min-w-0 items-start gap-3">
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarImage src={message.author.image ?? undefined} alt="" />
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
                        <div className="flex min-w-0 items-center gap-2">
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
                        <div className="group flex min-w-0 items-start gap-2">
                          <div className="min-w-0 flex-1 space-y-2">
                            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">
                              {message.content}
                            </p>
                            {message.imageUrl && (
                              <button type="button" className="block w-fit min-h-11 min-w-11 max-w-lg rounded-[10px] text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" aria-label="Nachrichtenbild vergrößern" onClick={event => {
                                if (!message.imageUrl || !pageActiveRef.current) return
                                closingImageModalRef.current = null
                                setSelectedImageForModal({ imageUrl: message.imageUrl, opener: event.currentTarget })
                              }}>
                                  <Image
                                    src={message.imageUrl ?? ''}
                                    alt=""
                                    width={512}
                                    height={512}
                                    unoptimized
                                    className="block h-auto w-auto max-w-full rounded-[10px] border object-contain"
                                  />
                              </button>
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
                </article>
              ))}
            </div>

            <div className="fc-chat-composer space-y-4 border-t bg-card px-4 py-3 sm:px-6">
              {imageError && <p role="alert" className="text-sm text-destructive">{imageError}</p>}
              {isPreparingImage && <div className="flex items-center gap-3 text-sm">
                <p role="status">Bild wird lokal vorbereitet …</p>
                <Button type="button" variant="outline" size="sm" onClick={cancelImageUpload}>Abbrechen</Button>
              </div>}
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
                      disabled={isSending}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
              <div className="flex min-w-0 items-center gap-2">
                <Input
                  type="text"
                  placeholder="Nachricht schreiben…"
                  value={newMessage}
                  onChange={(e) => {
                    if (sendingRef.current) return
                    messageDraftRef.current = e.target.value
                    setNewMessage(e.target.value)
                  }}
                  aria-label="Nachricht"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); handleSendMessage() } }}
                  className="min-w-0 flex-1"
                  disabled={!currentChannel || isSending}
                />
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleImageSelect}
                  disabled={!currentChannel || isSending || isPreparingImage}
                  aria-describedby="chat-image-notice"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Bild anhängen"
                  aria-describedby="chat-image-notice"
                  className="shrink-0"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!currentChannel || isSending || isPreparingImage}
                >
                  <ImageIcon className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  onClick={handleSendMessage}
                  aria-label="Nachricht senden"
                  aria-busy={isSending}
                  className="shrink-0"
                  disabled={isSending || isPreparingImage || !currentChannel || (!newMessage.trim() && !selectedImage)}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <details className="text-xs text-muted-foreground">
                <summary className="w-fit cursor-pointer rounded-sm py-1 leading-relaxed focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                  <span id="chat-image-notice">Bilder werden mit der Nachricht gesendet.</span>{' '}
                  <span className="underline underline-offset-2">Details</span>
                </summary>
                <p className="mt-1 max-w-prose leading-relaxed">JPEG, PNG, WebP oder GIF bis 5 MiB. Bilder werden auf diesem Gerät als PNG verkleinert (max. 1 MP, 1600 px pro Seite). Animationen werden als Standbild gesendet (Standardbild bzw. erster Frame).</p>
              </details>
            </div>
          </section>
        </div>
      </div>

      {/* Image Modal */}
      {selectedImageForModal && (
        <ImageModal
          isOpen={!!selectedImageForModal}
          onClose={() => {
            if (!pageActiveRef.current) return
            closingImageModalRef.current = selectedImageForModal
            setSelectedImageForModal(null)
          }}
          onCloseAutoFocus={event => {
            event.preventDefault()
            // Radix defers this event: a newer viewer or account must not
            // receive focus from an older dialog's teardown.
            if (!pageActiveRef.current || closingImageModalRef.current !== selectedImageForModal) return
            closingImageModalRef.current = null
            if (selectedImageForModal.opener.isConnected) selectedImageForModal.opener.focus({ preventScroll: true })
          }}
          imageUrl={selectedImageForModal.imageUrl}
        />
      )}
    </AppShell>
  )
}
