"use client"

import { Button } from "@/components/ui/button"
import { UserNav } from "@/components/user-nav"
import Link from 'next/link'
import { Users, GraduationCap, Calendar, MessageCircle, ArrowRight, LogIn, ChevronDown } from 'lucide-react'
import { ThemeToggle } from "@/components/theme-toggle"
import { useInView } from "@/hooks/useInView"

export default function Home() {
  const [heroRef, heroInView] = useInView();
  const [featuresRef, featuresInView] = useInView();
  const [screenshotRef, screenshotInView] = useInView();
  const [ctaRef, ctaInView] = useInView();

  return (
    <div className="h-screen overflow-y-scroll snap-y snap-mandatory">
      <header className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-md shadow-md z-50 fixed top-0 w-full">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-8">
            <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-blue-400 bg-clip-text text-transparent">ForgeCommunity</h2>
            <nav className="hidden md:flex space-x-6">
              <Link href="/community" className="text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Community</Link>
              <Link href="/events" className="text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Events</Link>
              <Link href="/resources" className="text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Ressourcen</Link>
            </nav>
          </div>
          <div className="flex items-center space-x-4">
            <ThemeToggle />
            <Link href="/login">
              <Button variant="outline" size="sm" className="hidden sm:flex items-center hover:bg-blue-50 dark:hover:bg-gray-700">
                <LogIn className="mr-2 h-4 w-4" />
                Login
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
                Entdecke, Lerne, <span className="bg-gradient-to-r from-blue-600 to-blue-400 bg-clip-text text-transparent">Verbinde</span>
              </h1>
              <p className="text-2xl md:text-3xl text-gray-600 dark:text-gray-300 mb-12 max-w-4xl mx-auto leading-relaxed">
                ForgeCommunity ist deine Plattform für Wachstum, Austausch und Zusammenarbeit. 
                Trete einer Community bei, die deine Leidenschaft für Lernen und Entwicklung teilt.
              </p>
              <Link href="/community">
                <Button className="bg-blue-600 hover:bg-blue-700 text-white text-xl px-12 py-6 rounded-full shadow-lg hover:shadow-xl transition-all duration-300">
                  Zur Community
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
                Unsere Features
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-16 max-w-6xl mx-auto">
                <FeatureCard 
                  icon={Users} 
                  title="Lebendige Community" 
                  description="Tausche dich mit Gleichgesinnten aus und knüpfe wertvolle Kontakte in einer aktiven und unterstützenden Gemeinschaft."
                />
                <FeatureCard 
                  icon={GraduationCap} 
                  title="Lernressourcen" 
                  description="Zugang zu hochwertigen Kursen und Workshops für deine persönliche und berufliche Entwicklung. Lerne von Experten und erweitere dein Wissen."
                />
                <FeatureCard 
                  icon={Calendar} 
                  title="Events" 
                  description="Nimm an spannenden Online- und Offline-Veranstaltungen teil. Vernetze dich bei Workshops, Webinaren und Community-Treffen."
                />
                <FeatureCard 
                  icon={MessageCircle} 
                  title="Diskussionsforen" 
                  description="Stelle Fragen, teile dein Wissen und beteilige dich an interessanten Diskussionen. Profitiere vom Austausch mit der Community."
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
                Ein Blick in unsere Plattform
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
                <h2 className="text-5xl md:text-6xl font-bold mb-10">Bereit loszulegen?</h2>
                <p className="text-2xl md:text-3xl mb-12 max-w-3xl mx-auto leading-relaxed">
                  Werde Teil unserer wachsenden Community und starte deine Lernreise noch heute. 
                  Registriere dich kostenlos und erhalte sofortigen Zugang zu allen Features.
                </p>
                <Link href="/register">
                  <Button className="bg-white text-blue-600 hover:bg-gray-100 text-xl px-14 py-6 rounded-full shadow-md hover:shadow-lg transition-all duration-300 transform hover:-translate-y-1">
                    Jetzt kostenlos registrieren
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