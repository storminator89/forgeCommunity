import { useEffect, useId, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ThumbsUp, Send, Loader2, CheckCircle2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { ReportControl } from './ReportControl'
import { useCommentActionFocus } from './useCommentActionFocus'
import { formatDistanceToNow } from 'date-fns'
import { de } from 'date-fns/locale'

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
  onCommentDraftChange?: (instance: symbol, dirty: boolean) => void
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
  onLikeComment,
  onCommentDraftChange,
}: CommentSectionProps) {
  const [newCommentContent, setNewCommentContent] = useState('')
  const [draftInstance] = useState(() => Symbol('comment-draft'))
  const draftDirtyRef = useRef(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const errorId = useId()
  const inputId = useId()
  const shortcutId = useId()
  const commentInputRef = useRef<HTMLTextAreaElement>(null)
  const reduceMotion = useReducedMotion()
  const isBusy = isLoading || isSubmitting
  const actionFocus = useCommentActionFocus(postId, currentUserId, isBusy)
  const commentsStatusRef = useRef<HTMLParagraphElement>(null)
  const focusEndOfCommentsRef = useRef(false)

  // Report only a local dirty signal. Each mounted editor owns its registration,
  // including during effect replay; the comment text stays in this component.
  useEffect(() => {
    onCommentDraftChange?.(draftInstance, draftDirtyRef.current)
    return () => onCommentDraftChange?.(draftInstance, false)
  }, [draftInstance, onCommentDraftChange])

  const updateCommentContent = (content: string) => {
    setNewCommentContent(content)
    draftDirtyRef.current = Boolean(content.trim())
    onCommentDraftChange?.(draftInstance, draftDirtyRef.current)
  }

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

  const handleSubmit = async (origin: HTMLElement) => {
    if (!newCommentContent.trim() || !onAddComment || isLoading || submittingRef.current) return
    submittingRef.current = true
    setIsSubmitting(true)
    setSubmitError(null)
    const focus = actionFocus.begin(origin, commentInputRef.current)
    try {
      await onAddComment(postId, newCommentContent)
      updateCommentContent('')
    } catch (error) {
      console.error('Fehler beim Hinzufügen des Kommentars:', error)
      setSubmitError('Dein Kommentar konnte gerade nicht gesendet werden. Dein Text bleibt hier erhalten. Bitte versuche es erneut.')
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
      actionFocus.complete(focus)
    }
  }

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey &&
        !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
      e.preventDefault()
      if (e.repeat) return
      await handleSubmit(e.currentTarget)
    }
  }

  return (
    <motion.div
      initial={reduceMotion ? false : { height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.2 }}
      className="space-y-5"
    >
      <form className="rounded-[14px] border border-input bg-card p-3" aria-label="Kommentar verfassen" aria-busy={isSubmitting}
        onSubmit={event => {
          event.preventDefault()
          const origin = (event.nativeEvent as SubmitEvent).submitter
          void handleSubmit(origin instanceof HTMLElement ? origin : commentInputRef.current ?? event.currentTarget)
        }}>
          <label htmlFor={inputId} className="sr-only">Kommentar schreiben</label>
          <Textarea
            id={inputId}
            ref={commentInputRef}
            value={newCommentContent}
            onChange={(e) => updateCommentContent(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder="Dein Kommentar …"
            aria-label="Kommentar schreiben"
            aria-invalid={Boolean(submitError)}
            aria-describedby={`${shortcutId}${submitError ? ` ${errorId}` : ''}`}
            className="max-h-64 min-h-[80px] resize-y border-0 bg-transparent p-1 shadow-none focus-visible:ring-offset-0"
            disabled={isBusy}
          />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
          <p id={shortcutId} className="text-xs text-muted-foreground">Strg/⌘ + Enter zum Senden</p>
          <Button
            type="submit"
            aria-label="Kommentar senden"
            disabled={isBusy || !newCommentContent.trim()}
            aria-busy={isSubmitting}
            className="ml-auto h-11"
          >
            {isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            {isSubmitting ? 'Wird gesendet …' : 'Senden'}
          </Button>
        </div>
        {submitError && <p id={errorId} role="alert" className="mt-3 text-sm leading-6 text-destructive">{submitError}</p>}
      </form>

      <div className="space-y-5">
      {(comments || []).map((comment) => (
        <article id={`comment-${comment.id}`} key={comment.id} aria-label={`Kommentar von ${comment.author?.name || 'Anonym'}`} className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-2.5">
              <Avatar className="mt-0.5 h-8 w-8">
                <AvatarImage
                  src={comment.author?.image || DEFAULT_AVATAR_URL}
                  alt=""
                />
                <AvatarFallback className="bg-accent text-xs text-accent-foreground">{comment.author?.name?.[0] || 'A'}</AvatarFallback>
              </Avatar>
          <div className="min-w-0">
            <div className="rounded-2xl rounded-tl-md border border-border/60 bg-card px-3.5 py-3">
            <header className="mb-1.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="break-words text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
                {comment.author?.name || 'Anonym'}
              </span>
              <time dateTime={comment.createdAt} className="text-xs text-muted-foreground" title={new Date(comment.createdAt).toLocaleDateString('de-DE', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}>
                {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true, locale: de })}
              </time>
            </header>
            {acceptedCommentId === comment.id && <p className="mb-2 text-xs font-semibold text-primary">
              <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" /> Ausgewählte Lösung
            </p>}
            <p className="whitespace-pre-wrap text-sm leading-7 text-foreground [overflow-wrap:anywhere]">
              {comment.content}
            </p>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0 [&_button]:min-h-11">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async event => {
                        const focus = actionFocus.begin(event.currentTarget)
                        try { await onLikeComment?.(comment.id, postId) }
                        finally { actionFocus.complete(focus) }
                      }}
                      aria-label={comment.isLiked ? 'Kommentar-Like entfernen' : 'Kommentar liken'}
                      aria-pressed={comment.isLiked}
                      className={`h-11 rounded-[10px] px-2.5 hover:bg-coral/10 hover:text-coral ${comment.isLiked ? 'text-coral bg-coral/10 hover:bg-coral/15' : 'text-muted-foreground'
                        }`}
                      disabled={isLoading}
                    >
                      <ThumbsUp className={cn("h-3.5 w-3.5", comment.isLiked && "fill-current")} aria-hidden="true" />
                      <span className="text-xs font-medium">{comment.votes}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{comment.isLiked ? 'Like entfernen' : 'Kommentar liken'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {canSelectSolution && currentUserId !== comment.authorId && comment.solutionEligible !== false && onSelectSolution &&
                <Button type="button" size="sm" variant="ghost" className="h-11 px-2.5 text-muted-foreground" disabled={isLoading}
                  aria-pressed={acceptedCommentId === comment.id}
                  aria-label={acceptedCommentId === comment.id ? 'Lösungsauswahl für diese Antwort entfernen' : 'Diese Antwort als Lösung auswählen'}
                  onClick={() => void onSelectSolution(postId, acceptedCommentId === comment.id ? null : comment.id)}>
                  <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {acceptedCommentId === comment.id ? 'Auswahl entfernen' : 'Als Lösung'}
                </Button>}
              {canReport && currentUserId && currentUserId !== comment.authorId &&
                <ReportControl targetType="COMMENT" targetId={comment.id} />}
            </div>
          </div>
        </article>
      ))}
      </div>
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
