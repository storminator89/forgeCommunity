import { useState } from 'react'
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Heart, MessageSquare, Edit, Trash2, MoreHorizontal } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { motion, AnimatePresence } from 'framer-motion'
import { CommentSection } from './CommentSection'

import { cn } from "@/lib/utils"
import { formatDistanceToNow } from 'date-fns'
import { de } from 'date-fns/locale'

const DEFAULT_AVATAR_URL = 'https://via.placeholder.com/150'

interface Post {
  id: string
  title: string
  content: string
  authorId: string
  author: {
    id: string
    name: string
    image: string | null
  } | null
  createdAt: string
  votes: number
  isLiked: boolean
  comments: Comment[]
}

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

interface PostCardProps {
  post: Post
  currentUserId?: string
  onLike: (postId: string) => Promise<void>
  onDelete?: (postId: string) => Promise<void>
  onEdit?: (post: Post) => void
  onAddComment?: (postId: string, content: string) => Promise<void>
  onLikeComment?: (commentId: string, postId: string) => Promise<void>
  isLoading?: boolean
}

export function PostCard({
  post,
  currentUserId,
  onLike,
  onDelete,
  onEdit,
  onAddComment,
  onLikeComment,
  isLoading = false
}: PostCardProps) {
  const [expandedComments, setExpandedComments] = useState(false)
  const isAuthor = currentUserId === post.authorId;

  const toggleComments = () => setExpandedComments(!expandedComments)

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      layout
      className="group"
    >
      <Card className="overflow-hidden border-none shadow-md hover:shadow-xl transition-all duration-300 bg-card border border-border">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center space-x-3">
              <Avatar className="h-10 w-10 ring-2 ring-background">
                <AvatarImage
                  src={post.author?.image || DEFAULT_AVATAR_URL}
                  alt={post.author?.name || 'Anonym'}
                />
                <AvatarFallback className="bg-primary/10 text-primary">{post.author?.name?.[0] || 'A'}</AvatarFallback>
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
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
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
                dangerouslySetInnerHTML={{ __html: post.content }}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <CardFooter className="px-6 py-4 bg-muted/50 flex items-center justify-between border-t border-border">
          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onLike(post.id)}
              disabled={isLoading}
              className={cn(
                "rounded-full px-4 h-9 transition-all hover:bg-destructive/10 active:scale-95",
                post.isLiked ? "text-destructive bg-destructive/10" : "text-muted-foreground hover:text-destructive"
              )}
            >
              <Heart className={cn("mr-2 h-4 w-4", post.isLiked && "fill-current")} />
              <span className="font-medium">{post.votes}</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={toggleComments}
              className={cn(
                "rounded-full px-4 h-9 transition-all hover:bg-primary/10 active:scale-95",
                expandedComments ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-primary"
              )}
            >
              <MessageSquare className="mr-2 h-4 w-4" />
              <span className="font-medium">{(post.comments || []).length}</span>
              <span className="ml-1 hidden sm:inline">Kommentare</span>
            </Button>
          </div>
        </CardFooter>

        {/* Comments Section */}
        <AnimatePresence>
          {expandedComments && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-border bg-muted/50"
            >
              <div className="p-4 sm:p-6">
                <CommentSection
                  postId={post.id}
                  comments={post.comments}
                  currentUserId={currentUserId}
                  isLoading={isLoading}
                  onAddComment={onAddComment}
                  onLikeComment={onLikeComment}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  )
}