"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { ThemeToggle } from "@/components/theme-toggle"
import Link from 'next/link'
import { LogIn, ArrowLeft } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      // Hier würden Sie normalerweise die Anmeldedaten an Ihren Server senden
      // Für dieses Beispiel simulieren wir eine erfolgreiche Anmeldung
      await new Promise(resolve => setTimeout(resolve, 1000))
      if (email === 'test@example.com' && password === 'password') {
        router.push('/dashboard')
      } else {
        throw new Error('Ungültige Anmeldedaten')
      }
    } catch (err) {
      setError('Anmeldung fehlgeschlagen. Bitte überprüfen Sie Ihre Eingaben.')
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex flex-col items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Willkommen zurück</CardTitle>
          <CardDescription className="text-center">
            Melden Sie sich an, um auf Ihr Konto zuzugreifen
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-Mail</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Passwort</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <Button type="submit" className="w-full">
              <LogIn className="mr-2 h-4 w-4" /> Anmelden
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <div className="flex items-center justify-between w-full text-sm">
            <Link href="/forgot-password" className="text-blue-500 hover:underline">
              Passwort vergessen?
            </Link>
            <Link href="/register" className="text-blue-500 hover:underline">
              Konto erstellen
            </Link>
          </div>
          <div className="relative w-full">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-gray-300 dark:border-gray-600" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-gray-100 dark:bg-gray-900 px-2 text-gray-500 dark:text-gray-400">
                Oder
              </span>
            </div>
          </div>
          <Button variant="outline" className="w-full">
            Mit Google anmelden
          </Button>
        </CardFooter>
      </Card>
      <div className="mt-8 flex items-center justify-between w-full max-w-md">
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 flex items-center">
          <ArrowLeft className="mr-2 h-4 w-4" /> Zurück zur Startseite
        </Link>
      </div>
    </div>
  )
}