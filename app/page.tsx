"use client"

import { Button } from "@/components/ui/button"
import { UserNav } from "@/components/user-nav"
import Link from 'next/link'
import { Users, GraduationCap, Calendar, MessageCircle, ArrowRight, LogIn, ChevronDown } from 'lucide-react'
import { ThemeToggle } from "@/components/theme-toggle"

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <header className="bg-white dark:bg-gray-800 shadow-md z-10 sticky top-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-blue-600 dark:text-blue-400">ForgeCommunity</h2>
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
      <main>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <section className="text-center mb-24">
            <h1 className="text-6xl font-extrabold text-gray-900 dark:text-white mb-6 leading-tight">
              Entdecke, Lerne, <span className="text-blue-600 dark:text-blue-400">Verbinde</span>
            </h1>
            <p className="text-xl text-gray-600 dark:text-gray-300 mb-10 max-w-3xl mx-auto leading-relaxed">
              ForgeCommunity ist deine Plattform für Wachstum, Austausch und Zusammenarbeit. 
              Trete einer Community bei, die deine Leidenschaft für Lernen und Entwicklung teilt.
            </p>
            <Link href="/community">
              <Button className="bg-blue-600 hover:bg-blue-700 text-white text-lg px-8 py-4 rounded-full shadow-lg hover:shadow-xl transition-all duration-300">
                Zur Community
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <div className="mt-12">
              <ChevronDown className="mx-auto h-8 w-8 text-gray-400 animate-bounce" />
            </div>
          </section>
          
          <section className="mb-24">
            <h2 className="text-4xl font-bold text-center text-gray-900 dark:text-white mb-16">Unsere Features</h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-10">
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

          <section className="mb-24 text-center">
            <h2 className="text-4xl font-bold text-center text-gray-900 dark:text-white mb-12">Ein Blick in unsere Plattform</h2>
            <div className="flex justify-center">
              <img 
                src="/images/screenshot.png" 
                alt="ForgeCommunity Screenshot" 
                className="rounded-xl shadow-2xl max-w-full h-auto"
                style={{ maxWidth: '90%' }}
              />
            </div>
          </section>

          <section className="bg-gradient-to-r from-blue-600 to-blue-800 dark:from-blue-800 dark:to-blue-900 text-white rounded-2xl shadow-2xl p-16 text-center mb-24">
            <h2 className="text-4xl font-bold mb-8">Bereit loszulegen?</h2>
            <p className="text-xl mb-10 max-w-2xl mx-auto leading-relaxed">
              Werde Teil unserer wachsenden Community und starte deine Lernreise noch heute. 
              Registriere dich kostenlos und erhalte sofortigen Zugang zu allen Features.
            </p>
            <Link href="/register">
              <Button className="bg-white text-blue-600 hover:bg-gray-100 text-lg px-10 py-4 rounded-full shadow-md hover:shadow-lg transition-all duration-300">
                Jetzt kostenlos registrieren
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </section>
        </div>
      </main>
      <footer className="bg-gray-200 dark:bg-gray-800 py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-gray-600 dark:text-gray-300">
          <p className="text-sm">&copy; 2024 ForgeCommunity. Alle Rechte vorbehalten.</p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, description }) {
  return (
    <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 border border-gray-200 dark:border-gray-700 transform hover:-translate-y-2">
      <Icon className="w-16 h-16 text-blue-600 dark:text-blue-400 mb-6" />
      <h3 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">{title}</h3>
      <p className="text-gray-600 dark:text-gray-300 leading-relaxed">{description}</p>
    </div>
  );
}