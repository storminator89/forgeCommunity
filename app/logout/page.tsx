"use client";

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: utilitarian · macrostructure: account-exit status · design-system: design.md · designed-as-app */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { ArrowLeft, Loader2, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';

export default function LogoutPage() {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState(false);
  const performLogout = useCallback(() => signOut({ redirect: false }).then(() => {
    router.replace('/');
    router.refresh();
  }).catch(() => { setError(true); }), [router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void performLogout();
  }, [performLogout]);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a href="#page-content" className="skip-link">Zum Inhalt springen</a>
      <header className="border-b"><div className="mx-auto flex min-h-20 max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8"><Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-[10px] text-sm font-semibold focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><ArrowLeft className="h-4 w-4" aria-hidden="true" />ForgeCommunity</Link><ThemeToggle /></div></header>
      <main id="page-content" tabIndex={-1} className="mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-[1200px] items-center px-4 py-12 sm:px-6 lg:px-8">
        <div className="fc-auth-card w-full max-w-xl">
          <span className="flex h-12 w-12 items-center justify-center rounded-[10px] bg-accent text-primary"><LogOut className="h-5 w-5" aria-hidden="true" /></span>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Konto / Sitzung</p>
          <h1 className="mt-2 text-[clamp(2rem,1.3rem+2vw,3rem)] font-semibold tracking-tight">Abmelden</h1>
          <p className="mt-3 max-w-[52ch] text-base leading-relaxed text-muted-foreground">{error ? 'Die Abmeldung konnte nicht abgeschlossen werden. Deine Sitzung könnte noch aktiv sein.' : 'Du wirst abgemeldet und zur Startseite weitergeleitet.'}</p>
          {error ? <div className="mt-7 space-y-4"><p role="alert" className="rounded-[10px] border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">Bitte versuche die Abmeldung erneut.</p><div className="flex flex-wrap gap-3"><Button type="button" onClick={() => { setError(false); void performLogout(); }}>Abmeldung erneut versuchen</Button><Button asChild variant="outline"><Link href="/community">Zur Community</Link></Button></div></div> : <p role="status" className="mt-7 inline-flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Abmeldung läuft…</p>}
        </div>
      </main>
    </div>
  );
}
