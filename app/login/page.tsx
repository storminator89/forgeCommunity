"use client"

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 */
/* Hallmark · genre: editorial · macrostructure: focused auth · design-system: design.md · designed-as-app */

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { getProviders, signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ThemeToggle } from '@/components/theme-toggle'
import { useClientReady } from '@/lib/use-client-ready'
import Link from 'next/link'
import { ArrowUpRight, Eye, EyeOff, Loader2, LogIn } from 'lucide-react'
import { ForgeBrandMark } from '@/components/forge-brand-mark'

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
    <div className="min-h-svh bg-background text-foreground">
      <a href="#page-content" className="skip-link">Zum Inhalt springen</a>
      <header className="border-b bg-card">
        <div className="mx-auto flex min-h-20 max-w-6xl items-center justify-between gap-3 px-4 sm:px-8">
          <Link href="/" aria-label="ForgeCommunity Startseite" className="flex min-w-0 items-center gap-2.5 whitespace-nowrap text-base font-semibold tracking-tight">
            <ForgeBrandMark />
            ForgeCommunity
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main id="page-content" tabIndex={-1} className="mx-auto grid min-h-[calc(100svh-5rem)] max-w-6xl items-center gap-12 px-4 py-12 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-20 lg:py-20">
        <section className="fc-auth-context hidden min-w-0 lg:block" aria-label="Über ForgeCommunity">

          <p className="max-w-[12ch] text-[clamp(2.75rem,2rem+2.5vw,4.5rem)] font-semibold leading-[1.08] tracking-[-0.05em]">Dein Platz für Austausch und neue Ideen.</p>

        </section>
        <div className="fc-auth-card mx-auto w-full max-w-md min-w-0">

          <h1 className="text-[clamp(2rem,1.5rem+2vw,2.7rem)] font-semibold tracking-[-0.04em]">Anmelden</h1>

          <div className="mt-7 space-y-6">
            <form method="post" onSubmit={handleSubmit} className="space-y-5" aria-busy={isLoading}>
              <div className="space-y-2">
                <Label htmlFor="email">E-Mail-Adresse</Label>
                <Input id="email" name="email" type="email" autoComplete="username" maxLength={254} placeholder="name@example.com" value={email} onChange={event => setEmail(event.target.value)} required disabled={isLoading} className="h-11" aria-describedby={error ? 'login-error' : undefined} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Passwort</Label>
                <div className="relative">
                  <Input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required disabled={isLoading} className="h-11 pr-14" aria-describedby={error ? 'login-error' : undefined} />
                  <Button type="button" size="icon" variant="ghost" className="absolute right-0 top-0 h-11 w-11" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'} aria-pressed={showPassword}>
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
            {googleAvailable && <><div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />oder<span className="h-px flex-1 bg-border" /></div><Button type="button" variant="outline" className="h-11 w-full" onClick={handleGoogleSignIn} disabled={isLoading}>Mit Google anmelden</Button></>}
            <p className="text-sm text-muted-foreground">Noch kein Konto? <Link href="/register" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">Konto erstellen <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></Link></p>
          </div>
        </div>
      </main>
    </div>
  )
}

export default function LoginPage() {
  return <Suspense fallback={<div><a href="#page-content" className="skip-link">Zum Inhalt springen</a><main id="page-content" tabIndex={-1} className="flex min-h-svh items-center justify-center gap-3 bg-background text-muted-foreground" role="status"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />Anmeldung wird geladen…</main></div>}><LoginContent /></Suspense>
}
