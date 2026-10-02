'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowRight, BookOpen, Briefcase, Calendar, Flame, GraduationCap, MessageSquare, Users, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';

const areas = [
  { label: 'Austauschen', title: 'Deine Perspektive zählt.', description: 'Stelle Fragen, teile Erfahrungen und finde Menschen, die mit dir weiterdenken.', href: '/community', icon: MessageSquare },
  { label: 'Lernen', title: 'Wissen bringt dich weiter.', description: 'Entdecke Kurse, praktische Anleitungen und Ressourcen aus der Community.', href: '/courses', icon: GraduationCap },
  { label: 'Gestalten', title: 'Mach deine Ideen sichtbar.', description: 'Zeige deine Projekte, sammle Feedback und inspiriere andere mit deiner Arbeit.', href: '/showcases', icon: Briefcase },
];

export default function Home() {
  const { data: session } = useSession();
  const destination = session ? '/community' : '/register';
  return (
    <div className="min-h-dvh bg-background">
      <a href="#page-content" className="skip-link">Zum Inhalt springen</a>
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-3 px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label="ForgeCommunity Startseite">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Flame className="h-5 w-5" /></span>
            <span className="text-base font-bold tracking-tight">Forge<span className="font-normal text-muted-foreground">Community</span></span>
          </Link>
          <nav aria-label="Startseite" className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#moeglichkeiten" className="hover:text-foreground">Möglichkeiten</a>
            <a href="#entdecken" className="hover:text-foreground">Entdecken</a>
            <Link href="/about" className="hover:text-foreground">Über uns</Link>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild variant="outline" className="hidden sm:inline-flex"><Link href={session ? '/community' : '/login'}>{session ? 'Zur Community' : 'Anmelden'}</Link></Button>
            <Button asChild className="sm:hidden"><Link href={session ? '/community' : '/login'}>{session ? 'Öffnen' : 'Anmelden'}</Link></Button>
          </div>
        </div>
      </header>
      <main id="page-content" tabIndex={-1}>
        <section className="mx-auto grid max-w-7xl items-center gap-12 px-5 pb-20 pt-16 sm:px-8 sm:pt-24 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:pb-28">
          <div>
            <p className="mb-6 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-primary" />Ein Ort für Wissen, Austausch und Zusammenarbeit</p>
            <h1 className="max-w-2xl text-[clamp(2.75rem,5.2vw,4.75rem)] font-semibold leading-[1.07] tracking-[-0.045em]">Gute Ideen wachsen <span className="text-primary">gemeinsam.</span></h1>
            <p className="mt-6 max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg">Lerne Neues. Teile, was du kannst. Und finde Menschen, mit denen aus einer Idee etwas wird.</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg"><Link href={destination}>{session ? 'Community entdecken' : 'Teil der Community werden'}<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
              <Button asChild variant="ghost"><a href="#moeglichkeiten">Mehr erfahren</a></Button>
            </div>
            <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground"><Check className="h-4 w-4 text-primary" />Wissen teilen. Gemeinsam weiterkommen.</p>
          </div>
          <div className="relative rounded-[1.5rem] border bg-accent/40 p-4 sm:p-6">
            <div className="rounded-2xl border bg-card shadow-xl shadow-foreground/5">
              <div className="flex items-center justify-between border-b px-5 py-4"><div className="flex items-center gap-2"><Flame className="h-4 w-4 text-primary" /><span className="text-sm font-semibold">Dein nächster Impuls</span></div><span className="rounded-full bg-accent px-2 py-1 text-[10px] font-medium text-primary">Entdecken</span></div>
              <div className="p-5 sm:p-6">
                <p className="text-xs font-medium text-muted-foreground">Vieles beginnt mit einer Frage.</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">Was möchtest du heute bewegen?</h2>
                <div className="mt-6 space-y-3">
                  {[
                    { icon: MessageSquare, title: 'Ins Gespräch kommen', text: 'Erfahrungen teilen und neue Perspektiven entdecken', href: '/community' },
                    { icon: BookOpen, title: 'Eine Antwort finden', text: 'Wissen aus der Community für deinen nächsten Schritt', href: '/knowledgebase' },
                    { icon: Briefcase, title: 'Ein Projekt zeigen', text: 'Ideen vorstellen und gemeinsam weiterentwickeln', href: '/showcases' },
                  ].map(item => <Link key={item.title} href={session ? item.href : '/login'} className="group flex items-center gap-3 rounded-xl border p-3.5 transition-colors hover:border-primary/30 hover:bg-accent/40"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary"><item.icon className="h-5 w-5" /></span><div className="min-w-0"><p className="text-sm font-semibold">{item.title}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.text}</p></div><ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" /></Link>)}
                </div>
              </div>
              <div className="flex items-center gap-2 border-t px-5 py-4 text-xs text-muted-foreground"><Users className="h-4 w-4 text-primary" />Dein Wissen kann für andere den Unterschied machen.</div>
            </div>
          </div>
        </section>
        <section id="moeglichkeiten" className="scroll-mt-24 border-y bg-card">
          <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20">
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">Mehr als ein Austausch</p>
            <h2 className="mt-3 max-w-xl text-3xl font-semibold tracking-tight sm:text-4xl">Ein gemeinsamer Ort.<br />Viele Wege, weiterzukommen.</h2>
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              {areas.map((area, i) => <Link key={area.title} href={session ? area.href : '/login'} className="group rounded-2xl border bg-background p-6 transition-colors hover:border-primary/40 sm:p-8"><div className="flex items-center justify-between"><area.icon className="h-6 w-6 text-primary" /><span className="text-xs font-medium text-muted-foreground">0{i + 1}</span></div><p className="mt-8 text-xs font-medium uppercase tracking-wider text-muted-foreground">{area.label}</p><h3 className="mt-2 text-xl font-semibold tracking-tight">{area.title}</h3><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{area.description}</p><span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary">Entdecken <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></span></Link>)}
            </div>
          </div>
        </section>
        <section id="entdecken" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-16 sm:px-8 sm:py-20">
          <div className="grid items-center gap-10 md:grid-cols-2">
            <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">Dein nächster Schritt</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">Neugierig bleiben.<br />Verbindungen schaffen.</h2><p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">Von der ersten Frage bis zum gemeinsamen Projekt: ForgeCommunity bringt Menschen und Wissen zusammen.</p><Button asChild className="mt-6"><Link href={destination}>Jetzt starten <ArrowRight className="ml-2 h-4 w-4" /></Link></Button></div>
            <div className="grid grid-cols-2 gap-3">{[
              { icon: Users, name: 'Mitglieder', text: 'Menschen kennenlernen', href: '/members' },
              { icon: Calendar, name: 'Events', text: 'Gemeinsam erleben', href: '/events' },
              { icon: GraduationCap, name: 'Kurse', text: 'Neues lernen', href: '/courses' },
              { icon: BookOpen, name: 'Wissen', text: 'Antworten entdecken', href: '/knowledgebase' },
            ].map(item => <Link key={item.name} href={session ? item.href : '/login'} className="rounded-2xl border bg-card p-5 transition-colors hover:border-primary/40"><item.icon className="h-5 w-5 text-primary" /><h3 className="mt-4 break-words text-sm font-semibold">{item.name}</h3><p className="mt-1 text-xs text-muted-foreground">{item.text}</p></Link>)}</div>
          </div>
        </section>
      </main>
      <footer className="border-t bg-card"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-3 px-5 py-7 text-xs text-muted-foreground sm:flex-row sm:px-8"><span>ForgeCommunity · Gemeinsam weiterkommen.</span><div className="flex gap-5"><Link href="/about" className="hover:text-foreground">Über uns</Link><Link href={session ? '/community' : '/login'} className="hover:text-foreground">{session ? 'Zur Community' : 'Anmelden'}</Link></div></div></footer>
    </div>
  );
}
