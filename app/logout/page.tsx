"use client"

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2 } from 'lucide-react'

export default function LogoutPage() {
  const router = useRouter()

  useEffect(() => {
    const performLogout = async () => {
      try {
        await signOut({ redirect: false })
        router.push('/')
      } catch (error) {
        console.error('Fehler beim Abmelden:', error)
        // Optionale Fehlerbehandlung hier
      }
    }

    performLogout()
  }, [router])

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex flex-col items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Abmelden</CardTitle>
          <CardDescription>Sie werden abgemeldet und zur Startseite weitergeleitet.</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button disabled>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Wird abgemeldet...
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}