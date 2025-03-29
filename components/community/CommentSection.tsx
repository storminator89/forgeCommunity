import { useState } from 'react'
import { motion } from 'framer-motion'
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ThumbsUp, Send, Loader2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

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
      <div className="bg-background dark:bg-gray-700 p-4 rounded-lg shadow-inner">
        <div className="relative flex items-center">
          <Input
            value={newCommentContent}
            onChange={(e) => setNewCommentContent(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Schreibe einen Kommentar..."
            className="pr-10"
            disabled={isLoading}
          />
          <Button
            onClick={handleSubmit}
            disabled={isLoading || !newCommentContent.trim()}
            className="absolute right-2 p-1 hover:bg-gray-100 dark:hover:bg-gray-600 text-foreground rounded-full flex items-center justify-center transition-colors duration-200"
            size="icon"
            variant="ghost"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {comments.map((comment) => (
        <Card key={comment.id} className="bg-background dark:bg-gray-700 p-3 rounded-lg shadow-sm">
          <CardContent>
            <div className="flex items-center space-x-3 mb-2">
              <Avatar className="h-6 w-6">
                <AvatarImage
                  src={comment.author?.image || DEFAULT_AVATAR_URL}
                  alt={comment.author?.name || 'Anonym'}
                />
                <AvatarFallback>{comment.author?.name?.[0] || 'A'}</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium text-foreground dark:text-white">
                {comment.author?.name || 'Anonym'}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {new Date(comment.createdAt).toLocaleDateString('de-DE', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
            </div>
            <p className="text-sm text-foreground dark:text-gray-200 leading-relaxed">
              {comment.content}
            </p>
            <div className="flex items-center mt-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onLikeComment?.(comment.id, postId)}
                      className={`hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center space-x-1 rounded-md p-2 transition-colors duration-200 ${
                        comment.isLiked ? 'text-primary' : 'text-gray-500'
                      }`}
                      disabled={isLoading}
                    >
                      <ThumbsUp className="h-4 w-4" />
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
    </motion.div>
  )
}