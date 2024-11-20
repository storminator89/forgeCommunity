"use client"

import { Button } from "@/components/ui/button"
import { UserNav } from "@/components/user-nav"
import Link from 'next/link'
import { Users, GraduationCap, Calendar, MessageCircle, ArrowRight, LogIn, ChevronDown } from 'lucide-react'
import { ThemeToggle } from "@/components/theme-toggle"
import { useInView } from "@/hooks/useInView"

export default function Home({ params }: { params: { lang: string } }) {
  const [heroRef, heroInView] = useInView();
  const [featuresRef, featuresInView] = useInView();
  const [screenshotRef, screenshotInView] = useInView();
  const [ctaRef, ctaInView] = useInView();

  return (
    <div className="h-screen overflow-y-scroll snap-y snap-mandatory">
      <header className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-md shadow-md z-50 fixed top-0 w-full">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-8">
            <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-500 to-teal-400 bg-clip-text text-transparent">
              Community
            </h2>
            <nav className="hidden md:flex space-x-4">
              <Link href={`/${params.lang}/community`} className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white px-3 py-2 rounded-md text-sm font-medium">
                Community
              </Link>
              <Link href={`/${params.lang}/courses`} className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white px-3 py-2 rounded-md text-sm font-medium">
                Kurse
              </Link>
              <Link href={`/${params.lang}/events`} className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white px-3 py-2 rounded-md text-sm font-medium">
                Events
              </Link>
              <Link href={`/${params.lang}/resources`} className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white px-3 py-2 rounded-md text-sm font-medium">
                Ressourcen
              </Link>
            </nav>
          </div>
          <div className="flex items-center space-x-4">
            <ThemeToggle />
            <UserNav />
          </div>
        </div>
      </header>

      <main>
        {/* Rest of your content */}
      </main>
    </div>
  )
}
