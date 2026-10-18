'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, LockKeyhole, UsersRound } from 'lucide-react';
import { ForgeBrandMark } from '@/components/forge-brand-mark';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Props = { mode: 'login' | 'register'; callbackUrl?: string; errorCode?: string };
type LoginProvider = { id: 'google' | 'oidc'; name: string };
const oauthErrors: Record<string, string> = {
  OAuthAccountNotLinked: 'Diese E-Mail-Adresse gehört schon zu einem Konto. Nutze dessen bisherige Anmeldemethode. Konten werden nicht automatisch verknüpft.',
  OAuthVerifiedEmailRequired: 'Der Anmeldedienst muss eine bestätigte E-Mail-Adresse übermitteln.',
  OAuthAlreadySignedIn: 'Bitte melde dich zuerst ab, um den Anmeldedienst zu wechseln.',
  OAuthUnavailable: 'Dieser Anmeldedienst ist momentan nicht eingerichtet.',
  OAuthCallback: 'Die Anmeldung wurde abgebrochen oder ist abgelaufen. Bitte starte sie erneut.',
};

export function AuthForm({ mode, callbackUrl = '/community', errorCode }: Props) {
  const registering = mode === 'register';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(errorCode ? (oauthErrors[errorCode] || 'Die Anmeldung konnte nicht abgeschlossen werden.') : '');
  const [providers, setProviders] = useState<LoginProvider[]>([]);
  const [providersStatus, setProvidersStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const google = providers.find(provider => provider.id === 'google');
  const destination = callbackUrl.length <= 1024 && /^\/(?![\\/])[^\\\u0000-\u001f\u007f]*$/.test(callbackUrl) ? callbackUrl : '/community';

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/providers', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Provider list unavailable');
        return response.json();
      })
      .then(result => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(result?.providers)) throw new Error('Provider list unavailable');
        {
          setProviders(result.providers.filter((item: LoginProvider) =>
            (item?.id === 'google' || item?.id === 'oidc') && typeof item.name === 'string' && item.name.length <= 60));
          setProvidersStatus('loaded');
        }
      }).catch(() => {
        if (!controller.signal.aborted) setProvidersStatus('failed');
      });
    return () => controller.abort();
  }, []);

  async function oauthSignIn(provider: LoginProvider) {
    if (busy || !providers.some(item => item.id === provider.id)) return;
    setError('');
    setBusy(true);
    try {
      const response = await fetch(`/api/auth/oauth/${provider.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ callbackUrl: destination }),
      });
      const result = await response.json();
      if (!response.ok || typeof result.url !== 'string' || new URL(result.url).protocol !== 'https:') {
        throw new Error(result.message || 'Die Anmeldung konnte nicht gestartet werden.');
      }
      window.location.assign(result.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Die Anmeldung ist momentan nicht möglich.');
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    if (registering && password !== String(form.get('confirmPassword') ?? '')) {
      setError('Die Passwörter stimmen nicht überein.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(registering ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.get('name'), email: form.get('email'), password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Das hat nicht geklappt. Bitte versuche es erneut.');
      window.location.assign(destination);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Verbindung fehlgeschlagen. Bitte versuche es erneut.');
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
          <ForgeBrandMark /><span className="text-[15px] font-semibold tracking-tight">ForgeCommunity</span>
        </Link>
        <ThemeToggle />
      </header>
      <div className="mx-auto grid min-h-[calc(100vh-88px)] w-full max-w-6xl items-center gap-12 px-5 pb-12 pt-4 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20">
        <section className="max-w-xl py-4 lg:py-12">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-medium text-muted-foreground shadow-sm">
            <span className="h-2 w-2 rounded-full bg-[hsl(var(--coral))]" /> Ein Ort für gemeinsames Lernen und Machen
          </div>
          <h1 className="max-w-lg text-4xl font-semibold leading-[1.08] tracking-[-0.04em] sm:text-5xl">Gute Ideen werden besser, wenn man sie teilt.</h1>
          <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground">Tausche Wissen aus, entwickle Projekte weiter und finde Menschen, die gern gemeinsam etwas aufbauen.</p>
          <div className="mt-9 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm"><UsersRound className="mb-3 h-5 w-5 text-primary" /><p className="text-sm font-semibold">Lernen im Austausch</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Fragen stellen, Erfahrungen teilen, zusammen wachsen.</p></div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm"><Check className="mb-3 h-5 w-5 text-[hsl(var(--coral))]" /><p className="text-sm font-semibold">Fortschritt sichtbar machen</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Kurse, Projekte und kleine Erfolge an einem Ort.</p></div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-md lg:justify-self-end">
          <div className="rounded-[24px] border border-border bg-card p-6 shadow-[0_24px_80px_-42px_hsl(var(--foreground)/0.28)] sm:p-8">
            <div className="mb-7">
              <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-primary"><LockKeyhole className="h-5 w-5" /></div>
              <h2 className="text-2xl font-semibold tracking-tight">{registering ? 'Konto erstellen' : 'Willkommen zurück'}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{registering ? 'Registriere dich mit deiner E-Mail-Adresse.' : 'Melde dich an und mach dort weiter, wo du aufgehört hast.'}</p>
            </div>
            <form onSubmit={submit} className="space-y-4">
              {registering && <div className="space-y-2"><Label htmlFor="name">Dein Name</Label><Input id="name" name="name" autoComplete="name" maxLength={120} placeholder="Vor- und Nachname" required /></div>}
              <div className="space-y-2"><Label htmlFor="email">E-Mail-Adresse</Label><Input id="email" name="email" type="email" autoComplete="email" maxLength={254} placeholder="du@beispiel.de" required /></div>
              <div className="space-y-2"><Label htmlFor="password">Passwort</Label><Input id="password" name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} minLength={registering ? 12 : 1} maxLength={72} required />{registering && <p className="text-xs leading-5 text-muted-foreground">Mindestens 12 Zeichen, mit Groß- und Kleinbuchstaben, Zahl und Sonderzeichen.</p>}</div>
              {registering && <div className="space-y-2"><Label htmlFor="confirmPassword">Passwort wiederholen</Label><Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={72} required /></div>}
              {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-sm text-destructive">{error}</p>}
              <Button type="submit" size="lg" disabled={busy} className="mt-2 w-full">{busy ? 'Einen Moment …' : registering ? 'Kostenlos registrieren' : 'Anmelden'}<ArrowRight className="h-4 w-4" /></Button>
            </form>
            <div className="mt-5 space-y-3">
              <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />oder<span className="h-px flex-1 bg-border" /></div>
              <Button type="button" variant="outline" className="h-11 w-full" disabled={busy || !google} aria-busy={providersStatus === 'loading'} aria-describedby={!google ? 'google-login-status' : undefined} onClick={google ? () => void oauthSignIn(google) : undefined}>Mit Google anmelden</Button>
              {!google && <p id="google-login-status" role="status" className="text-center text-xs leading-5 text-muted-foreground">{providersStatus === 'loading' ? 'Verfügbarkeit wird geprüft …' : providersStatus === 'failed' ? 'Momentan nicht verfügbar' : 'Noch nicht eingerichtet'}</p>}
              {providers.filter(provider => provider.id !== 'google').map(provider => <Button key={provider.id} type="button" variant="outline" className="h-11 w-full" disabled={busy} onClick={() => oauthSignIn(provider)}>Mit {provider.name} anmelden</Button>)}
            </div>
            <p className="mt-6 text-center text-sm text-muted-foreground">{registering ? 'Schon ein Konto?' : 'Noch kein Konto?'}{' '}
              <Link href={registering ? '/login' : '/register'} className="font-semibold text-primary underline-offset-4 hover:underline">{registering ? 'Jetzt anmelden' : 'Jetzt registrieren'}</Link>
            </p>
          </div>
          <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">Mit der Registrierung gelten die Nutzungsregeln der ForgeCommunity.</p>
        </section>
      </div>
    </main>
  );
}
