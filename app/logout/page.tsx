"use client"

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, LogOut } from 'lucide-react'

export default function LogoutPage() {
  const router = useRouter()
  const [error, setError] = useState(false)
  const performLogout = useCallback(() => signOut({ redirect: false }).then(() => {
    router.replace('/')
    router.refresh()
  }).catch(() => { setError(true) }), [router])

  useEffect(() => { void performLogout() }, [performLogout])

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><LogOut className="h-5 w-5" aria-hidden="true" /></span>
          <CardTitle>Abmelden</CardTitle>
          <CardDescription>{error ? 'Die Abmeldung konnte nicht abgeschlossen werden.' : 'Sie werden abgemeldet und zur Startseite weitergeleitet.'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? <><p role="alert" className="text-sm text-destructive">Bitte versuchen Sie es erneut.</p><Button className="w-full" onClick={() => { setError(false); void performLogout() }}>Abmeldung erneut versuchen</Button><Button asChild variant="outline" className="w-full"><Link href="/community">Zur Community</Link></Button></> : <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Abmeldung läuft…</p>}
        </CardContent>
      </Card>
    </main>
  )
}
