'use client'

import { SurfaceCard } from '@/components/discovery';
import { Lightbulb, FileCheck2 } from 'lucide-react';
import { AppShell, AppHeader } from '@/components/app-shell';
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/sites-auth/react'
import type { Session } from '@/lib/sites-auth/server'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { format } from "date-fns"
import { de } from "date-fns/locale"
import { Calendar as CalendarIcon, X } from "lucide-react"
import { Sidebar } from "@/components/Sidebar"
import { UserNav } from "@/components/user-nav"
import { ThemeToggle } from "@/components/theme-toggle"
import Link from 'next/link'

function courseCreationError(status: number) {
  if (status === 401) return 'Deine Anmeldung ist abgelaufen. Melde dich erneut an. Deine Eingaben bleiben hier erhalten.'
  if (status === 403) return 'Der Kursentwurf konnte mit deiner Anmeldung nicht angelegt werden. Deine Eingaben bleiben hier erhalten.'
  if (status === 409) return 'Dieser Anlegeversuch gehört bereits zu einem anderen Entwurf. Prüfe deine Kursentwürfe, bevor du einen neuen Versuch startest.'
  if (status === 400 || status === 413) return 'Bitte prüfe Titel, Kategorie, Zeitraum und Zahlenwerte. Deine Eingaben bleiben hier erhalten.'
  if (status === 429) return 'Es gab gerade zu viele Anfragen. Warte einen Moment und versuche es erneut. Deine Eingaben bleiben hier erhalten.'
  return 'Der Kursentwurf konnte gerade nicht angelegt werden. Deine Eingaben bleiben hier erhalten. Bitte versuche es erneut.'
}

export default function NewCoursePage() {
  const { data, status } = useSession()
  const session = status === 'authenticated' ? data : null
  return <CourseComposer key={session?.user?.id ?? 'anonymous'} session={session} />
}

function CourseComposer({ session }: { session: Session | null }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState<Date | undefined>(undefined)
  const [endDate, setEndDate] = useState<Date | undefined>(undefined)
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [maxStudents, setMaxStudents] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submissionInFlight = useRef(false)
  const creationRequest = useRef<{ payload: string; requestId: string } | null>(null)

  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submissionInFlight.current) return
    setError(null)

    if (!session) {
      setError('Melde dich an, um einen Kursentwurf anzulegen. Deine Eingaben bleiben hier erhalten.')
      return
    }

    if (startDate && endDate && endDate < startDate) {
      setError('Das Enddatum muss nach dem Startdatum liegen.')
      return
    }

    if (!title.trim() || !description.trim()) {
      setError('Gib einen Kurstitel und eine Kategorie ein.')
      return
    }

    submissionInFlight.current = true
    setIsSubmitting(true)
    let navigating = false
    try {
      const payload = JSON.stringify({ title, description, startDate: startDate?.toISOString() ?? null,
        endDate: endDate?.toISOString() ?? null, price, currency, maxStudents })
      // Keep the same key for an unchanged retry, including an uncertain network
      // result. The server returns the existing draft instead of creating a copy.
      if (creationRequest.current?.payload !== payload) {
        creationRequest.current = { payload, requestId: crypto.randomUUID() }
      }
      const formData = new FormData()
      formData.append('requestId', creationRequest.current.requestId)
      formData.append('title', title)
      formData.append('description', description)
      if (startDate) formData.append('startDate', startDate.toISOString())
      if (endDate) formData.append('endDate', endDate.toISOString())
      formData.append('price', price)
      formData.append('currency', currency)
      formData.append('maxStudents', maxStudents)

      const response = await fetch('/api/courses', {
        method: 'POST',
        body: formData,
      })

      const created = await response.json().catch(() => null) as { id?: unknown } | null
      if (!response.ok) { setError(courseCreationError(response.status)); return }

      if (typeof created?.id !== 'string' || !created.id) {
        setError('Der Anlegeversuch konnte nicht bestätigt werden. Deine Eingaben bleiben hier erhalten. Versuche es erneut oder prüfe deine Kursentwürfe.')
        return
      }
      router.push(`/courses/${encodeURIComponent(created.id)}/contents`)
      navigating = true
    } catch (error) {
      console.error('Fehler beim Erstellen des Kurses:', error)
      setError('Die Verbindung konnte nicht bestätigt werden. Deine Eingaben bleiben hier erhalten. Bitte versuche es erneut.')
    } finally {
      if (!navigating) {
        submissionInFlight.current = false
        setIsSubmitting(false)
      }
    }
  }

  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="app-header-row">
            <h1 className="app-header-title">Neuen Kursentwurf anlegen</h1>
            <div className="app-header-actions"><ThemeToggle /><UserNav /></div>
          </div>
        </AppHeader>
        <main id="page-content" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1200px] px-4 pb-16 pt-7 sm:px-6 sm:pt-10 lg:px-8">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1"><Link href="/courses" className="inline-flex min-h-11 items-center text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:rounded-sm">← Zur Kursübersicht</Link><Link href="/courses/authoring" className="inline-flex min-h-11 items-center text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:rounded-sm">Meine Kursentwürfe</Link></div>
            <div className="mt-3 border-b pb-7">
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">Der Entwurf ist für Lernende erst nach deiner ausdrücklichen Veröffentlichung sichtbar.</p>
            </div>

            <div className="mt-8 grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
              <form onSubmit={handleSubmit} className="min-w-0 space-y-5" aria-label="Neuen Kurs erstellen" aria-busy={isSubmitting}>
                <fieldset disabled={isSubmitting} className="min-w-0 space-y-5">
                <section aria-labelledby="course-basics-title" className="fc-form-section space-y-5">
                  <div><h2 id="course-basics-title" className="fc-step-title text-lg font-semibold"><span aria-hidden="true">1</span>Kursdaten</h2></div>
                  <div className="space-y-2">
                    <Label htmlFor="title">Kurstitel</Label>
                    <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="z. B. Einführung in React" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Kurskategorie</Label>
                    <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} required placeholder="z. B. Webentwicklung" />
                  </div>
                </section>

                <section aria-labelledby="course-details-title" className="fc-form-section space-y-5">
                  <div><h2 id="course-details-title" className="fc-step-title text-lg font-semibold"><span aria-hidden="true">2</span>Zeitraum und Plätze</h2></div>
                  <div className="grid min-w-0 gap-5 sm:grid-cols-2">
                    <div className="min-w-0 space-y-2">
                      <Label htmlFor="start-date">Startdatum (optional)</Label>
                      <Popover>
                        <PopoverTrigger asChild><Button id="start-date" type="button" variant="outline" className="w-full min-w-0 justify-between font-normal"><span className="min-w-0 truncate">{startDate ? format(startDate, 'PPP', { locale: de }) : 'Datum auswählen'}</span><CalendarIcon aria-hidden="true" className="h-4 w-4 shrink-0 opacity-60" /></Button></PopoverTrigger>
                        <PopoverContent className="w-auto max-w-[calc(100vw-2rem)] p-0" align="start"><Calendar mode="single" selected={startDate} onSelect={date => setStartDate(date)} locale={de} autoFocus /></PopoverContent>
                      </Popover>
                      {startDate && <Button type="button" variant="ghost" size="sm" onClick={() => setStartDate(undefined)}><X aria-hidden="true" className="h-4 w-4" />Startdatum entfernen</Button>}
                    </div>
                    <div className="min-w-0 space-y-2">
                      <Label htmlFor="end-date">Enddatum (optional)</Label>
                      <Popover>
                        <PopoverTrigger asChild><Button id="end-date" type="button" variant="outline" className="w-full min-w-0 justify-between font-normal"><span className="min-w-0 truncate">{endDate ? format(endDate, 'PPP', { locale: de }) : 'Datum auswählen'}</span><CalendarIcon aria-hidden="true" className="h-4 w-4 shrink-0 opacity-60" /></Button></PopoverTrigger>
                        <PopoverContent className="w-auto max-w-[calc(100vw-2rem)] p-0" align="start"><Calendar mode="single" selected={endDate} onSelect={date => setEndDate(date)} locale={de} autoFocus /></PopoverContent>
                      </Popover>
                      {endDate && <Button type="button" variant="ghost" size="sm" onClick={() => setEndDate(undefined)}><X aria-hidden="true" className="h-4 w-4" />Enddatum entfernen</Button>}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maxStudents">Maximale Teilnehmerzahl</Label>
                    <Input id="maxStudents" type="number" value={maxStudents} onChange={(e) => setMaxStudents(e.target.value)} required placeholder="z. B. 20" min="1" className="sm:max-w-xs" />
                  </div>
                </section>

                <section aria-labelledby="course-price-title" className="fc-form-section space-y-5">
                  <div><h2 id="course-price-title" className="fc-step-title text-lg font-semibold"><span aria-hidden="true">3</span>Kosten festlegen</h2><p className="mt-1 text-sm text-muted-foreground">Trage 0 für einen kostenlosen Kurs ein.</p></div>
                  <div className="grid min-w-0 gap-5 sm:grid-cols-2">
                    <div className="min-w-0 space-y-2"><Label htmlFor="price">Preis</Label><Input id="price" type="number" value={price} onChange={(e) => setPrice(e.target.value)} required placeholder="0.00" min="0" step="0.01" /></div>
                    <div className="min-w-0 space-y-2"><Label htmlFor="currency">Währung</Label><select id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} required className="h-11 w-full rounded-xl border border-input bg-background px-3 py-2 text-base text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-sm"><option value="EUR">EUR</option><option value="USD">USD</option><option value="GBP">GBP</option></select></div>
                  </div>
                </section>

                <section aria-labelledby="course-image-title" className="fc-form-section space-y-2"><h2 id="course-image-title" className="fc-step-title text-lg font-semibold"><span aria-hidden="true">4</span>Kursbild</h2><p className="text-sm leading-relaxed text-muted-foreground">Ein privates Titelbild kannst du im Autorenarbeitsplatz hochladen, sobald der Kursentwurf angelegt ist.</p></section>

                <div className="space-y-5 border-t pt-7">
                  {error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><p>{error}</p><Link href="/courses/authoring" target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center font-semibold underline underline-offset-4">Meine Kursentwürfe prüfen<span className="sr-only"> (öffnet in neuem Tab)</span></Link></div>}
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button asChild variant="outline"><Link href="/courses">Abbrechen</Link></Button><Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting ? 'Entwurf wird angelegt …' : error ? 'Erneut versuchen' : 'Kursentwurf anlegen'}</Button></div>
                </div>
                </fieldset>
              </form>
              <aside className="space-y-4 lg:sticky lg:top-6" aria-label="Hinweise zum Kursentwurf"><SurfaceCard className="p-5"><Lightbulb className="mb-3 h-6 w-6 text-primary" aria-hidden="true" /><h2 className="font-semibold">Ein guter Kurs beginnt mit einer Idee.</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Wähle einen klaren Titel und eine passende Kategorie. Inhalte und ein Titelbild ergänzt du anschließend im Autorenarbeitsplatz.</p></SurfaceCard><SurfaceCard className="p-5"><FileCheck2 className="mb-3 h-6 w-6 text-primary" aria-hidden="true" /><h2 className="font-semibold">Vom Entwurf zum Kurs</h2><ol className="mt-4 list-decimal space-y-3 pl-4 text-sm leading-relaxed text-muted-foreground"><li>Kursentwurf anlegen</li><li>Inhalte und Kursbild ergänzen</li><li>Kurs prüfen und veröffentlichen</li></ol></SurfaceCard></aside>
            </div>
          </div>
        </main>
      </div>
    </AppShell>
  )
}
