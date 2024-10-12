'use client'

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
import { CalendarIcon, X } from "lucide-react"
import { Sidebar } from "@/components/Sidebar"
import { UserNav } from "@/components/user-nav"
import { ThemeToggle } from "@/components/theme-toggle"

export default function NewCoursePage() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState<Date | null>(null)
  const [endDate, setEndDate] = useState<Date | null>(null)
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [maxStudents, setMaxStudents] = useState('')

  const router = useRouter()
  const { data: session } = useSession()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!session) {
      alert('Sie müssen angemeldet sein, um einen Kurs zu erstellen.')
      return
    }

    try {
      const response = await fetch('/api/courses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          description,
          startDate: startDate?.toISOString() || null,
          endDate: endDate?.toISOString() || null,
          price,
          currency,
          maxStudents,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Fehler beim Erstellen des Kurses')
      }

      router.push('/courses')
    } catch (error) {
      console.error('Fehler beim Erstellen des Kurses:', error)
      alert('Fehler beim Erstellen des Kurses. Bitte versuchen Sie es erneut.')
    }
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-md z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Neuen Kurs erstellen</h2>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4">
          <div className="max-w-2xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
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
              <div className="flex space-x-4">
                <div className="w-1/2">
                  <Label>Startdatum (optional)</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start text-left font-normal">
                        {startDate ? format(startDate, "PPP", { locale: de }) : <span>Datum auswählen</span>}
                        {startDate && (
                          <X
                            className="ml-auto h-4 w-4 opacity-50 hover:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation()
                              setStartDate(null)
                            }}
                          />
                        )}
                        {!startDate && <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={startDate}
                        onSelect={setStartDate}
                        locale={de}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="w-1/2">
                  <Label>Enddatum (optional)</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start text-left font-normal">
                        {endDate ? format(endDate, "PPP", { locale: de }) : <span>Datum auswählen</span>}
                        {endDate && (
                          <X
                            className="ml-auto h-4 w-4 opacity-50 hover:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation()
                              setEndDate(null)
                            }}
                          />
                        )}
                        {!endDate && <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={endDate}
                        onSelect={setEndDate}
                        locale={de}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div className="flex space-x-4">
                <div className="w-1/2">
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
                <div className="w-1/2">
                  <Label htmlFor="currency">Währung</Label>
                  <select
                    id="currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    required
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
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
              <Button type="submit" className="w-full">Kurs erstellen</Button>
            </form>
          </div>
        </main>
      </div>
    </div>
  )
}