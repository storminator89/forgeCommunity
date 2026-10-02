'use client';

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
      <header className="border-b bg-background">
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-3 px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label="ForgeCommunity Startseite">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Flame className="h-5 w-5" aria-hidden="true" /></span>
            <span className="text-base font-bold tracking-tight">Forge<span className="font-normal text-muted-foreground">Community</span></span>
          </Link>
          <nav aria-label="Startseite" className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#bereiche" className="hover:text-foreground">Bereiche</a>
            <Link href="/about" className="hover:text-foreground">Über uns</Link>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild variant="outline"><Link href={session ? '/community' : '/login'}>{session ? 'Community' : 'Anmelden'}</Link></Button>
          </div>
        </div>
      </header>
      <main id="page-content" tabIndex={-1}>
        <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <h1 className="max-w-3xl text-[clamp(2.5rem,5.5vw,4.5rem)] font-semibold leading-[1.1] tracking-[-0.045em]">Wissen teilen.<br /><span className="text-primary">Projekte weiterbringen.</span></h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">Kurse, praktische Anleitungen und Projekte aus der Community.</p>
          <Button asChild size="lg" className="mt-8"><Link href={session ? '/community' : '/register'}>{session ? 'Zur Community' : 'Konto erstellen'}<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Link></Button>
        </section>
        <section id="bereiche" className="mx-auto max-w-6xl scroll-mt-8 px-5 pb-16 sm:px-8 sm:pb-24">
          <h2 className="mb-6 text-xl font-semibold tracking-tight">Bereiche</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {areas.map(area => (
              <Link key={area.href} href={session ? area.href : `/login?callbackUrl=${encodeURIComponent(area.href)}`} className="group rounded-xl border bg-card p-6 transition-colors hover:border-primary/40 hover:bg-accent/30">
                <div className="flex items-center justify-between"><area.icon className="h-5 w-5 text-primary" aria-hidden="true" /><ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" aria-hidden="true" /></div>
                <h3 className="mt-5 text-base font-semibold">{area.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{area.description}</p>
              </Link>
            ))}
          </div>
        </section>
      </main>
      <footer className="border-t"><div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-7 text-xs text-muted-foreground sm:px-8"><span>ForgeCommunity</span><Link href="/about" className="hover:text-foreground">Über uns</Link></div></footer>
    </div>
  );
}
