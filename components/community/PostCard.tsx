import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { ThumbsUp, MessageSquare, Edit, Trash, ChevronDown, ChevronUp } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { motion, AnimatePresence } from 'framer-motion'
import { CommentSection } from './CommentSection'

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
  onLikeComment?: (commentId: string) => Promise<void>
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

  const toggleComments = () => setExpandedComments(!expandedComments)

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Card className="overflow-hidden hover:shadow-2xl transition-shadow duration-300 bg-background dark:bg-gray-800 rounded-lg border border-border dark:border-gray-700">
        <CardHeader className="flex flex-col lg:flex-row justify-between items-start lg:items-center bg-gray-100 dark:bg-gray-700 p-4 rounded-t-lg transition-colors duration-300">
          <CardTitle className="text-xl font-semibold text-foreground dark:text-white">
            {post.title}
          </CardTitle>
          {currentUserId === post.authorId && (
            <div className="flex space-x-2 mt-2 lg:mt-0">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit?.(post)}
                      className="hover:bg-gray-200 dark:hover:bg-gray-600 p-2 rounded-full transition-colors duration-200"
                      disabled={isLoading}
                    >
                      <Edit className="h-4 w-4 text-primary" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Beitrag bearbeiten</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDelete?.(post.id)}
                      className="hover:bg-red-200 dark:hover:bg-red-600 p-2 rounded-full transition-colors duration-200"
                      disabled={isLoading}
                    >
                      <Trash className="h-4 w-4 text-red-500" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Beitrag löschen</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
        </CardHeader>

        <CardContent className="pt-4 px-4">
          <div
            className="prose dark:prose-invert max-w-none mb-4"
            dangerouslySetInnerHTML={{ __html: post.content }}
          />
        </CardContent>

        <CardFooter className="bg-gray-100 dark:bg-gray-700 border-t border-gray-200 dark:border-gray-600 p-4 rounded-b-lg transition-colors duration-300">
          <div className="w-full">
            <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-300 mb-3">
              <div className="flex items-center space-x-3">
                <Avatar className="h-8 w-8">
                  <AvatarImage
                    src={post.author?.image || DEFAULT_AVATAR_URL}
                    alt={post.author?.name || 'Anonym'}
                  />
                  <AvatarFallback>{post.author?.name?.[0] || 'A'}</AvatarFallback>
                </Avatar>
                <span className="font-medium text-foreground dark:text-white">
                  {post.author?.name || 'Anonym'}
                </span>
              </div>
              <span>
                {new Date(post.createdAt).toLocaleDateString('de-DE', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
            </div>

            <div className="flex items-center space-x-4">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onLike(post.id)}
                      className={`hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center space-x-1 rounded-md p-2 transition-colors duration-200 ${
                        post.isLiked ? 'text-primary' : 'text-gray-500'
                      }`}
                      disabled={isLoading}
                    >
                      <ThumbsUp className="h-4 w-4" />
                      <span>{post.votes}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{post.isLiked ? 'Like entfernen' : 'Beitrag liken'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={toggleComments}
                      className="hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center space-x-1 rounded-md p-2 transition-colors duration-200"
                    >
                      <MessageSquare className="h-4 w-4" />
                      <span>{post.comments.length}</span>
                      {expandedComments ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{expandedComments ? 'Kommentare ausblenden' : 'Kommentare anzeigen'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            <AnimatePresence>
              {expandedComments && (
                <CommentSection
                  postId={post.id}
                  comments={post.comments}
                  currentUserId={currentUserId}
                  isLoading={isLoading}
                  onAddComment={onAddComment}
                  onLikeComment={onLikeComment}
                />
              )}
            </AnimatePresence>
          </div>
        </CardFooter>
      </Card>
    </motion.div>
  )
}