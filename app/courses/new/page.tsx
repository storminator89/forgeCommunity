'use client'

import { AppShell, AppHeader } from '@/components/app-shell';
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { format } from "date-fns"
import { de } from "date-fns/locale"
import { Calendar as CalendarIcon, X, Upload } from "lucide-react"
import { Sidebar } from "@/components/Sidebar"
import { UserNav } from "@/components/user-nav"
import { ThemeToggle } from "@/components/theme-toggle"
import Image from 'next/image'
import Link from 'next/link'

export default function NewCoursePage() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState<Date | undefined>(undefined)
  const [endDate, setEndDate] = useState<Date | undefined>(undefined)
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [maxStudents, setMaxStudents] = useState('')
  const [image, setImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const router = useRouter()
  const { data: session } = useSession()

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setImage(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setImagePreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return
    setError(null)

    if (!session) {
      setError('Sie müssen angemeldet sein, um einen Kurs zu erstellen.')
      return
    }

    if (startDate && endDate && endDate < startDate) {
      setError('Das Enddatum muss nach dem Startdatum liegen.')
      return
    }

    setIsSubmitting(true)
    try {
      const formData = new FormData()
      formData.append('title', title)
      formData.append('description', description)
      if (startDate) formData.append('startDate', startDate.toISOString())
      if (endDate) formData.append('endDate', endDate.toISOString())
      formData.append('price', price)
      formData.append('currency', currency)
      formData.append('maxStudents', maxStudents)
      if (image) formData.append('image', image)

      const response = await fetch('/api/courses', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Fehler beim Erstellen des Kurses')
      }

      router.push('/courses')
    } catch (error) {
      console.error('Fehler beim Erstellen des Kurses:', error)
      setError(error instanceof Error ? error.message : 'Fehler beim Erstellen des Kurses. Bitte versuchen Sie es erneut.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="flex items-center justify-between gap-3">
            <h1>Neuen Kurs erstellen</h1>
            <div className="flex shrink-0 items-center gap-1 sm:gap-2"><ThemeToggle /><UserNav /></div>
          </div>
        </AppHeader>
        <main id="page-content" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1200px] px-4 pb-16 pt-7 sm:px-6 sm:pt-10 lg:px-8">
            <Link href="/courses" className="inline-flex min-h-11 items-center text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:rounded-sm">← Zur Kursübersicht</Link>
            <div className="mt-3 border-b pb-7">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Wissen weitergeben</p>
              <h2 className="max-w-2xl text-[clamp(1.65rem,1.2rem+2vw,2.4rem)] font-semibold leading-tight tracking-tight">Ein neuer Kurs für die Community.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">Beschreibe das Thema und lege die wichtigsten Eckdaten fest. Die Kursinhalte kannst du danach verwalten.</p>
            </div>

            <div className="mt-8 grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-12">
              <form onSubmit={handleSubmit} className="min-w-0 space-y-9" aria-label="Neuen Kurs erstellen">
                <section aria-labelledby="course-basics-title" className="space-y-5">
                  <div><h3 id="course-basics-title" className="text-lg font-semibold">Das Wichtigste zuerst</h3><p className="mt-1 text-sm text-muted-foreground">Worum geht es in deinem Kurs?</p></div>
                  <div className="space-y-2">
                    <Label htmlFor="title">Kurstitel</Label>
                    <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="z. B. Einführung in React" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Kurskategorie</Label>
                    <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} required placeholder="z. B. Webentwicklung" />
                    <p className="text-xs leading-relaxed text-muted-foreground">Diese Angabe erscheint als Kategorie in der Kursübersicht.</p>
                  </div>
                </section>

                <section aria-labelledby="course-details-title" className="space-y-5 border-t pt-8">
                  <div><h3 id="course-details-title" className="text-lg font-semibold">Zeitraum und Plätze</h3><p className="mt-1 text-sm text-muted-foreground">Termine sind optional. Die Teilnehmerzahl hilft bei der Planung.</p></div>
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

                <section aria-labelledby="course-price-title" className="space-y-5 border-t pt-8">
                  <div><h3 id="course-price-title" className="text-lg font-semibold">Kosten festlegen</h3><p className="mt-1 text-sm text-muted-foreground">Trage 0 für einen kostenlosen Kurs ein.</p></div>
                  <div className="grid min-w-0 gap-5 sm:grid-cols-2">
                    <div className="min-w-0 space-y-2"><Label htmlFor="price">Preis</Label><Input id="price" type="number" value={price} onChange={(e) => setPrice(e.target.value)} required placeholder="0.00" min="0" step="0.01" /></div>
                    <div className="min-w-0 space-y-2"><Label htmlFor="currency">Währung</Label><select id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} required className="h-11 w-full rounded-xl border border-input bg-background px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-sm"><option value="EUR">EUR</option><option value="USD">USD</option><option value="GBP">GBP</option></select></div>
                  </div>
                </section>

                <section aria-labelledby="course-image-title" className="space-y-4 border-t pt-8">
                  <div><h3 id="course-image-title" className="text-lg font-semibold">Kursbild</h3><p className="mt-1 text-sm text-muted-foreground">Optional. Ein Bild macht dein Thema leichter erkennbar.</p></div>
                  <div className="flex min-w-0 flex-wrap items-center gap-4">
                    <label htmlFor="image" className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border border-input bg-background px-4 py-2 text-sm font-semibold text-foreground hover:bg-accent hover:text-accent-foreground focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"><Upload aria-hidden="true" className="h-4 w-4" />Bild auswählen<input id="image" name="image" type="file" className="sr-only" onChange={handleImageChange} accept="image/*" /></label>
                    {imagePreview && <div className="flex min-w-0 items-center gap-3"><Image src={imagePreview} alt="Vorschau" width={64} height={64} className="h-16 w-16 shrink-0 rounded-xl border object-cover" /><span className="min-w-0 truncate text-sm text-muted-foreground">{image?.name}</span></div>}
                  </div>
                </section>

                <div className="space-y-5 border-t pt-7">
                  {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</p>}
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button asChild variant="outline"><Link href="/courses">Abbrechen</Link></Button><Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting ? 'Kurs wird erstellt…' : 'Kurs erstellen'}</Button></div>
                </div>
              </form>
              <aside className="h-fit rounded-2xl border bg-card p-5 text-sm leading-relaxed text-muted-foreground" aria-label="Hinweise zur Kurserstellung">
                <p className="font-semibold text-foreground">Auf einen Blick</p>
                <ul className="mt-3 list-inside list-disc space-y-2"><li>Gib deinem Kurs einen klaren Titel.</li><li>Mit optionalen Terminen wissen Teilnehmende, wann es losgeht.</li><li>Nach dem Erstellen kannst du die Kursinhalte verwalten.</li></ul>
              </aside>
            </div>
          </div>
        </main>
      </div>
    </AppShell>
  )
}
