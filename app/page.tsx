"use client"

import { Button } from "@/components/ui/button"
import { UserNav } from "@/components/user-nav"
import Link from 'next/link'
import { Users, GraduationCap, Calendar, MessageCircle, ArrowRight, LogIn, ChevronDown, ExternalLink, Heart, BookOpen } from 'lucide-react'
import { ThemeToggle } from "@/components/theme-toggle"
import { useInView } from "@/hooks/useInView"
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import Image from 'next/image'

export default function Home() {
  const [heroRef, heroInView] = useInView();
  const [featuresRef, featuresInView] = useInView();
  const [screenshotRef, screenshotInView] = useInView();
  const [ctaRef, ctaInView] = useInView();

  return (
    <div className="h-screen overflow-y-scroll snap-y snap-mandatory" style={{ scrollBehavior: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <header className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-md shadow-lg z-50 fixed top-0 w-full h-16 border-b border-gray-200/50 dark:border-gray-700/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-8">
            <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-600 via-blue-500 to-blue-400 bg-clip-text text-transparent">ForgeCommunity</h2>
            <nav className="hidden md:flex space-x-6">
              <Link href="/community" className="text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex items-center gap-1.5">
                <Users className="h-4 w-4" />
                <span>Community</span>
              </Link>
              <Link href="/events" className="text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                <span>Events</span>
              </Link>
              <Link href="/resources" className="text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex items-center gap-1.5">
                <BookOpen className="h-4 w-4" />
                <span>Ressourcen</span>
              </Link>
            </nav>
          </div>
          <div className="flex items-center space-x-4">
            <ThemeToggle />
            <Link href="/login">
              <Button variant="outline" size="sm" className="hidden sm:flex items-center hover:bg-blue-50 dark:hover:bg-gray-700 transition-all duration-300 transform hover:-translate-y-0.5">
                <LogIn className="mr-2 h-4 w-4" />
                Login
              </Button>
            </Link>
            <UserNav />
          </div>
        </div>
      </header>

      <main>
        <section
          ref={heroRef}
          className="h-screen pt-24 snap-start flex items-center justify-center bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10 animate-gradient overflow-hidden relative"
        >
          {/* Decorative elements */}
          <div className="absolute top-20 left-10 w-64 h-64 bg-blue-400/10 dark:bg-blue-600/10 rounded-full blur-3xl"></div>
          <div className="absolute bottom-20 right-10 w-72 h-72 bg-purple-400/10 dark:bg-purple-600/10 rounded-full blur-3xl"></div>

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center z-10">
            <div className={`transform transition-all duration-700 will-change-transform ${heroInView ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'}`}>
              <Badge className="mb-6 px-4 py-1.5 text-sm bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded-full inline-flex items-center">
                <span className="relative flex h-2 w-2 mr-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </span>
                Willkommen bei ForgeCommunity
              </Badge>

              <h1 className="text-6xl md:text-7xl lg:text-8xl font-extrabold text-gray-900 dark:text-white mb-8 leading-tight tracking-tight">
                Entdecke, Lerne, <span className="bg-gradient-to-r from-blue-600 via-blue-500 to-blue-400 bg-clip-text text-transparent">Verbinde</span>
              </h1>

              <p className="text-xl md:text-2xl lg:text-3xl text-gray-600 dark:text-gray-300 mb-12 max-w-4xl mx-auto leading-relaxed">
                ForgeCommunity ist deine Plattform für Wachstum, Austausch und Zusammenarbeit.
                Trete einer Community bei, die deine Leidenschaft für Lernen und Entwicklung teilt.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
                <Link href="/community">
                  <Button className="bg-blue-600 hover:bg-blue-700 text-white text-lg md:text-xl px-8 py-6 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 w-full sm:w-auto">
                    Zur Community
                    <ArrowRight className="ml-3 h-5 w-5" />
                  </Button>
                </Link>

                <Link href="/register">
                  <Button variant="outline" className="text-lg md:text-xl px-8 py-6 rounded-full border-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all duration-300 transform hover:-translate-y-1 w-full sm:w-auto">
                    Jetzt registrieren
                  </Button>
                </Link>
              </div>

              <div className="mt-8 animate-bounce will-change-transform">
                <ChevronDown className="mx-auto h-10 w-10 text-gray-400" />
              </div>
            </div>
          </div>
        </section>

        <section
          ref={featuresRef}
          className="min-h-screen pt-32 snap-start bg-gradient-to-r from-green-500/10 via-teal-500/10 to-blue-500/10 animate-gradient relative overflow-hidden"
        >
          {/* Decorative elements */}
          <div className="absolute top-40 right-20 w-80 h-80 bg-teal-400/10 dark:bg-teal-600/10 rounded-full blur-3xl"></div>
          <div className="absolute bottom-40 left-20 w-96 h-96 bg-green-400/10 dark:bg-green-600/10 rounded-full blur-3xl"></div>

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className={`transform transition-all duration-700 will-change-transform ${featuresInView ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'} pt-16`}>
              <div className="text-center mb-16">
                <Badge className="mb-4 px-3 py-1 text-sm bg-teal-100 dark:bg-teal-900/30 text-teal-800 dark:text-teal-300 rounded-full">
                  Entdecke unsere Funktionen
                </Badge>
                <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 dark:text-white mb-6">
                  Unsere <span className="bg-gradient-to-r from-teal-600 to-green-400 bg-clip-text text-transparent">Features</span>
                </h2>
                <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto">
                  Alles was du brauchst, um deine Lernreise zu beginnen und mit Gleichgesinnten zu wachsen
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-7xl mx-auto">
                <Card className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 shadow-lg hover:shadow-xl transition-all duration-200 transform hover:-translate-y-2 overflow-hidden group will-change-transform">
                  <CardHeader className="pb-4">
                    <div className="w-14 h-14 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-4 group-hover:bg-blue-200 dark:group-hover:bg-blue-800/50 transition-colors">
                      <Users className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                    </div>
                    <CardTitle className="text-2xl font-bold group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">Lebendige Community</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
                      Tausche dich mit Gleichgesinnten aus und knüpfe wertvolle Kontakte in einer aktiven und unterstützenden Gemeinschaft.
                    </p>
                  </CardContent>
                  <CardFooter className="pt-0">
                    <Link href="/community" className="text-blue-600 dark:text-blue-400 font-medium inline-flex items-center hover:underline">
                      Mehr erfahren
                      <ArrowRight className="ml-1 h-4 w-4" />
                    </Link>
                  </CardFooter>
                </Card>

                <Card className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 shadow-lg hover:shadow-xl transition-all duration-200 transform hover:-translate-y-2 overflow-hidden group will-change-transform">
                  <CardHeader className="pb-4">
                    <div className="w-14 h-14 rounded-2xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4 group-hover:bg-green-200 dark:group-hover:bg-green-800/50 transition-colors">
                      <GraduationCap className="w-8 h-8 text-green-600 dark:text-green-400" />
                    </div>
                    <CardTitle className="text-2xl font-bold group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors">Lernressourcen</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
                      Zugang zu hochwertigen Kursen und Workshops für deine persönliche und berufliche Entwicklung. Lerne von Experten und erweitere dein Wissen.
                    </p>
                  </CardContent>
                  <CardFooter className="pt-0">
                    <Link href="/resources" className="text-green-600 dark:text-green-400 font-medium inline-flex items-center hover:underline">
                      Mehr erfahren
                      <ArrowRight className="ml-1 h-4 w-4" />
                    </Link>
                  </CardFooter>
                </Card>

                <Card className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 shadow-lg hover:shadow-xl transition-all duration-200 transform hover:-translate-y-2 overflow-hidden group will-change-transform">
                  <CardHeader className="pb-4">
                    <div className="w-14 h-14 rounded-2xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mb-4 group-hover:bg-purple-200 dark:group-hover:bg-purple-800/50 transition-colors">
                      <Calendar className="w-8 h-8 text-purple-600 dark:text-purple-400" />
                    </div>
                    <CardTitle className="text-2xl font-bold group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">Events</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
                      Nimm an spannenden Online- und Offline-Veranstaltungen teil. Vernetze dich bei Workshops, Webinaren und Community-Treffen.
                    </p>
                  </CardContent>
                  <CardFooter className="pt-0">
                    <Link href="/events" className="text-purple-600 dark:text-purple-400 font-medium inline-flex items-center hover:underline">
                      Mehr erfahren
                      <ArrowRight className="ml-1 h-4 w-4" />
                    </Link>
                  </CardFooter>
                </Card>

                <Card className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 shadow-lg hover:shadow-xl transition-all duration-200 transform hover:-translate-y-2 overflow-hidden group will-change-transform">
                  <CardHeader className="pb-4">
                    <div className="w-14 h-14 rounded-2xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center mb-4 group-hover:bg-orange-200 dark:group-hover:bg-orange-800/50 transition-colors">
                      <MessageCircle className="w-8 h-8 text-orange-600 dark:text-orange-400" />
                    </div>
                    <CardTitle className="text-2xl font-bold group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors">Diskussionsforen</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
                      Stelle Fragen, teile dein Wissen und beteilige dich an interessanten Diskussionen. Profitiere vom Austausch mit der Community.
                    </p>
                  </CardContent>
                  <CardFooter className="pt-0">
                    <Link href="/community" className="text-orange-600 dark:text-orange-400 font-medium inline-flex items-center hover:underline">
                      Mehr erfahren
                      <ArrowRight className="ml-1 h-4 w-4" />
                    </Link>
                  </CardFooter>
                </Card>
              </div>
            </div>
          </div>
        </section>

        <section
          ref={screenshotRef}
          className="min-h-screen pt-32 snap-start bg-gradient-to-r from-purple-500/10 via-indigo-500/10 to-blue-500/10 animate-gradient relative overflow-hidden"
        >
          {/* Decorative elements */}
          <div className="absolute top-40 left-20 w-80 h-80 bg-indigo-400/10 dark:bg-indigo-600/10 rounded-full blur-3xl"></div>
          <div className="absolute bottom-40 right-20 w-96 h-96 bg-purple-400/10 dark:bg-purple-600/10 rounded-full blur-3xl"></div>

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className={`transform transition-all duration-700 will-change-transform ${screenshotInView ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'} pt-16`}>
              <div className="text-center mb-16">
                <Badge className="mb-4 px-3 py-1 text-sm bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300 rounded-full">
                  Entdecke die Plattform
                </Badge>
                <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 dark:text-white mb-6">
                  Ein <span className="bg-gradient-to-r from-purple-600 to-indigo-400 bg-clip-text text-transparent">Blick</span> in unsere Plattform
                </h2>
                <p className="text-xl text-gray-600 dark:text-gray-300 max-w-3xl mx-auto mb-12">
                  Sieh dir an, wie unsere Plattform dir helfen kann, deine Ziele zu erreichen
                </p>
              </div>

              <div className="max-w-5xl mx-auto">
                <Carousel className="w-full">
                  <CarouselContent>
                    <CarouselItem>
                      <div className="p-1">
                        <Card className="overflow-hidden border-0 shadow-2xl">
                          <CardContent className="p-0">
                            <div className="relative group">
                              <Image
                                src="/images/screenshot.png"
                                alt="ForgeCommunity Screenshot"
                                width={1200}
                                height={800}
                                sizes="100vw"
                                style={{ width: '100%', height: 'auto' }}
                                className="w-full h-auto rounded-lg"
                              />
                              <div className="absolute inset-0 rounded-lg bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex items-end justify-start p-8">
                                <div className="text-white">
                                  <h3 className="text-2xl font-bold mb-2">Community Dashboard</h3>
                                  <p className="text-gray-200">Entdecke Beiträge, Events und Ressourcen auf einen Blick</p>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    </CarouselItem>

                    <CarouselItem>
                      <div className="p-1">
                        <Card className="overflow-hidden border-0 shadow-2xl">
                          <CardContent className="p-0">
                            <div className="relative group">
                              <Image
                                src="/images/knowlegdebase.png"
                                alt="Wissensdatenbank"
                                width={1200}
                                height={800}
                                sizes="100vw"
                                style={{ width: '100%', height: 'auto' }}
                                className="w-full h-auto rounded-lg"
                              />
                              <div className="absolute inset-0 rounded-lg bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex items-end justify-start p-8">
                                <div className="text-white">
                                  <h3 className="text-2xl font-bold mb-2">Wissensdatenbank</h3>
                                  <p className="text-gray-200">Greife auf umfangreiche Lernressourcen und Artikel zu</p>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    </CarouselItem>

                    <CarouselItem>
                      <div className="p-1">
                        <Card className="overflow-hidden border-0 shadow-2xl">
                          <CardContent className="p-0">
                            <div className="relative group">
                              <Image
                                src="/images/usermanaagement.png"
                                alt="Benutzerverwaltung"
                                width={1200}
                                height={800}
                                sizes="100vw"
                                style={{ width: '100%', height: 'auto' }}
                                className="w-full h-auto rounded-lg"
                              />
                              <div className="absolute inset-0 rounded-lg bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex items-end justify-start p-8">
                                <div className="text-white">
                                  <h3 className="text-2xl font-bold mb-2">Benutzerverwaltung</h3>
                                  <p className="text-gray-200">Verwalte dein Profil und verfolge deinen Fortschritt</p>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    </CarouselItem>
                  </CarouselContent>
                  <div className="flex justify-center mt-8 gap-2">
                    <CarouselPrevious className="static transform-none mx-2 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm hover:bg-white dark:hover:bg-gray-800" />
                    <CarouselNext className="static transform-none mx-2 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm hover:bg-white dark:hover:bg-gray-800" />
                  </div>
                </Carousel>
              </div>
            </div>
          </div>
        </section>

        <section
          ref={ctaRef}
          className="min-h-screen pt-32 snap-start bg-gradient-to-r from-blue-600 to-blue-800 dark:from-blue-800 dark:to-blue-900 relative overflow-hidden"
        >
          {/* Decorative elements */}
          <div className="absolute top-0 left-0 w-full h-full bg-[url('/images/grid.svg')] opacity-10"></div>
          <div className="absolute top-40 right-20 w-96 h-96 bg-blue-400/20 rounded-full blur-3xl"></div>
          <div className="absolute bottom-40 left-20 w-80 h-80 bg-blue-300/20 rounded-full blur-3xl"></div>

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className={`transform transition-all duration-700 will-change-transform ${ctaInView ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'} pt-16`}>
              <div className="text-center text-white">
                <Badge className="mb-6 px-4 py-1.5 text-sm bg-blue-500/30 text-blue-100 rounded-full inline-flex items-center">
                  <Heart className="mr-2 h-4 w-4 text-pink-300" fill="currentColor" />
                  Werde Teil unserer Community
                </Badge>

                <h2 className="text-5xl md:text-6xl font-bold mb-6">Bereit loszulegen?</h2>

                <p className="text-xl md:text-2xl mb-12 max-w-3xl mx-auto leading-relaxed text-blue-100">
                  Werde Teil unserer wachsenden Community und starte deine Lernreise noch heute.
                  Registriere dich kostenlos und erhalte sofortigen Zugang zu allen Features.
                </p>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-16">
                  <Link href="/register">
                    <Button className="bg-white text-blue-600 hover:bg-gray-100 text-lg md:text-xl px-10 py-6 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 w-full sm:w-auto">
                      Jetzt kostenlos registrieren
                      <ArrowRight className="ml-3 h-5 w-5" />
                    </Button>
                  </Link>

                  <Link href="/about">
                    <Button variant="outline" className="text-lg md:text-xl px-10 py-6 rounded-full border-2 border-white/30 text-white hover:bg-white/10 transition-all duration-300 transform hover:-translate-y-1 w-full sm:w-auto">
                      Mehr über uns
                      <ExternalLink className="ml-3 h-5 w-5" />
                    </Button>
                  </Link>
                </div>

                <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
                  <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/10 hover:bg-white/20 transition-all duration-300">
                    <div className="flex items-center justify-center mb-4">
                      <Users className="h-8 w-8 text-blue-300" />
                    </div>
                    <h3 className="text-xl font-semibold mb-2">10,000+ Mitglieder</h3>
                    <p className="text-blue-100/80">Werde Teil einer wachsenden Community von Gleichgesinnten</p>
                  </div>

                  <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/10 hover:bg-white/20 transition-all duration-300">
                    <div className="flex items-center justify-center mb-4">
                      <GraduationCap className="h-8 w-8 text-blue-300" />
                    </div>
                    <h3 className="text-xl font-semibold mb-2">500+ Kurse</h3>
                    <p className="text-blue-100/80">Zugang zu hochwertigen Lernressourcen für deine Entwicklung</p>
                  </div>

                  <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/10 hover:bg-white/20 transition-all duration-300">
                    <div className="flex items-center justify-center mb-4">
                      <Calendar className="h-8 w-8 text-blue-300" />
                    </div>
                    <h3 className="text-xl font-semibold mb-2">Wöchentliche Events</h3>
                    <p className="text-blue-100/80">Regelmäßige Veranstaltungen zum Netzwerken und Lernen</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}