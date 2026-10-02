'use client'

import { AppShell, AppHeader } from '@/components/app-shell';
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
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
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <h1 className="min-w-0 text-lg sm:text-2xl font-bold text-foreground">Neuen Kurs erstellen</h1>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </AppHeader>
        <main id="page-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4">
          <div className="max-w-2xl mx-auto bg-card rounded-lg shadow-md p-6">

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <Label htmlFor="title">Kurstitel</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  placeholder="z.B. Einführung in React"
                />
              </div>
              <div>
                <Label htmlFor="description">Kurskategorie</Label>
                <Input
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                  placeholder="z.B. Webentwicklung"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="min-w-0">
                  <Label htmlFor="start-date">Startdatum (optional)</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button id="start-date" type="button" variant="outline" className="w-full justify-start text-left font-normal">
                        {startDate ? format(startDate, "PPP", { locale: de }) : <span>Datum auswählen</span>}
                        <CalendarIcon className="ml-auto h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={startDate}
                        onSelect={(date) => setStartDate(date)}
                        locale={de}
                        autoFocus
                      />
                    </PopoverContent>
                  </Popover>
                  {startDate && <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={() => setStartDate(undefined)}><X className="mr-1 h-4 w-4" />Startdatum entfernen</Button>}
                </div>
                <div className="min-w-0">
                  <Label htmlFor="end-date">Enddatum (optional)</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button id="end-date" type="button" variant="outline" className="w-full justify-start text-left font-normal">
                        {endDate ? format(endDate, "PPP", { locale: de }) : <span>Datum auswählen</span>}
                        <CalendarIcon className="ml-auto h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={endDate}
                        onSelect={(date) => setEndDate(date)}
                        locale={de}
                        autoFocus
                      />
                    </PopoverContent>
                  </Popover>
                  {endDate && <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={() => setEndDate(undefined)}><X className="mr-1 h-4 w-4" />Enddatum entfernen</Button>}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="min-w-0">
                  <Label htmlFor="price">Preis</Label>
                  <Input
                    id="price"
                    type="number"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    required
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                  />
                </div>
                <div className="min-w-0">
                  <Label htmlFor="currency">Währung</Label>
                  <select
                    id="currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    required
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-foreground focus:border-blue-500 focus:ring-blue-500 dark:border-border dark:bg-card dark:text-foreground"
                  >
                    <option value="EUR">EUR</option>
                    <option value="USD">USD</option>
                    <option value="GBP">GBP</option>
                  </select>
                </div>
              </div>
              <div>
                <Label htmlFor="maxStudents">Maximale Teilnehmerzahl</Label>
                <Input
                  id="maxStudents"
                  type="number"
                  value={maxStudents}
                  onChange={(e) => setMaxStudents(e.target.value)}
                  required
                  placeholder="z.B. 20"
                  min="1"
                />
              </div>
              <div>
                <Label htmlFor="image">Kursbild</Label>
                <div className="mt-1 flex items-center">
                  <label htmlFor="image" className="cursor-pointer bg-card dark:bg-muted border border-border rounded-md font-medium text-blue-600 dark:text-blue-400 hover:text-blue-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-blue-500">
                    <span className="flex items-center px-3 py-2">
                      <Upload className="h-5 w-5 mr-2" />
                      Bild auswählen
                    </span>
                    <input id="image" name="image" type="file" className="sr-only" onChange={handleImageChange} accept="image/*" />
                  </label>
                  {imagePreview && (
                    <div className="ml-4">
                      <Image src={imagePreview} alt="Vorschau" width={80} height={80} className="object-cover rounded-md" />
                    </div>
                  )}
                </div>
              </div>
              {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={isSubmitting} className="w-full">{isSubmitting ? "Kurs wird erstellt…" : "Kurs erstellen"}</Button>
            </form>
          </div>
        </main>
      </div>
    </AppShell>
  )
}
