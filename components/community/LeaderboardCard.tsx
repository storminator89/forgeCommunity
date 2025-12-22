import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { Trophy, Medal, Crown } from 'lucide-react'
import { cn } from "@/lib/utils"

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
    <Card className="border-none shadow-xl bg-gradient-to-br from-white to-gray-50 dark:from-card dark:to-card dark:bg-card overflow-hidden">
      <CardHeader className="bg-yellow-500/10 border-b border-yellow-500/10 dark:border-border">
        <CardTitle className="flex items-center text-lg font-bold text-foreground">
          <Trophy className="h-5 w-5 text-yellow-600 dark:text-yellow-500 mr-2" />
          Top Mitglieder
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          <AnimatePresence mode="wait">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <div key={`skeleton-${index}`} className="flex items-center p-4 space-x-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-1/3" />
                  </div>
                </div>
              ))
            ) : (
              users.map((user, index) => {
                let rankIcon;
                let rankColor;

                if (index === 0) {
                  rankIcon = <Crown className="h-5 w-5 text-yellow-500" fill="currentColor" />;
                  rankColor = "bg-yellow-50 dark:bg-accent/40 border-yellow-200 dark:border-accent";
                } else if (index === 1) {
                  rankIcon = <Medal className="h-5 w-5 text-gray-400" fill="currentColor" />;
                  rankColor = "bg-gray-50 dark:bg-transparent border-gray-200 dark:border-border";
                } else if (index === 2) {
                  rankIcon = <Medal className="h-5 w-5 text-amber-700" fill="currentColor" />;
                  rankColor = "bg-orange-50 dark:bg-transparent border-orange-200 dark:border-border";
                }

                return (
                  <motion.div
                    key={user.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className={cn(
                      "flex items-center justify-between p-4 hover:bg-accent/50 transition-colors duration-200 rounded-lg my-1 border",
                      rankColor || "border-transparent hover:border-border bg-card"
                    )}
                  >
                    <div className="flex items-center space-x-4">
                      <div className="w-8 flex justify-center font-bold text-muted-foreground">
                        {rankIcon || <span className="text-sm">#{index + 1}</span>}
                      </div>

                      <Avatar className={cn(
                        "h-10 w-10 border-2",
                        index === 0 ? "border-yellow-500" :
                          index === 1 ? "border-gray-400" :
                            index === 2 ? "border-amber-700" : "border-border"
                      )}>
                        <AvatarImage src={user.image || ''} alt={user.name} />
                        <AvatarFallback>{user.name[0]}</AvatarFallback>
                      </Avatar>

                      <div className="flex flex-col">
                        <span className="font-semibold text-sm text-foreground">
                          {user.name}
                        </span>
                        {index === 0 && <span className="text-xs text-yellow-600 dark:text-yellow-500 font-medium">Champion</span>}
                      </div>
                    </div>

                    <div className="flex flex-col items-end">
                      <span className="font-bold text-primary text-sm">
                        {user.points}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Punkte
                      </span>
                    </div>
                  </motion.div>
                );
              })
            )}
          </AnimatePresence>
        </div>
      </CardContent>
    </Card>
  )
}