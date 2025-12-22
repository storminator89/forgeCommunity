import { motion } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PlusCircle, ThumbsUp, MessageSquare, Award } from 'lucide-react'

interface StatsCardProps {
  stats: {
    posts: number
    receivedLikes: number
    comments: number
    totalPoints: number
  }
}

export function StatsCard({ stats }: StatsCardProps) {
  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  }

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
  }

  return (
    <Card className="border-none shadow-xl bg-gradient-to-br from-white to-gray-50 dark:from-card dark:to-card dark:bg-card overflow-hidden">
      <CardHeader className="bg-primary/5 dark:bg-accent/10 border-b border-border">
        <CardTitle className="flex items-center text-lg font-bold text-foreground">
          <Award className="h-5 w-5 text-primary mr-2" />
          Deine Erfolge
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="grid grid-cols-2 gap-4"
        >
          <motion.div variants={item} className="flex flex-col items-center justify-center p-4 bg-card rounded-xl space-y-2 hover:bg-accent/50 transition-colors duration-200 border border-border">
            <div className="p-3 bg-blue-100 dark:bg-blue-900/20 rounded-full">
              <PlusCircle className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <span className="text-2xl font-bold text-foreground">{stats.posts}</span>
            <span className="text-xs font-medium text-muted-foreground">Beiträge</span>
          </motion.div>

          <motion.div variants={item} className="flex flex-col items-center justify-center p-4 bg-card rounded-xl space-y-2 hover:bg-accent/50 transition-colors duration-200 border border-border">
            <div className="p-3 bg-green-100 dark:bg-green-900/20 rounded-full">
              <ThumbsUp className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <span className="text-2xl font-bold text-foreground">{stats.receivedLikes}</span>
            <span className="text-xs font-medium text-muted-foreground">Likes</span>
          </motion.div>

          <motion.div variants={item} className="flex flex-col items-center justify-center p-4 bg-card rounded-xl space-y-2 hover:bg-accent/50 transition-colors duration-200 border border-border">
            <div className="p-3 bg-orange-100 dark:bg-orange-900/20 rounded-full">
              <MessageSquare className="h-6 w-6 text-orange-600 dark:text-orange-400" />
            </div>
            <span className="text-2xl font-bold text-foreground">{stats.comments}</span>
            <span className="text-xs font-medium text-muted-foreground">Kommentare</span>
          </motion.div>

          <motion.div variants={item} className="flex flex-col items-center justify-center p-4 bg-card rounded-xl space-y-2 hover:bg-accent/50 transition-colors duration-200 border border-border">
            <div className="p-3 bg-purple-100 dark:bg-purple-900/20 rounded-full">
              <Award className="h-6 w-6 text-purple-600 dark:text-purple-400" />
            </div>
            <span className="text-2xl font-bold text-foreground">{stats.totalPoints}</span>
            <span className="text-xs font-medium text-muted-foreground">Punkte</span>
          </motion.div>
        </motion.div>
      </CardContent>
    </Card>
  )
}