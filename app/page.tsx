"use client"

import { Button } from "@/components/ui/button"
import { UserNav } from "@/components/user-nav"
import Link from 'next/link'
import { Users, GraduationCap, Calendar, MessageCircle, ArrowRight, LogIn } from 'lucide-react'
import { ThemeToggle } from "@/components/theme-toggle"

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 shadow-sm z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">ForgeCommunity</h2>
          <div className="flex items-center space-x-4">
            <ThemeToggle />
            <Link href="/login">
              <Button variant="outline" size="sm" className="hidden sm:flex items-center">
                <LogIn className="mr-2 h-4 w-4" />
                Login
              </Button>
            </Link>
            <UserNav />
          </div>
        </div>
      </header>
      <main className="bg-gray-100 dark:bg-gray-900">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <section className="text-center mb-20">
            <h1 className="text-5xl font-bold text-gray-900 dark:text-white mb-6">Entdecke, Lerne, Verbinde</h1>
            <p className="text-xl text-gray-600 dark:text-gray-300 mb-8 max-w-3xl mx-auto">ForgeCommunity ist deine Plattform für Wachstum, Austausch und Zusammenarbeit. Trete einer Community bei, die deine Leidenschaft für Lernen und Entwicklung teilt.</p>
            <Link href="/community">
              <Button className="bg-blue-600 hover:bg-blue-700 text-white text-lg px-8 py-3">
                Zur Community
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </section>
          
          <section className="mb-20">
            <h2 className="text-3xl font-bold text-center text-gray-900 dark:text-white mb-12">Unsere Features</h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
              <FeatureCard 
                icon={Users} 
                title="Lebendige Community" 
                description="Tausche dich mit Gleichgesinnten aus und knüpfe wertvolle Kontakte."
              />
              <FeatureCard 
                icon={GraduationCap} 
                title="Lernressourcen" 
                description="Zugang zu Kursen und Workshops für deine persönliche und berufliche Entwicklung."
              />
              <FeatureCard 
                icon={Calendar} 
                title="Events" 
                description="Nimm an spannenden Online- und Offline-Veranstaltungen teil."
              />
              <FeatureCard 
                icon={MessageCircle} 
                title="Diskussionsforen" 
                description="Stelle Fragen, teile dein Wissen und beteilige dich an interessanten Diskussionen."
              />
            </div>
          </section>

          <section className="bg-blue-600 dark:bg-blue-800 text-white rounded-lg shadow-xl p-12 text-center">
            <h2 className="text-3xl font-bold mb-6">Bereit loszulegen?</h2>
            <p className="text-xl mb-8 max-w-2xl mx-auto">Werde Teil unserer wachsenden Community und starte deine Lernreise noch heute. Registriere dich kostenlos und erhalte sofortigen Zugang zu allen Features.</p>
            <Link href="/register">
              <Button className="bg-white text-blue-600 hover:bg-gray-100 text-lg px-8 py-3 shadow-md hover:shadow-lg transition-all duration-200">
                Jetzt kostenlos registrieren
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </section>
        </div>
      </main>
      <footer className="bg-gray-200 dark:bg-gray-800 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-gray-600 dark:text-gray-300">
          <p>&copy; 2024 ForgeCommunity. Alle Rechte vorbehalten.</p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, description }) {
  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md hover:shadow-lg transition-all duration-200 border border-gray-200 dark:border-gray-700 transform hover:-translate-y-1">
      <Icon className="w-12 h-12 text-blue-600 dark:text-blue-400 mb-4" />
      <h3 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">{title}</h3>
      <p className="text-gray-600 dark:text-gray-300">{description}</p>
    </div>
  );
}