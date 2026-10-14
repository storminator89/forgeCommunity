'use client';

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: editorial · macrostructure: public introduction · design-system: design.md · designed-as-app */

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowRight, BookOpen, Briefcase, Calendar, Flame, GraduationCap, MessageSquare, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';

const areas = [
  { title: 'Community', description: 'Fragen stellen und Erfahrungen austauschen.', href: '/community', icon: MessageSquare },
  { title: 'Kurse', description: 'Neue Fähigkeiten Schritt für Schritt lernen.', href: '/courses', icon: GraduationCap },
  { title: 'Wissensdatenbank', description: 'Anleitungen und Antworten nachschlagen.', href: '/knowledgebase', icon: BookOpen },
  { title: 'Projekte', description: 'Arbeiten vorstellen und Feedback erhalten.', href: '/showcases', icon: Briefcase },
  { title: 'Mitglieder', description: 'Menschen mit passenden Interessen finden.', href: '/members', icon: Users },
  { title: 'Events', description: 'Termine entdecken und teilnehmen.', href: '/events', icon: Calendar },
];

export default function Home() {
  const { data: session } = useSession();

  return (
    <div className="min-h-dvh bg-background">
      <a href="#page-content" className="skip-link">Zum Inhalt springen</a>
      <header className="border-b bg-card">
        <div className="mx-auto flex min-h-20 max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex min-w-0 items-center gap-2.5" aria-label="ForgeCommunity Startseite">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground"><Flame className="h-5 w-5" aria-hidden="true" /></span>
            <span className="whitespace-nowrap text-base font-bold tracking-tight">Forge<span className="hidden font-normal text-muted-foreground sm:inline">Community</span></span>
          </Link>
          <nav aria-label="Startseite" className="hidden items-center gap-8 text-sm font-medium text-muted-foreground lg:flex">
            <a href="#bereiche" className="hover:text-foreground">Bereiche</a>
            <Link href="/about" className="hover:text-foreground">Über uns</Link>
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <Button asChild variant="outline"><Link href={session ? '/community' : '/login'}>{session ? 'Community' : 'Anmelden'}</Link></Button>
          </div>
        </div>
      </header>

      <main id="page-content" tabIndex={-1}>
        <section className="border-b">
          <div className="mx-auto grid max-w-[1440px] gap-12 px-4 pb-16 pt-16 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,1.45fr)_minmax(17rem,0.55fr)] lg:items-end lg:gap-20 lg:px-8 lg:py-28">
            <div className="min-w-0">
              <p className="mb-5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">ForgeCommunity</p>
              <h1 className="max-w-[12ch] text-[clamp(2.65rem,1.65rem+4.2vw,5.5rem)] font-semibold leading-[1.05] tracking-[-0.055em]">
                Wissen teilen. <span className="text-primary">Projekte weiterbringen.</span>
              </h1>
              <p className="mt-7 max-w-[56ch] text-base leading-relaxed text-muted-foreground sm:text-lg">Kurse, praktische Anleitungen und Projekte aus der Community.</p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Button asChild size="lg"><Link href={session ? '/community' : '/register'}>{session ? 'Zur Community' : 'Konto erstellen'}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
                <a href="#bereiche" className="inline-flex min-h-11 items-center whitespace-nowrap text-sm font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-primary">Bereiche ansehen</a>
              </div>
            </div>
            <aside className="max-w-md border-t pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0" aria-label="Was du hier tun kannst">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Gemeinsam weiterkommen</p>
              <p className="mt-4 text-[clamp(1.25rem,1.05rem+0.8vw,1.6rem)] font-medium leading-snug tracking-tight">Ein Ort zum Fragen, Lernen und Zeigen, woran du arbeitest.</p>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">Finde Menschen, Inhalte und Veranstaltungen, die zu deinem Vorhaben passen.</p>
            </aside>
          </div>
        </section>

        <section id="bereiche" className="scroll-mt-8">
          <div className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
            <div className="mb-10 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-end">
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">01 / Orientierung</p>
                <h2 className="text-[clamp(1.8rem,1.25rem+2vw,2.75rem)] font-semibold tracking-[-0.035em]">Was dich erwartet</h2>
              </div>
              <p className="max-w-[45ch] text-sm leading-relaxed text-muted-foreground sm:justify-self-end">Wähle den Bereich, der dich gerade weiterbringt.</p>
            </div>
            <div className="grid gap-x-10 sm:grid-cols-2">
              {areas.map((area, index) => (
                <Link key={area.href} href={session ? area.href : `/login?callbackUrl=${encodeURIComponent(area.href)}`} className="group grid min-h-28 grid-cols-[2rem_minmax(0,1fr)_1.25rem] items-start gap-3 border-t py-5 hover:border-primary focus-visible:outline-offset-[-2px]">
                  <span className="pt-1 text-xs font-semibold tabular-nums text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 whitespace-nowrap text-lg font-semibold tracking-tight group-hover:text-primary"><area.icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />{area.title}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{area.description}</span>
                  </span>
                  <ArrowRight className="mt-1 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t bg-card">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-4 py-7 text-sm text-muted-foreground sm:px-6 lg:px-8">
          <span>ForgeCommunity</span>
          <Link href="/about" className="whitespace-nowrap hover:text-foreground">Über uns</Link>
        </div>
      </footer>
    </div>
  );
}
