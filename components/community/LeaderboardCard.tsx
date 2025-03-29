import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { Trophy } from 'lucide-react'

interface LeaderboardUser {
  id: string
  name: string
  image: string | null
  points: number
}

interface LeaderboardCardProps {
  users: LeaderboardUser[]
  isLoading: boolean
}

export function LeaderboardCard({ users, isLoading }: LeaderboardCardProps) {
  return (
    <Card className="hover:shadow-xl transition-shadow duration-300 bg-background dark:bg-gray-800 rounded-lg border border-border dark:border-gray-700">
      <CardHeader className="p-4 border-b border-border dark:border-gray-600">
        <CardTitle className="flex items-center text-lg font-semibold text-foreground dark:text-white">
          <Trophy className="h-6 w-6 text-yellow-500 mr-2" />
          Leaderboard
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <AnimatePresence>
          {isLoading ? (
            Array.from({ length: 5 }).map((_, index) => (
              <motion.div
                key={`skeleton-${index}`}
                className="flex items-center justify-between py-2 px-2"
              >
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-4 w-24" />
              </motion.div>
            ))
          ) : (
            users.map((user, index) => (
              <motion.div
                key={user.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ delay: index * 0.05 }}
                className="flex items-center justify-between py-2 px-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors duration-200"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-8 text-center">
                    {index === 0 && <Trophy className="h-5 w-5 text-yellow-500" />}
                    {index === 1 && <Trophy className="h-5 w-5 text-gray-400" />}
                    {index === 2 && <Trophy className="h-5 w-5 text-amber-700" />}
                    {index > 2 && <span className="font-bold">{index + 1}.</span>}
                  </div>
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user.image || ''} alt={user.name} />
                    <AvatarFallback>{user.name[0]}</AvatarFallback>
                  </Avatar>
                  <span className="font-medium text-foreground dark:text-white truncate max-w-[160px]">
                    {user.name}
                  </span>
                </div>
                <div className="flex items-center space-x-1">
                  <span className="font-semibold text-primary dark:text-primary-light">
                    {user.points}
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">Punkte</span>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  )
}