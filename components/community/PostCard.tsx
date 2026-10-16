import { useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Heart, MessageSquare, Edit, Trash2, MoreHorizontal, CheckCircle2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { motion, AnimatePresence } from 'framer-motion'
import { CommentSection } from './CommentSection'
import { ReportControl } from './ReportControl'

import { cn } from "@/lib/utils"
import { sanitizeRichHtml } from '@/lib/sanitize-html'
import { formatDistanceToNow } from 'date-fns'
import { de } from 'date-fns/locale'

import type { CommunityPost as Post } from '@/lib/community-feed'

const DEFAULT_AVATAR_URL = ''

interface PostCardProps {
  post: Post
  currentUserId?: string
  onLike: (postId: string) => Promise<void>
  onDelete?: (postId: string) => Promise<void>
  onEdit?: (post: Post) => void
  onSelectTopic?: (topic: string) => void
  onAddComment?: (postId: string, content: string) => Promise<void>
  onLikeComment?: (commentId: string, postId: string) => Promise<void>
  onSelectSolution?: (postId: string, commentId: string | null) => Promise<void>
  solutionSaving?: boolean
  solutionError?: string
  isLoading?: boolean
  onLoadComments?: (postId: string) => Promise<void>
  commentsLoading?: boolean
  commentsError?: boolean
}

export function PostCard({
  post,
  currentUserId,
  onLike,
  onDelete,
  onEdit,
  onSelectTopic,
  onAddComment,
  onLikeComment,
  onSelectSolution,
  solutionSaving = false,
  solutionError,
  isLoading = false,
  onLoadComments,
  commentsLoading = false,
  commentsError = false,
}: PostCardProps) {
  const [expandedComments, setExpandedComments] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const isAuthor = currentUserId === post.authorId;
  const commentCount = post.commentCount ?? (post.comments || []).length;
  const commentLabel = commentCount === 1 ? 'Kommentar' : 'Kommentare';

  const toggleComments = () => {
    if (!expandedComments && post.commentsDeferred) void onLoadComments?.(post.id)
    setExpandedComments(!expandedComments)
  }

  useEffect(() => {
    const followHash = () => {
      const hash = window.location.hash.slice(1);
      if (hash === `post-${post.id}`) cardRef.current?.scrollIntoView({ block: 'center' });
      if (post.comments?.some((comment) => hash === `comment-${comment.id}`)) setExpandedComments(true);
    };
    const timer = window.setTimeout(followHash, 0);
    window.addEventListener('hashchange', followHash);
    return () => { window.clearTimeout(timer); window.removeEventListener('hashchange', followHash); };
  }, [post.id, post.comments]);

  return (
    <motion.div
      id={`post-${post.id}`}
      ref={cardRef}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      layout
      className="group"
    >
      <Card className="overflow-hidden shadow-xs hover:shadow-md transition-all duration-300 bg-card border border-border">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center space-x-3">
              <Avatar className="h-10 w-10 ring-2 ring-background">
                <AvatarImage
                  src={post.author?.image || DEFAULT_AVATAR_URL}
                  alt={post.author?.name || 'Anonym'}
                />
                <AvatarFallback className="bg-coral-highlight text-coral-highlight-foreground">{post.author?.name?.[0] || 'A'}</AvatarFallback>
              </Avatar>
              <div>
                <h3 className="font-semibold text-lg text-foreground leading-tight">
                  {post.author?.name || 'Anonym'}
                </h3>
                <span className="text-sm text-muted-foreground block">
                  {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true, locale: de })}
                </span>
              </div>
            </div>

            {isAuthor && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button aria-label="Beitragsaktionen" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onEdit?.(post)} className="cursor-pointer">
                    <Edit className="mr-2 h-4 w-4" /> Bearbeiten
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onDelete?.(post.id)} className="cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10">
                    <Trash2 className="mr-2 h-4 w-4" /> Löschen
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Content */}
          <div className="space-y-3">
            <h2 className="text-xl font-bold text-foreground">{post.title}</h2>
            <div className="relative">
              <div
                className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground"
                dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(post.content) }}
              />
            </div>
            {!!post.tags?.length && <ul className="flex flex-wrap gap-2" aria-label="Beitragsthemen">
              {post.tags.map(tag => <li key={tag.id}><a href={`/community?tag=${encodeURIComponent(tag.name)}`}
                onClick={event => { if (onSelectTopic && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); onSelectTopic(tag.name) } }}
                className="inline-flex min-h-8 items-center rounded-full border border-border bg-muted/50 px-3 text-xs font-medium text-foreground hover:border-primary hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">{tag.name}</a></li>)}
            </ul>}
          </div>
          {post.published !== false && post.acceptedSolution && <section aria-label="Ausgewählte Lösung" className="mt-5 rounded-lg border border-coral/30 bg-coral/5 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-4 w-4 text-coral" aria-hidden="true" /> Vom Beitragsautor als Lösung ausgewählt</h3>
            {(!expandedComments || !post.comments.some(comment => comment.id === post.acceptedSolution?.comment.id)) &&
              <p className="mt-2 whitespace-pre-wrap text-sm">{post.acceptedSolution.comment.content}</p>}
            <p className="mt-2 text-xs text-muted-foreground">Antwort von {post.acceptedSolution.comment.author?.name || 'Anonym'}. Diese Auswahl vergibt keine Punkte.</p>
          </section>}
          {isAuthor && onSelectSolution && post.solutionRevision && <Button type="button" variant="ghost" size="sm" className="mt-3" disabled={isLoading}
            onClick={() => void onSelectSolution(post.id, null)}>Lösungsauswahl entfernen</Button>}
          {solutionSaving && <p role="status" className="mt-3 text-sm text-muted-foreground">Lösungsauswahl wird gespeichert…</p>}
          {solutionError && <p role="alert" className="mt-3 text-sm text-destructive">{solutionError}</p>}
        </div>

        {/* Footer */}
        <CardFooter className="px-6 py-4 bg-muted/50 flex flex-wrap items-center justify-between gap-2 border-t border-border">
          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onLike(post.id)}
              disabled={isLoading}
              className={cn(
                "rounded-full px-4 h-9 transition-all hover:bg-coral/10 active:scale-95",
                post.isLiked ? "text-coral bg-coral/10 hover:text-coral" : "text-muted-foreground hover:text-coral"
              )}
            >
              <Heart className={cn("mr-2 h-4 w-4", post.isLiked && "fill-current")} />
              <span className="font-medium">{post.votes}</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={toggleComments}
              aria-expanded={expandedComments}
              aria-controls={`comments-${post.id}`}
              aria-label={`${commentCount} ${commentLabel} ${expandedComments ? 'ausblenden' : 'anzeigen'}`}
              className={cn(
                "rounded-full px-4 h-9 transition-all hover:bg-primary/10 active:scale-95",
                expandedComments ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-primary"
              )}
            >
              <MessageSquare className="mr-2 h-4 w-4" />
              <span className="font-medium">{commentCount}</span>
              <span className="ml-1 hidden sm:inline">{commentLabel}</span>
            </Button>
          </div>
          {currentUserId && !isAuthor && post.published !== false &&
            <ReportControl targetType="POST" targetId={post.id} />}
        </CardFooter>

        {/* Comments Section */}
        <AnimatePresence>
          {expandedComments && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              id={`comments-${post.id}`}
              className="border-t border-border bg-muted/50"
            >
              <div className="p-4 sm:p-6">
                <CommentSection
                  postId={post.id}
                  comments={post.comments}
                  currentUserId={currentUserId}
                  canReport={post.published !== false}
                  canSelectSolution={isAuthor && post.published === true}
                  acceptedCommentId={post.published !== false ? post.acceptedSolution?.comment.id : undefined}
                  onSelectSolution={onSelectSolution}
                  isLoading={isLoading}
                  onAddComment={onAddComment}
                  onLikeComment={onLikeComment}
                  hasMore={!!post.commentsDeferred || !!post.commentsNextCursor}
                  commentCount={post.commentCount}
                  onLoadMore={() => onLoadComments?.(post.id)}
                  isLoadingMore={commentsLoading}
                  loadMoreError={commentsError}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  )
}
