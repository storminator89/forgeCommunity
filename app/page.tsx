import { Button } from "@/components/ui/button"
import { UserNav } from "@/components/user-nav"
import { Sidebar } from "@/components/Sidebar"
import Link from 'next/link'
import { Users, GraduationCap, Calendar, MessageCircle } from 'lucide-react'
import { ThemeToggle } from "@/components/theme-toggle"

export default function Home() {
  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-sm z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Willkommen bei ForgeCommunity</h2>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto bg-gray-100 dark:bg-gray-900">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <section className="text-center mb-16">
              <h1 className="text-5xl font-bold text-gray-900 dark:text-white mb-4">Entdecke, Lerne, Verbinde</h1>
              <p className="text-xl text-gray-600 dark:text-gray-300 mb-8">ForgeCommunity ist deine Plattform für Wachstum, Austausch und Zusammenarbeit.</p>
              <Link href="/community">
                <Button className="bg-blue-600 hover:bg-blue-700 text-white text-lg px-8 py-3">Zur Community</Button>
              </Link>
            </section>
            
            <div className="grid md:grid-cols-2 gap-8">
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
          </div>
        </main>
      </div>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, description }) {
  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200 border border-gray-200 dark:border-gray-700">
      <Icon className="w-12 h-12 text-blue-600 dark:text-blue-400 mb-4" />
      <h3 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">{title}</h3>
      <p className="text-gray-600 dark:text-gray-300">{description}</p>
    </div>
  );
}