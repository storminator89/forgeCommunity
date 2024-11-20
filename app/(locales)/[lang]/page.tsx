"use client"

import { Button } from "@/components/ui/button"
import { UserNav } from "@/components/user-nav"
import Link from 'next/link'
import { Users, GraduationCap, Calendar, MessageCircle, ArrowRight, LogIn, ChevronDown } from 'lucide-react'
import { ThemeToggle } from "@/components/theme-toggle"
import { useInView } from "@/hooks/useInView"
import { getDictionary } from "@/i18n/getDictionary"
import { useEffect, useState } from "react"
import type { Locale } from "@/i18n/settings"
import { LoadingSpinner } from "@/components/loading-spinner"

export default function Home({ params: { lang } }: { params: { lang: Locale } }) {
  const [dict, setDict] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const loadDictionary = async () => {
      try {
        setIsLoading(true)
        const dictionary = await getDictionary(lang)
        setDict(dictionary)
      } catch (error) {
        console.error('Error loading dictionary:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadDictionary()
  }, [lang])

  const [heroRef, heroInView] = useInView()
  const [featuresRef, featuresInView] = useInView()
  const [screenshotRef, screenshotInView] = useInView()
  const [ctaRef, ctaInView] = useInView()

  if (isLoading) return <LoadingSpinner />
  if (!dict) return null

  return (
    <div className="h-screen overflow-y-scroll snap-y snap-mandatory">
      <header className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-md shadow-md z-50 fixed top-0 w-full">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-8">
            <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-blue-400 bg-clip-text text-transparent">ForgeCommunity</h2>
            <nav className="hidden md:flex space-x-6">
              <Link href={`/${lang}/community`} className="text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{dict.navigation.community}</Link>
              <Link href={`/${lang}/events`} className="text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{dict.navigation.events}</Link>
              <Link href={`/${lang}/resources`} className="text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{dict.navigation.resources}</Link>
            </nav>
          </div>
          <div className="flex items-center space-x-4">
            <ThemeToggle />
            <Link href={`/${lang}/login`}>
              <Button variant="outline" size="sm" className="hidden sm:flex items-center hover:bg-blue-50 dark:hover:bg-gray-700">
                <LogIn className="mr-2 h-4 w-4" />
                {dict.navigation.login}
              </Button>
            </Link>
            <UserNav />
          </div>
        </div>
      </header>

      <main className="pt-16">
        <section 
          ref={heroRef}
          className="min-h-screen snap-start flex items-center justify-center bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10 animate-gradient"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <div className={`transform transition-all duration-1000 ${heroInView ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'}`}>
              <h1 className="text-7xl md:text-8xl font-extrabold text-gray-900 dark:text-white mb-8 leading-tight">
                {dict.home.hero.title}
              </h1>
              <p className="text-2xl md:text-3xl text-gray-600 dark:text-gray-300 mb-12 max-w-4xl mx-auto leading-relaxed">
                {dict.home.hero.subtitle}
              </p>
              <Link href={`/${lang}/community`}>
                <Button className="bg-blue-600 hover:bg-blue-700 text-white text-xl px-12 py-6 rounded-full shadow-lg hover:shadow-xl transition-all duration-300">
                  {dict.home.hero.cta}
                  <ArrowRight className="ml-3 h-6 w-6" />
                </Button>
              </Link>
              <div className="mt-16">
                <ChevronDown className="mx-auto h-12 w-12 text-gray-400 animate-bounce" />
              </div>
            </div>
          </div>
        </section>
        
        <section 
          ref={featuresRef}
          className="min-h-screen snap-start flex items-center justify-center bg-gradient-to-r from-green-500/10 via-teal-500/10 to-blue-500/10 animate-gradient"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className={`transform transition-all duration-1000 ${featuresInView ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'}`}>
              <h2 className="text-5xl md:text-6xl font-bold text-center text-gray-900 dark:text-white mb-20">
                {dict.home.features.title}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-16 max-w-6xl mx-auto">
                <FeatureCard 
                  icon={Users} 
                  title={dict.home.features.community.title}
                  description={dict.home.features.community.description}
                />
                <FeatureCard 
                  icon={GraduationCap} 
                  title={dict.home.features.learning.title}
                  description={dict.home.features.learning.description}
                />
                <FeatureCard 
                  icon={Calendar} 
                  title={dict.home.features.events.title}
                  description={dict.home.features.events.description}
                />
                <FeatureCard 
                  icon={MessageCircle} 
                  title={dict.home.features.forum.title}
                  description={dict.home.features.forum.description}
                />
              </div>
            </div>
          </div>
        </section>

        <section 
          ref={screenshotRef}
          className="min-h-screen snap-start flex items-center justify-center bg-gradient-to-r from-purple-500/10 via-indigo-500/10 to-blue-500/10 animate-gradient"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className={`transform transition-all duration-1000 ${screenshotInView ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'}`}>
              <h2 className="text-5xl md:text-6xl font-bold text-center text-gray-900 dark:text-white mb-16">
                {dict.home.platform.title}
              </h2>
              <div className="flex justify-center relative group">
                <img 
                  src="/images/screenshot.png" 
                  alt="ForgeCommunity Screenshot" 
                  className="rounded-xl shadow-2xl max-w-full h-auto transform transition-transform duration-500 group-hover:scale-[1.02]"
                  style={{ maxWidth: '90%' }}
                />
                <div className="absolute inset-0 rounded-xl bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              </div>
            </div>
          </div>
        </section>

        <section 
          ref={ctaRef}
          className="min-h-screen snap-start flex items-center justify-center bg-gradient-to-r from-blue-600 to-blue-800 dark:from-blue-800 dark:to-blue-900"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className={`transform transition-all duration-1000 ${ctaInView ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'}`}>
              <div className="text-center text-white">
                <h2 className="text-5xl md:text-6xl font-bold mb-10">{dict.home.cta.title}</h2>
                <p className="text-2xl md:text-3xl mb-12 max-w-3xl mx-auto leading-relaxed">
                  {dict.home.cta.subtitle}
                </p>
                <Link href={`/${lang}/register`}>
                  <Button className="bg-white text-blue-600 hover:bg-gray-100 text-xl px-14 py-6 rounded-full shadow-md hover:shadow-lg transition-all duration-300 transform hover:-translate-y-1">
                    {dict.home.cta.button}
                    <ArrowRight className="ml-3 h-6 w-6" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, description }) {
  return (
    <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm p-12 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border border-gray-200/50 dark:border-gray-700/50 group hover:bg-white dark:hover:bg-gray-800">
      <div className="flex items-start space-x-6">
        <div className="transform transition-transform duration-300 group-hover:scale-110 shrink-0">
          <div className="w-20 h-20 rounded-xl bg-blue-600/10 dark:bg-blue-400/10 flex items-center justify-center">
            <Icon className="w-12 h-12 text-blue-600 dark:text-blue-400" />
          </div>
        </div>
        <div className="flex-1">
          <h3 className="text-3xl font-semibold mb-6 text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
            {title}
          </h3>
          <p className="text-xl text-gray-600 dark:text-gray-300 leading-relaxed">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}
