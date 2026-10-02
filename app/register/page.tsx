"use client"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getProviders, signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { ThemeToggle } from '@/components/theme-toggle'
import { useClientReady } from '@/lib/use-client-ready'
import { validatePassword } from '@/lib/security'
import Link from 'next/link'
import { UserPlus, Eye, EyeOff, Loader2, Flame, ArrowUpRight } from 'lucide-react'

export default function RegisterPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [registered, setRegistered] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const isReady = useClientReady()
  const [googleAvailable, setGoogleAvailable] = useState(false)
  const router = useRouter()

  useEffect(() => {
    let active = true
    getProviders().then(providers => {
      if (active) setGoogleAvailable(Boolean(providers?.google))
    }).catch(() => {})
    return () => { active = false }
  }, [])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (isLoading || registered) return
    setError('')
    if (!name.trim()) { setError('Bitte gib deinen Namen ein.'); return }
    const passwordValidation = validatePassword(password)
    if (!passwordValidation.valid) { setError(passwordValidation.errors[0]); return }
    if (new TextEncoder().encode(password).length > 72) { setError('Das Passwort ist zu lang. Verwende bitte weniger Zeichen.'); return }
    if (password !== confirmPassword) { setError('Die Passwörter stimmen nicht überein.'); return }
    setIsLoading(true)
    try {
      const response = await fetch('/api/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        setError(data?.message || 'Registrierung fehlgeschlagen. Bitte versuche es erneut.')
        return
      }
      setRegistered(true)
      const result = await signIn('credentials', { redirect: false, email: email.trim(), password })
      if (result?.ok && !result.error) {
        router.push('/community')
        router.refresh()
      } else {
        setError('Dein Konto wurde erstellt. Bitte melde dich über die Anmeldeseite an.')
      }
    } catch {
      setError('Der Vorgang konnte nicht abgeschlossen werden. Bitte versuche die Anmeldung oder Registrierung erneut.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleSignUp = async () => {
    setError('')
    setIsLoading(true)
    try { await signIn('google', { callbackUrl: '/community' }) }
    catch { setError('Die Anmeldung mit Google ist momentan nicht möglich.'); setIsLoading(false) }
  }

  return (
    <main className="min-h-svh bg-background px-4 py-8 text-foreground sm:px-8">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Flame className="h-5 w-5" aria-hidden="true" /></span>ForgeCommunity</Link>
        <ThemeToggle />
      </div>
      <div className="mx-auto max-w-md py-12 sm:py-16">
        <Card className="w-full">
          <CardHeader className="space-y-2 p-6 sm:p-8"><h1 className="text-2xl font-semibold tracking-tight">Konto erstellen</h1></CardHeader>
          <CardContent className="space-y-6 p-6 pt-0 sm:p-8 sm:pt-0">
            <form method="post" onSubmit={handleSubmit} className="space-y-4" aria-busy={isLoading}>
              <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" name="name" autoComplete="name" maxLength={120} placeholder="Dein Name" value={name} onChange={event => setName(event.target.value)} required disabled={isLoading || registered} className="h-11" /></div>
              <div className="space-y-2"><Label htmlFor="email">E-Mail-Adresse</Label><Input id="email" name="email" type="email" autoComplete="email" maxLength={254} placeholder="name@example.com" value={email} onChange={event => setEmail(event.target.value)} required disabled={isLoading || registered} className="h-11" /></div>
              <div className="space-y-2">
                <Label htmlFor="password">Passwort</Label>
                <div className="relative"><Input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} value={password} onChange={event => setPassword(event.target.value)} required disabled={isLoading || registered} className="h-11 pr-12" aria-describedby="password-help" /><Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1 h-9 w-9" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Passwörter verbergen' : 'Passwörter anzeigen'} aria-pressed={showPassword}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button></div>
                <p id="password-help" className="text-xs leading-relaxed text-muted-foreground">Mindestens 12 Zeichen mit Groß- und Kleinbuchstaben, Zahl und Sonderzeichen.</p>
              </div>
              <div className="space-y-2"><Label htmlFor="confirmPassword">Passwort bestätigen</Label><Input id="confirmPassword" name="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required disabled={isLoading || registered} className="h-11" /></div>
              {error && <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
              {registered && !isLoading ? <Button asChild className="h-11 w-full"><Link href="/login">Zur Anmeldung</Link></Button> : <Button type="submit" className="h-11 w-full" disabled={isLoading || !isReady}>{isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />}{isLoading ? 'Konto wird erstellt…' : 'Konto erstellen'}</Button>}
            </form>
            {googleAvailable && !registered && <><div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />oder<span className="h-px flex-1 bg-border" /></div><Button variant="outline" className="h-11 w-full" onClick={handleGoogleSignUp} disabled={isLoading}>Mit Google registrieren</Button></>}
            <p className="text-sm text-muted-foreground">Bereits ein Konto? <Link href="/login" className="font-medium text-primary hover:underline">Anmelden</Link></p>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
