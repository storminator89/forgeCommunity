"use client";

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: editorial · macrostructure: product purpose and maker attribution · design-system: design.md · designed-as-app */

import Link from 'next/link';
import { ArrowUpRight, BookOpen, Briefcase, Github, Linkedin, Mail, MessageSquare } from 'lucide-react';
import { AppHeader, AppShell } from '@/components/app-shell';
import { Sidebar } from '@/components/Sidebar';
import { UserNav } from '@/components/user-nav';
import { ThemeToggle } from '@/components/theme-toggle';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ForgeBrandMark } from '@/components/forge-brand-mark';
import { useSession } from 'next-auth/react';

const developer = {
  name: 'Patrick Meyhöfer',
  role: 'Full Stack Developer',
  bio: 'Entwickler von ForgeCommunity.',
  links: {
    github: 'https://github.com/patrickmeyhoefer',
    linkedin: 'https://linkedin.com/in/patrickmeyhoefer',
    email: 'mailto:contact@patrickmeyhoefer.com',
  },
};

const areas = [
  { number: '01', title: 'Austausch', description: 'Fragen stellen und Erfahrungen mit anderen Mitgliedern teilen.', href: '/community', Icon: MessageSquare },
  { number: '02', title: 'Wissen', description: 'Kurse und Anleitungen für das eigene Vorhaben nutzen.', href: '/knowledgebase', Icon: BookOpen },
  { number: '03', title: 'Projekte', description: 'Arbeiten vorstellen und Rückmeldungen aus der Community erhalten.', href: '/showcases', Icon: Briefcase },
];

export default function About() {
  const { data: session } = useSession();

  return (
    <AppShell data-page-family="about">
      {session && <Sidebar />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {session ? <AppHeader><div className="app-header-row"><span className="app-header-title text-sm font-semibold">Über uns</span><div className="app-header-actions"><ThemeToggle /><UserNav /></div></div></AppHeader> : <header className="border-b bg-card px-4 py-3 sm:px-6"><div className="mx-auto flex w-full max-w-[1100px] flex-wrap items-center justify-between gap-3"><Link href="/" aria-label="ForgeCommunity Startseite" className="flex min-h-11 items-center gap-2.5 rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"><ForgeBrandMark /><span className="text-sm font-semibold">ForgeCommunity</span></Link><div className="flex items-center gap-2"><ThemeToggle /><Button asChild variant="outline" size="sm"><Link href="/login?callbackUrl=%2Fabout">Anmelden</Link></Button></div></div></header>}
        <main id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1100px] px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
            <section className="fc-detail-header">

              <h1 className="mt-4 max-w-[18ch] break-words text-[clamp(2rem,1.3rem+3vw,3.5rem)] font-semibold leading-tight tracking-[-0.04em] [overflow-wrap:anywhere]">Gemeinsam lernen und Ideen weiterbringen.</h1>
              <p className="mt-5 max-w-[65ch] text-base leading-relaxed text-muted-foreground sm:text-lg">ForgeCommunity verbindet Menschen, praktische Inhalte und Projekte an einem Ort.</p>
            </section>
            <section aria-labelledby="about-areas-title" className="py-10 sm:py-14">
              <div><h2 id="about-areas-title" className="text-2xl font-semibold tracking-tight">Was hier zusammenkommt</h2></div>
              <div className="mt-7 grid gap-5 md:grid-cols-3">{areas.map(area => <Link key={area.href} href={area.href} className="fc-section-card group grid min-h-36 min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-3 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><span className="pt-1 text-xs font-semibold tabular-nums text-muted-foreground">{area.number}</span><span className="min-w-0"><span className="flex items-center gap-2 break-words text-lg font-semibold tracking-tight group-hover:text-primary [overflow-wrap:anywhere]"><area.Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />{area.title}<ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" /></span><span className="mt-2 block text-sm leading-relaxed text-muted-foreground">{area.description}</span></span></Link>)}</div>
            </section>
            <section aria-labelledby="about-maker-title" className="fc-section-card grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-10 sm:py-14">
              <div><h2 id="about-maker-title" className="mt-3 text-2xl font-semibold tracking-tight">Hinter ForgeCommunity</h2></div>
              <div className="min-w-0 border-t pt-5 sm:border-t-0 sm:pt-0"><div className="flex min-w-0 items-center gap-4"><Avatar className="h-16 w-16 shrink-0"><AvatarFallback>PM</AvatarFallback></Avatar><div className="min-w-0"><h3 className="break-words text-lg font-semibold [overflow-wrap:anywhere]">{developer.name}</h3><p className="text-sm text-muted-foreground">{developer.role}</p></div></div><p className="mt-4 text-sm leading-relaxed text-muted-foreground">{developer.bio}</p><div className="mt-5 flex flex-wrap gap-2"><a href={developer.links.github} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-input px-3 text-sm font-semibold hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><Github className="h-4 w-4" aria-hidden="true" />GitHub<span className="sr-only">(öffnet in neuem Tab)</span></a><a href={developer.links.linkedin} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-input px-3 text-sm font-semibold hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><Linkedin className="h-4 w-4" aria-hidden="true" />LinkedIn<span className="sr-only">(öffnet in neuem Tab)</span></a><a href={developer.links.email} className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-input px-3 text-sm font-semibold hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><Mail className="h-4 w-4" aria-hidden="true" />E-Mail schreiben</a></div></div>
            </section>
          </div>
        </main>
      </div>
    </AppShell>
  );
}
