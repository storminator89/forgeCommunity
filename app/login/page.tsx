"use client"

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { getProviders, signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ThemeToggle } from '@/components/theme-toggle'
import { useClientReady } from '@/lib/use-client-ready'
import Link from 'next/link'
import { ArrowLeft, ArrowUpRight, Eye, EyeOff, Loader2, LogIn, Network, ShieldCheck } from 'lucide-react'

function LoginContent() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const isReady = useClientReady()
  const [showPassword, setShowPassword] = useState(false)
  const [googleAvailable, setGoogleAvailable] = useState(false)
  const searchParams = useSearchParams()
  const requestedCallback = searchParams.get('callbackUrl')
  // Accept only local paths: credentials sign-in must never redirect to an arbitrary host.
  const callbackUrl = requestedCallback && /^\/(?![\\/])[^\\\u0000-\u001f\u007f]*$/.test(requestedCallback)
    ? requestedCallback : '/community'

  useEffect(() => {
    let active = true
    getProviders().then(providers => {
      if (active) setGoogleAvailable(Boolean(providers?.google))
    }).catch(() => {})
    return () => { active = false }
  }, [])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (isLoading) return
    setError('')
    setIsLoading(true)
    try {
      const result = await signIn('credentials', { redirect: false, email: email.trim(), password })
      if (result?.ok && !result.error) {
        window.location.assign(callbackUrl)
      } else {
        setError('Anmeldung fehlgeschlagen. Bitte prüfe deine E-Mail-Adresse und dein Passwort.')
        setIsLoading(false)
      }
    } catch {
      setError('Die Anmeldung ist momentan nicht möglich. Bitte versuche es erneut.')
      setIsLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setError('')
    setIsLoading(true)
    try {
      await signIn('google', { callbackUrl })
    } catch {
      setError('Die Anmeldung mit Google ist momentan nicht möglich.')
      setIsLoading(false)
    }
  }

  return (
    <main className="min-h-svh bg-background px-4 py-8 text-foreground sm:px-8">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Network className="h-5 w-5" aria-hidden="true" /></span>
          ForgeCommunity
        </Link>
        <ThemeToggle />
      </div>
      <div className="mx-auto grid min-h-[calc(100svh-8rem)] max-w-5xl items-center gap-10 py-10 md:grid-cols-2 md:gap-16">
        <div className="space-y-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Gemeinsam weiterkommen</p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Gute Ideen brauchen eine Community.</h1>
          <p className="max-w-md text-lg leading-relaxed text-muted-foreground">Lerne Neues, teile dein Wissen und entwickle Projekte mit Menschen, die deine Begeisterung teilen.</p>
          <div className="flex items-center gap-3 border-t border-border pt-6 text-sm text-muted-foreground"><ShieldCheck className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />Dein nächster Schritt beginnt hier.</div>
        </div>
        <Card className="w-full">
          <CardHeader className="space-y-2 p-6 sm:p-8">
            <CardTitle className="text-2xl tracking-tight">Willkommen zurück</CardTitle>
            <CardDescription>Melde dich mit deinem Community-Konto an.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 p-6 pt-0 sm:p-8 sm:pt-0">
            <form method="post" onSubmit={handleSubmit} className="space-y-5" aria-busy={isLoading}>
              <div className="space-y-2">
                <Label htmlFor="email">E-Mail-Adresse</Label>
                <Input id="email" name="email" type="email" autoComplete="username" maxLength={254} placeholder="name@example.com" value={email} onChange={event => setEmail(event.target.value)} required disabled={isLoading} className="h-11" aria-describedby={error ? 'login-error' : undefined} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Passwort</Label>
                <div className="relative">
                  <Input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required disabled={isLoading} className="h-11 pr-12" aria-describedby={error ? 'login-error' : undefined} />
                  <Button type="button" size="icon" variant="ghost" className="absolute right-1 top-1 h-9 w-9" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'} aria-pressed={showPassword}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              {error && <p id="login-error" role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
              <Button type="submit" className="h-11 w-full" disabled={isLoading || !isReady}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <LogIn className="mr-2 h-4 w-4" aria-hidden="true" />}
                {isLoading ? 'Anmeldung läuft…' : 'Anmelden'}
              </Button>
            </form>
            {googleAvailable && <><div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />oder<span className="h-px flex-1 bg-border" /></div><Button variant="outline" className="h-11 w-full" onClick={handleGoogleSignIn} disabled={isLoading}>Mit Google anmelden</Button></>}
            <p className="text-sm text-muted-foreground">Noch kein Konto? <Link href="/register" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">Konto erstellen <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></Link></p>
            <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Zur Startseite</Link>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return <Suspense fallback={<main className="flex min-h-svh items-center justify-center gap-3 bg-background text-muted-foreground" role="status"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />Anmeldung wird geladen…</main>}><LoginContent /></Suspense>
}
