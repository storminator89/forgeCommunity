'use client'

import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { UserNav } from "@/components/user-nav"
import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'

export function CourseHeader() {
  const router = useRouter()

  return (
    <header className="bg-white dark:bg-gray-800 shadow-md z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
        <div className="flex items-center">
          <Button variant="ghost" onClick={() => router.push('/courses')} className="mr-4 flex items-center">
            <ArrowLeft className="h-4 w-4 mr-2" />
          </Button>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Kursinhalte</h2>
        </div>
        <div className="flex items-center space-x-4">
          <ThemeToggle />
          <UserNav />
        </div>
      </div>
    </header>
  )
}
