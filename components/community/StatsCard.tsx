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
  return (
    <Card className="hover:shadow-xl transition-shadow duration-300 bg-background dark:bg-gray-800 rounded-lg border border-border dark:border-gray-700">
      <CardHeader className="p-4 border-b border-border dark:border-gray-600">
        <CardTitle className="flex items-center text-lg font-semibold text-foreground dark:text-white">
          <Award className="h-6 w-6 text-purple-500 mr-2" />
          Deine Statistiken
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <motion.div
          className="space-y-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex justify-between items-center p-3 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-200">
            <div className="flex items-center space-x-2">
              <PlusCircle className="h-5 w-5 text-blue-500" />
              <span className="text-sm font-medium text-foreground dark:text-white">Beiträge</span>
            </div>
            <span className="font-semibold text-primary bg-gray-200 dark:bg-gray-600 px-3 py-1 rounded-full">
              {stats.posts}
            </span>
          </div>

          <div className="flex justify-between items-center p-3 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-200">
            <div className="flex items-center space-x-2">
              <ThumbsUp className="h-5 w-5 text-green-500" />
              <span className="text-sm font-medium text-foreground dark:text-white">Likes erhalten</span>
            </div>
            <span className="font-semibold text-green-600 bg-gray-200 dark:bg-gray-600 px-3 py-1 rounded-full">
              {stats.receivedLikes}
            </span>
          </div>

          <div className="flex justify-between items-center p-3 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-200">
            <div className="flex items-center space-x-2">
              <MessageSquare className="h-5 w-5 text-orange-500" />
              <span className="text-sm font-medium text-foreground dark:text-white">Kommentare</span>
            </div>
            <span className="font-semibold text-orange-600 bg-gray-200 dark:bg-gray-600 px-3 py-1 rounded-full">
              {stats.comments}
            </span>
          </div>

          <div className="flex justify-between items-center p-3 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-200">
            <div className="flex items-center space-x-2">
              <Award className="h-5 w-5 text-purple-500" />
              <span className="text-sm font-medium text-foreground dark:text-white">Gesamtpunkte</span>
            </div>
            <span className="font-semibold text-purple-600 bg-gray-200 dark:bg-gray-600 px-3 py-1 rounded-full">
              {stats.totalPoints}
            </span>
          </div>
        </motion.div>
      </CardContent>
    </Card>
  )
}