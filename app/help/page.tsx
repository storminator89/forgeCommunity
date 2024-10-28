// app/help/page.tsx
"use client"

import { useState, useEffect } from 'react'
import { Sidebar } from "@/components/Sidebar"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Label } from "@/components/ui/label"
import { 
  Search, 
  Book, 
  MessageSquare, 
  Users, 
  Settings, 
  Mail,
  Video,
  Shield,
  Lightbulb,
  ThumbsUp,
  AlertCircle,
  CheckCircle2,
  Clock,
  Tag,
  BellRing,
  Smartphone,
  KeyRound,
  FileText,
  HelpCircle,
  Palette,
  Share2,
  Globe,
  Headphones
} from 'lucide-react'

const helpCategories = [
  {
    icon: <MessageSquare className="h-6 w-6" />,
    title: "Chat & Kommunikation",
    description: "Alles über die Chat-Funktionen",
    tag: "Grundlagen",
    popularity: 95,
    lastUpdate: "2024-01-15",
    faqs: [
      {
        question: "Wie erstelle ich einen neuen Channel?",
        answer: "Als Administrator können Sie über den '+' Button in der Channel-Liste neue Channels erstellen. Geben Sie einen Namen ein und wählen Sie, ob der Channel privat sein soll.",
        tags: ["Channel", "Admin"],
        helpful: 124
      },
      {
        question: "Wie sende ich Bilder im Chat?",
        answer: "Klicken Sie auf das Bild-Symbol neben dem Nachrichtenfeld, wählen Sie ein Bild aus und senden Sie es mit dem Senden-Button. Unterstützt werden JPG, PNG und GIF-Dateien bis 5MB.",
        tags: ["Bilder", "Upload"],
        helpful: 89
      },
      {
        question: "Wie bearbeite ich eine Nachricht?",
        answer: "Bewegen Sie den Mauszeiger über Ihre Nachricht und klicken Sie auf das Stift-Symbol. Nach der Bearbeitung drücken Sie Enter oder klicken auf das Häkchen.",
        tags: ["Nachrichten", "Bearbeiten"],
        helpful: 156
      },
      {
        question: "Kann ich Nachrichten formatieren?",
        answer: "Ja, Sie können Markdown-Formatierung verwenden. *kursiv* für Kursivschrift, **fett** für Fettdruck, `code` für Code-Formatierung und ```für Codeblöcke```.",
        tags: ["Formatierung", "Markdown"],
        helpful: 78
      },
      {
        question: "Wie lösche ich eine Nachricht?",
        answer: "Bewegen Sie den Mauszeiger über Ihre Nachricht und klicken Sie auf das Papierkorb-Symbol. Administratoren können alle Nachrichten löschen.",
        tags: ["Löschen", "Nachrichten"],
        helpful: 92
      }
    ]
  },
  {
    icon: <BellRing className="h-6 w-6" />,
    title: "Benachrichtigungen",
    description: "Einstellungen und Verwaltung von Benachrichtigungen",
    tag: "Wichtig",
    popularity: 88,
    lastUpdate: "2024-01-20",
    faqs: [
      {
        question: "Wie stelle ich Benachrichtigungen ein?",
        answer: "Gehen Sie zu Einstellungen > Benachrichtigungen. Hier können Sie für jeden Channel separate Einstellungen vornehmen und zwischen verschiedenen Benachrichtigungsarten wählen.",
        tags: ["Einstellungen", "Benachrichtigungen"],
        helpful: 145
      },
      {
        question: "Kann ich Benachrichtigungen für bestimmte Zeiten stummschalten?",
        answer: "Ja, nutzen Sie die 'Nicht stören'-Funktion in den Benachrichtigungseinstellungen. Sie können Zeiträume festlegen, in denen Sie keine Benachrichtigungen erhalten möchten.",
        tags: ["Nicht stören", "Zeitplan"],
        helpful: 112
      },
      {
        question: "Wie aktiviere ich Desktop-Benachrichtigungen?",
        answer: "Wenn Sie die Aufforderung zur Aktivierung von Benachrichtigungen sehen, klicken Sie auf 'Erlauben'. Sie können dies auch in Ihren Browsereinstellungen unter Berechtigungen aktivieren.",
        tags: ["Desktop", "Browser"],
        helpful: 98
      }
    ]
  },
  {
    icon: <Shield className="h-6 w-6" />,
    title: "Sicherheit & Privatsphäre",
    description: "Schutz Ihrer Daten und Einstellungen",
    tag: "Wichtig",
    popularity: 92,
    lastUpdate: "2024-01-18",
    faqs: [
      {
        question: "Wie aktiviere ich die Zwei-Faktor-Authentifizierung?",
        answer: "Gehen Sie zu Einstellungen > Sicherheit > Zwei-Faktor-Authentifizierung. Folgen Sie den Anweisungen zur Einrichtung mit Ihrer bevorzugten Authentifizierungs-App.",
        tags: ["2FA", "Sicherheit"],
        helpful: 167
      },
      {
        question: "Wie ändere ich mein Passwort?",
        answer: "Navigieren Sie zu Einstellungen > Sicherheit > Passwort ändern. Geben Sie Ihr aktuelles und neues Passwort ein. Verwenden Sie ein sicheres Passwort mit mindestens 12 Zeichen.",
        tags: ["Passwort", "Änderung"],
        helpful: 143
      },
      {
        question: "Wer kann meine Profilinformationen sehen?",
        answer: "In den Privatsphäre-Einstellungen können Sie festlegen, wer Ihr Profil, Ihre Online-Status und andere Informationen sehen kann. Die Optionen sind: Alle, Nur Follower oder Niemand.",
        tags: ["Privatsphäre", "Profil"],
        helpful: 189
      }
    ]
  },

  {
    icon: <Smartphone className="h-6 w-6" />,
    title: "Mobile App",
    description: "Nutzung der mobilen Anwendung",
    tag: "App",
    popularity: 85,
    lastUpdate: "2024-01-10",
    faqs: [
      {
        question: "Wo kann ich die mobile App herunterladen?",
        answer: "Die App ist sowohl im Apple App Store als auch im Google Play Store verfügbar. Suchen Sie nach 'ForgeCommunity' oder nutzen Sie die direkten Links auf unserer Website.",
        tags: ["Download", "Installation"],
        helpful: 234
      },
      {
        question: "Wie synchronisiere ich meine Daten?",
        answer: "Die Synchronisation erfolgt automatisch, sobald Sie sich in der App anmelden. Stellen Sie sicher, dass Sie eine stabile Internetverbindung haben.",
        tags: ["Sync", "Daten"],
        helpful: 156
      },
      {
        question: "Unterscheidet sich die App von der Desktop-Version?",
        answer: "Die App bietet die gleichen Kernfunktionen wie die Desktop-Version, ist aber für mobile Nutzung optimiert. Einige erweiterte Verwaltungsfunktionen sind nur in der Desktop-Version verfügbar.",
        tags: ["Funktionen", "Vergleich"],
        helpful: 178
      }
    ]
  },
  {
    icon: <Palette className="h-6 w-6" />,
    title: "Personalisierung",
    description: "Anpassung der Benutzeroberfläche",
    tag: "Design",
    popularity: 78,
    lastUpdate: "2024-01-05",
    faqs: [
      {
        question: "Wie ändere ich das Farbschema?",
        answer: "Unter Einstellungen > Erscheinungsbild können Sie zwischen verschiedenen Farbschemata wählen oder ein eigenes erstellen. Es gibt auch einen automatischen Dark/Light Mode.",
        tags: ["Theme", "Farben"],
        helpful: 145
      },
      {
        question: "Kann ich die Schriftgröße anpassen?",
        answer: "Ja, unter Einstellungen > Barrierefreiheit können Sie die Schriftgröße und den Schrifttyp nach Ihren Bedürfnissen anpassen.",
        tags: ["Schrift", "Barrierefreiheit"],
        helpful: 89
      }
    ]
  },
  {
    icon: <Share2 className="h-6 w-6" />,
    title: "Integration & API",
    description: "Entwickler-Ressourcen und API-Nutzung",
    tag: "Entwickler",
    popularity: 72,
    lastUpdate: "2024-01-12",
    faqs: [
      {
        question: "Wie erhalte ich einen API-Schlüssel?",
        answer: "Registrieren Sie sich im Entwickler-Portal und erstellen Sie ein neues Projekt. Der API-Schlüssel wird automatisch generiert und kann in den Projekt-Einstellungen eingesehen werden.",
        tags: ["API", "Entwicklung"],
        helpful: 167
      },
      {
        question: "Gibt es Nutzungsbeschränkungen für die API?",
        answer: "Ja, es gibt Rate-Limits abhängig von Ihrem Entwickler-Plan. Standard-Accounts haben 1000 Anfragen pro Stunde, Business-Accounts 10.000.",
        tags: ["Limits", "Rate-Limiting"],
        helpful: 134
      }
    ]
  },
  {
    icon: <Globe className="h-6 w-6" />,
    title: "Internationalisierung",
    description: "Sprachen und regionale Einstellungen",
    tag: "Sprachen",
    popularity: 65,
    lastUpdate: "2024-01-08",
    faqs: [
      {
        question: "Welche Sprachen werden unterstützt?",
        answer: "Aktuell unterstützen wir Deutsch, Englisch, Französisch, Spanisch und Italienisch. Weitere Sprachen werden kontinuierlich hinzugefügt.",
        tags: ["Sprachen", "Lokalisierung"],
        helpful: 123
      },
      {
        question: "Wie ändere ich die Sprache?",
        answer: "Die Sprache kann unter Einstellungen > Sprache & Region geändert werden. Die Änderung wird sofort wirksam, ein Neustart ist nicht erforderlich.",
        tags: ["Einstellungen", "Sprache"],
        helpful: 98
      }
    ]
  },
  {
    icon: <Headphones className="h-6 w-6" />,
    title: "Support & Hilfe",
    description: "Unterstützung und Problemlösung",
    tag: "Support",
    popularity: 88,
    lastUpdate: "2024-01-19",
    faqs: [
      {
        question: "Wie kontaktiere ich den Support?",
        answer: "Sie können uns über das Kontaktformular, per E-Mail an support@forge.com oder über den Live-Chat erreichen. Unsere Supportzeiten sind Mo-Fr 9-18 Uhr.",
        tags: ["Kontakt", "Support"],
        helpful: 245
      },
      {
        question: "Wie schnell erhalte ich eine Antwort?",
        answer: "Wir bemühen uns, alle Anfragen innerhalb von 24 Stunden zu beantworten. Premium-Mitglieder erhalten priorisierten Support mit einer Reaktionszeit von maximal 4 Stunden.",
        tags: ["Reaktionszeit", "Service"],
        helpful: 178
      },
      {
        question: "Gibt es eine Community für gegenseitige Hilfe?",
        answer: "Ja, in unserem Community-Forum können Sie Fragen stellen und Erfahrungen mit anderen Nutzern austauschen. Aktive Community-Mitglieder werden mit Badges ausgezeichnet.",
        tags: ["Community", "Forum"],
        helpful: 156
      }
    ]
  }
];

interface ContactFormData {
  email: string;
  subject: string;
  message: string;
  priority: 'low' | 'medium' | 'high';
  category: string;
}

export default function HelpPage() {
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
    const [contactForm, setContactForm] = useState<ContactFormData>({
      email: '',
      subject: '',
      message: '',
      priority: 'medium',
      category: 'general'
    })
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [searchHistory, setSearchHistory] = useState<string[]>([])
    const [recentlyViewed, setRecentlyViewed] = useState<string[]>([])
    const [activeTab, setActiveTab] = useState('all')
    
    // Suche mit Debounce
    useEffect(() => {
      const timer = setTimeout(() => {
        if (searchQuery && !searchHistory.includes(searchQuery)) {
          setSearchHistory(prev => [searchQuery, ...prev].slice(0, 5))
        }
      }, 1000)
  
      return () => clearTimeout(timer)
    }, [searchQuery])
  
    // Kürzlich angesehene Artikel speichern
    const trackViewedArticle = (question: string) => {
      setRecentlyViewed(prev => {
        const updated = [question, ...prev.filter(q => q !== question)].slice(0, 5)
        localStorage.setItem('recentlyViewed', JSON.stringify(updated))
        return updated
      })
    }
  
    // Laden der kürzlich angesehenen Artikel beim Start
    useEffect(() => {
      const saved = localStorage.getItem('recentlyViewed')
      if (saved) {
        setRecentlyViewed(JSON.parse(saved))
      }
    }, [])
  
    const filteredCategories = helpCategories.filter(category => {
      const matchesSearch = 
        category.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        category.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        category.faqs.some(faq => 
          faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
          faq.answer.toLowerCase().includes(searchQuery.toLowerCase()) ||
          faq.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
        )
      return matchesSearch && (!selectedCategory || category.title === selectedCategory)
    })
  
    const handleContactSubmit = async (e: React.FormEvent) => {
      e.preventDefault()
      setIsSubmitting(true)
      
      try {
        // Simuliere API-Aufruf
        await new Promise(resolve => setTimeout(resolve, 1500))
        
        console.log("Support-Anfrage gesendet:", contactForm)
        
        setContactForm({
          email: '',
          subject: '',
          message: '',
          priority: 'medium',
          category: 'general'
        })
  
        // Erfolgsmeldung anzeigen
        alert('Ihre Anfrage wurde erfolgreich gesendet. Wir melden uns in Kürze bei Ihnen.')
      } catch (error) {
        console.error('Fehler beim Senden der Anfrage:', error)
        alert('Es gab einen Fehler beim Senden Ihrer Anfrage. Bitte versuchen Sie es später erneut.')
      } finally {
        setIsSubmitting(false)
      }
    }
  
    const handleHelpful = (categoryIndex: number, faqIndex: number) => {
      // Simuliere API-Aufruf für Feedback
      console.log("Feedback registriert für:", {
        category: helpCategories[categoryIndex].title,
        question: helpCategories[categoryIndex].faqs[faqIndex].question
      })
      
      // Optimistisches Update
      const updatedCategories = [...helpCategories]
      updatedCategories[categoryIndex].faqs[faqIndex].helpful += 1
      
      // Feedback-Bestätigung
      alert('Danke für Ihr Feedback!')
    }
  
    const getPopularQuestions = () => {
      return helpCategories
        .flatMap(category => 
          category.faqs.map(faq => ({
            ...faq,
            category: category.title
          }))
        )
        .sort((a, b) => b.helpful - a.helpful)
        .slice(0, 5)
    }
  
    const popularQuestions = getPopularQuestions()
  
    return (
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar className="hidden md:block" />
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto">
                      {/* Hero Section mit verbessertem Design */}
          <div className="relative bg-gradient-to-r from-primary/10 via-primary/5 to-background px-6 lg:px-8 py-24 space-y-8">
            <div className="absolute inset-0 bg-grid-white/10 bg-[size:40px_40px] pointer-events-none" />
            <div className="mx-auto max-w-2xl text-center relative">
              <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                Wie können wir Ihnen helfen?
              </h1>
              <p className="mt-6 text-lg leading-8 text-muted-foreground">
                Durchsuchen Sie unsere Hilfe-Themen oder kontaktieren Sie uns direkt
              </p>
            </div>
            <div className="mx-auto max-w-xl relative">
              <div className="flex items-center space-x-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Suchen Sie nach Hilfe-Themen..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Button>
                  Suchen
                </Button>
              </div>
              {searchQuery && (
                <div className="absolute w-full bg-background border rounded-md mt-2 p-2 shadow-lg space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {filteredCategories.reduce((acc, cat) => acc + cat.faqs.length, 0)} Ergebnisse gefunden
                  </p>
                  {searchHistory.length > 0 && (
                    <div className="border-t pt-2">
                      <p className="text-xs text-muted-foreground mb-1">Letzte Suchen:</p>
                      <div className="flex flex-wrap gap-2">
                        {searchHistory.map((term, index) => (
                          <Badge 
                            key={index} 
                            variant="secondary" 
                            className="cursor-pointer"
                            onClick={() => setSearchQuery(term)}
                          >
                            {term}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Quick Stats mit Animation */}
          <div className="mx-auto max-w-7xl px-6 lg:px-8 py-12">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <Card className="hover:shadow-lg transition-shadow">
                <CardHeader className="space-y-1">
                  <CardTitle className="text-2xl">200+</CardTitle>
                  <CardDescription>Hilfe-Artikel</CardDescription>
                </CardHeader>
              </Card>
              <Card className="hover:shadow-lg transition-shadow">
                <CardHeader className="space-y-1">
                  <CardTitle className="text-2xl">98%</CardTitle>
                  <CardDescription>Zufriedene Nutzer</CardDescription>
                </CardHeader>
              </Card>
              <Card className="hover:shadow-lg transition-shadow">
                <CardHeader className="space-y-1">
                  <CardTitle className="text-2xl">&lt; 2h</CardTitle>
                  <CardDescription>Durchschnittliche Antwortzeit</CardDescription>
                </CardHeader>
              </Card>
              <Card className="hover:shadow-lg transition-shadow">
                <CardHeader className="space-y-1">
                  <CardTitle className="text-2xl">24/7</CardTitle>
                  <CardDescription>Community Support</CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>

          {/* Beliebte Fragen */}
          <div className="mx-auto max-w-7xl px-6 lg:px-8 py-12 border-t">
            <h2 className="text-2xl font-bold mb-6">Häufig gestellte Fragen</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">Top 5 Fragen</h3>
                <div className="space-y-4">
                  {popularQuestions.map((question, index) => (
                    <div 
                      key={index}
                      className="p-4 rounded-lg border hover:border-primary/50 transition-colors cursor-pointer"
                      onClick={() => trackViewedArticle(question.question)}
                    >
                      <div className="flex items-start space-x-3">
                        <span className="text-2xl font-bold text-primary/60">
                          {index + 1}
                        </span>
                        <div>
                          <h4 className="font-medium">{question.question}</h4>
                          <p className="text-sm text-muted-foreground mt-1">
                            {question.category}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-4">Kürzlich angesehen</h3>
                <div className="space-y-4">
                  {recentlyViewed.map((question, index) => (
                    <div 
                      key={index}
                      className="p-4 rounded-lg border hover:border-primary/50 transition-colors"
                    >
                      <div className="flex items-center space-x-3">
                        <Clock className="h-5 w-5 text-muted-foreground" />
                        <span>{question}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
                    {/* Kategorien Tabs und Grid */}
                    <div className="mx-auto max-w-7xl px-6 lg:px-8 py-12 border-t">
            <Tabs defaultValue="all" className="space-y-6" value={activeTab} onValueChange={setActiveTab}>
              <div className="flex items-center justify-between mb-6">
                <TabsList className="inline-flex">
                  <TabsTrigger value="all">Alle Kategorien</TabsTrigger>
                  <TabsTrigger value="basics">Grundlagen</TabsTrigger>
                  <TabsTrigger value="advanced">Fortgeschritten</TabsTrigger>
                  <TabsTrigger value="security">Sicherheit</TabsTrigger>
                </TabsList>
                <div className="flex items-center space-x-2">
                  <Label>Sortieren nach:</Label>
                  <select 
                    className="border rounded-md p-2"
                    onChange={(e) => console.log("Sortierung:", e.target.value)}
                  >
                    <option value="popular">Beliebtheit</option>
                    <option value="newest">Neueste</option>
                    <option value="alphabetical">A-Z</option>
                  </select>
                </div>
              </div>
              
              <TabsContent value="all" className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredCategories.map((category, index) => (
                    <Card key={index} className="flex flex-col hover:shadow-lg transition-shadow">
                      <CardHeader>
                        <div className="flex items-center space-x-4">
                          <div className="p-2 rounded-lg bg-primary/10">
                            {category.icon}
                          </div>
                          <div className="space-y-1 flex-1">
                            <div className="flex items-center justify-between">
                              <CardTitle>{category.title}</CardTitle>
                              <Badge variant="secondary">{category.tag}</Badge>
                            </div>
                            <CardDescription>{category.description}</CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="flex-1">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Beliebtheit</span>
                            <span className="font-medium">{category.popularity}%</span>
                          </div>
                          <Progress value={category.popularity} className="h-2" />
                        </div>
                        <Accordion type="single" collapsible className="w-full mt-4">
                          {category.faqs.map((faq, faqIndex) => (
                            <AccordionItem key={faqIndex} value={`item-${faqIndex}`}>
                              <AccordionTrigger className="hover:no-underline">
                                <div className="flex items-start text-left">
                                  <span>{faq.question}</span>
                                </div>
                              </AccordionTrigger>
                              <AccordionContent>
                                <div className="space-y-4">
                                  <p className="text-sm leading-relaxed">{faq.answer}</p>
                                  <div className="flex items-center justify-between">
                                    <div className="flex flex-wrap gap-2">
                                      {faq.tags.map((tag, tagIndex) => (
                                        <Badge key={tagIndex} variant="outline">
                                          <Tag className="mr-1 h-3 w-3" />
                                          {tag}
                                        </Badge>
                                      ))}
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleHelpful(index, faqIndex)}
                                      className="hover:bg-primary/10"
                                    >
                                      <ThumbsUp className="mr-2 h-4 w-4" />
                                      <span className="text-sm">{faq.helpful}</span>
                                    </Button>
                                  </div>
                                </div>
                              </AccordionContent>
                            </AccordionItem>
                          ))}
                        </Accordion>
                      </CardContent>
                      <CardFooter className="flex justify-between border-t pt-4">
                        <div className="flex items-center text-sm text-muted-foreground">
                          <Clock className="mr-1 h-4 w-4" />
                          Aktualisiert: {new Date(category.lastUpdate).toLocaleDateString('de-DE')}
                        </div>
                        <Button variant="ghost" size="sm">
                          Alle anzeigen
                        </Button>
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Kontakt-Sektion mit erweitertem Formular */}
          <div className="mx-auto max-w-7xl px-6 lg:px-8 py-12 border-t bg-muted/50">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight">
                Noch Fragen?
              </h2>
              <p className="mt-4 text-muted-foreground">
                Unser Support-Team steht Ihnen zur Verfügung
              </p>
              <div className="mt-6 flex justify-center space-x-4">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button>
                      <Mail className="mr-2 h-4 w-4" />
                      Support kontaktieren
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[525px]">
                    <DialogHeader>
                      <DialogTitle>Kontaktieren Sie uns</DialogTitle>
                      <DialogDescription>
                        Wir melden uns schnellstmöglich bei Ihnen zurück.
                      </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleContactSubmit} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="email">Ihre E-Mail</Label>
                          <Input
                            id="email"
                            type="email"
                            placeholder="name@beispiel.de"
                            value={contactForm.email}
                            onChange={(e) => setContactForm(prev => ({
                              ...prev,
                              email: e.target.value
                            }))}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="category">Kategorie</Label>
                          <select
                            id="category"
                            className="w-full border rounded-md p-2"
                            value={contactForm.category}
                            onChange={(e) => setContactForm(prev => ({
                              ...prev,
                              category: e.target.value
                            }))}
                            required
                          >
                            <option value="general">Allgemein</option>
                            <option value="technical">Technisch</option>
                            <option value="billing">Abrechnung</option>
                            <option value="other">Sonstiges</option>
                          </select>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="subject">Betreff</Label>
                        <Input
                          id="subject"
                          placeholder="Worum geht es?"
                          value={contactForm.subject}
                          onChange={(e) => setContactForm(prev => ({
                            ...prev,
                            subject: e.target.value
                          }))}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="message">Nachricht</Label>
                        <Textarea
                          id="message"
                          placeholder="Beschreiben Sie Ihr Anliegen..."
                          value={contactForm.message}
                          onChange={(e) => setContactForm(prev => ({
                            ...prev,
                            message: e.target.value
                          }))}
                          required
                          className="min-h-[100px]"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Priorität</Label>
                        <div className="flex space-x-4">
                          {['low', 'medium', 'high'].map((priority) => (
                            <label key={priority} className="flex items-center space-x-2">
                              <input
                                type="radio"
                                name="priority"
                                value={priority}
                                checked={contactForm.priority === priority}
                                onChange={(e) => setContactForm(prev => ({
                                  ...prev,
                                  priority: e.target.value as 'low' | 'medium' | 'high'
                                }))}
                                className="form-radio"
                              />
                              <span className="capitalize">{priority}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <DialogFooter>
                        <Button type="submit" disabled={isSubmitting}>
                          {isSubmitting ? (
                            <>Wird gesendet...</>
                          ) : (
                            <>
                              <Mail className="mr-2 h-4 w-4" />
                              Nachricht senden
                            </>
                          )}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
                <Button variant="outline">
                  <Book className="mr-2 h-4 w-4" />
                  Dokumentation
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}