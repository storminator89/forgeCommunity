import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ThumbsUp, Send, Loader2, CheckCircle2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { ReportControl } from './ReportControl'

const DEFAULT_AVATAR_URL = ''

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
  solutionEligible?: boolean
}

interface CommentSectionProps {
  postId: string
  comments: Comment[]
  currentUserId?: string
  canReport?: boolean
  canSelectSolution?: boolean
  acceptedCommentId?: string
  onSelectSolution?: (postId: string, commentId: string | null) => Promise<void>
  isLoading?: boolean
  hasMore?: boolean
  commentCount?: number
  onLoadMore?: () => void
  isLoadingMore?: boolean
  loadMoreError?: boolean
  onAddComment?: (postId: string, content: string) => Promise<void>
  onLikeComment?: (commentId: string, postId: string) => Promise<void>
}

export function CommentSection({
  postId,
  comments,
  currentUserId,
  canReport = true,
  canSelectSolution = false,
  acceptedCommentId,
  onSelectSolution,
  isLoading = false,
  hasMore = false,
  commentCount,
  onLoadMore,
  isLoadingMore = false,
  loadMoreError = false,
  onAddComment,
  onLikeComment
}: CommentSectionProps) {
  const [newCommentContent, setNewCommentContent] = useState('')
  const commentsStatusRef = useRef<HTMLParagraphElement>(null)
  const focusEndOfCommentsRef = useRef(false)

  useEffect(() => {
    if (focusEndOfCommentsRef.current && !hasMore && !isLoadingMore) {
      focusEndOfCommentsRef.current = false
      if (document.activeElement === document.body) commentsStatusRef.current?.focus()
    }
  }, [hasMore, isLoadingMore])

  useEffect(() => {
    const followHash = () => {
      const hash = window.location.hash.slice(1);
      if (comments?.some((comment) => hash === `comment-${comment.id}`)) {
        document.getElementById(hash)?.scrollIntoView({ block: 'center' });
      }
    };
    const timer = window.setTimeout(followHash, 0);
    window.addEventListener('hashchange', followHash);
    return () => { window.clearTimeout(timer); window.removeEventListener('hashchange', followHash); };
  }, [comments]);

  const handleSubmit = async () => {
    if (!newCommentContent.trim()) return
    try {
      await onAddComment?.(postId, newCommentContent)
      setNewCommentContent('')
    } catch (error) {
      console.error('Fehler beim Hinzufügen des Kommentars:', error)
    }
  }

  const handleKeyPress = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      await handleSubmit()
    }
  }

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="mt-4 space-y-4"
    >
      <div className="bg-card p-4 rounded-lg shadow-xs border border-border">
        <div className="relative flex items-center">
          <Input
            value={newCommentContent}
            onChange={(e) => setNewCommentContent(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Schreibe einen Kommentar..."
            aria-label="Kommentar schreiben"
            className="pr-10 bg-muted/50 border-input"
            disabled={isLoading}
          />
          <Button
            onClick={handleSubmit}
            type="button"
            aria-label="Kommentar senden"
            disabled={isLoading || !newCommentContent.trim()}
            className="absolute right-2 p-1 hover:bg-accent text-foreground rounded-full flex items-center justify-center transition-colors duration-200"
            size="icon"
            variant="ghost"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <Send className="h-4 w-4 text-primary" />
            )}
          </Button>
        </div>
      </div>

      {(comments || []).map((comment) => (
        <Card id={`comment-${comment.id}`} key={comment.id} className="bg-card p-3 rounded-lg shadow-xs border border-border">
          <CardContent className="p-0">
            <div className="flex items-center space-x-3 mb-2">
              <Avatar className="h-6 w-6">
                <AvatarImage
                  src={comment.author?.image || DEFAULT_AVATAR_URL}
                  alt={comment.author?.name || 'Anonym'}
                />
                <AvatarFallback className="text-xs bg-primary/10 text-primary">{comment.author?.name?.[0] || 'A'}</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium text-foreground">
                {comment.author?.name || 'Anonym'}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(comment.createdAt).toLocaleDateString('de-DE', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
            </div>
            {acceptedCommentId === comment.id && <p className="mb-2 pl-9 text-sm font-medium text-primary">
              <CheckCircle2 className="mr-1 inline h-4 w-4" aria-hidden="true" /> Vom Beitragsautor als Lösung ausgewählt
            </p>}
            <p className="text-sm text-foreground/90 leading-relaxed pl-9">
              {comment.content}
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-2 pl-9">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onLikeComment?.(comment.id, postId)}
                      aria-label={comment.isLiked ? 'Kommentar-Like entfernen' : 'Kommentar liken'}
                      className={`hover:bg-accent flex items-center space-x-1 rounded-md p-2 h-auto py-1 transition-colors duration-200 ${comment.isLiked ? 'text-destructive bg-destructive/10 hover:bg-destructive/20' : 'text-muted-foreground'
                        }`}
                      disabled={isLoading}
                    >
                      <ThumbsUp className={cn("h-3 w-3 mr-1.5", comment.isLiked && "fill-current")} />
                      <span className="text-xs font-medium">{comment.votes}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{comment.isLiked ? 'Like entfernen' : 'Kommentar liken'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {canSelectSolution && currentUserId !== comment.authorId && comment.solutionEligible !== false && onSelectSolution &&
                <Button type="button" size="sm" variant="outline" disabled={isLoading}
                  aria-pressed={acceptedCommentId === comment.id}
                  aria-label={acceptedCommentId === comment.id ? 'Lösungsauswahl für diese Antwort entfernen' : 'Diese Antwort als Lösung auswählen'}
                  onClick={() => void onSelectSolution(postId, acceptedCommentId === comment.id ? null : comment.id)}>
                  <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {acceptedCommentId === comment.id ? 'Auswahl entfernen' : 'Als Lösung auswählen'}
                </Button>}
              {canReport && currentUserId && currentUserId !== comment.authorId &&
                <ReportControl targetType="COMMENT" targetId={comment.id} />}
            </div>
          </CardContent>
        </Card>
      ))}
      {loadMoreError && <p role="alert" className="text-sm text-destructive">Weitere Kommentare konnten nicht geladen werden.</p>}
      {hasMore && <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={event => {
        focusEndOfCommentsRef.current = document.activeElement === event.currentTarget
        onLoadMore?.()
      }} disabled={isLoadingMore || isLoading}>
        {isLoadingMore ? 'Kommentare werden geladen…' : loadMoreError ? 'Kommentare erneut laden' : 'Weitere Kommentare laden'}
      </Button>}
      <p ref={commentsStatusRef} tabIndex={-1} role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {comments.length} {comments.length === 1 ? 'Kommentar' : 'Kommentare'} geladen{commentCount !== undefined ? `, ${commentCount} insgesamt` : ''}{!hasMore && comments.length > 0 ? '. Ende der Kommentare.' : '.'}
      </p>
    </motion.div>
  )
}
