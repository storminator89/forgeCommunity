import { useState } from 'react'
import { motion } from 'framer-motion'
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ThumbsUp, Send, Loader2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const DEFAULT_AVATAR_URL = 'https://via.placeholder.com/150'

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
}

interface CommentSectionProps {
  postId: string
  comments: Comment[]
  currentUserId?: string
  isLoading?: boolean
  onAddComment?: (postId: string, content: string) => Promise<void>
  onLikeComment?: (commentId: string, postId: string) => Promise<void>
}

export function CommentSection({
  postId,
  comments,
  currentUserId,
  isLoading = false,
  onAddComment,
  onLikeComment
}: CommentSectionProps) {
  const [newCommentContent, setNewCommentContent] = useState('')

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
      <div className="bg-card p-4 rounded-lg shadow-sm border border-border">
        <div className="relative flex items-center">
          <Input
            value={newCommentContent}
            onChange={(e) => setNewCommentContent(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Schreibe einen Kommentar..."
            className="pr-10 bg-muted/50 border-input"
            disabled={isLoading}
          />
          <Button
            onClick={handleSubmit}
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
        <Card key={comment.id} className="bg-card p-3 rounded-lg shadow-sm border border-border">
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
            <p className="text-sm text-foreground/90 leading-relaxed pl-9">
              {comment.content}
            </p>
            <div className="flex items-center mt-2 pl-9">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onLikeComment?.(comment.id, postId)}
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
            </div>
          </CardContent>
        </Card>
      ))}
    </motion.div>
  )
}