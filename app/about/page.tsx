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
  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader><div className="flex min-w-0 items-center justify-between gap-3"><span className="min-w-0 truncate text-sm font-semibold">Über uns</span><div className="flex shrink-0 items-center gap-2"><ThemeToggle /><UserNav /></div></div></AppHeader>
        <main id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1100px] px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
            <section className="border-b pb-10 sm:pb-14">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">ForgeCommunity / Über uns</p>
              <h1 className="mt-4 max-w-[18ch] break-words text-[clamp(2rem,1.3rem+3vw,3.5rem)] font-semibold leading-tight tracking-[-0.04em] [overflow-wrap:anywhere]">Gemeinsam lernen und Ideen weiterbringen.</h1>
              <p className="mt-5 max-w-[65ch] text-base leading-relaxed text-muted-foreground sm:text-lg">ForgeCommunity verbindet Menschen, praktische Inhalte und Projekte an einem Ort.</p>
            </section>
            <section aria-labelledby="about-areas-title" className="py-10 sm:py-14">
              <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-end"><h2 id="about-areas-title" className="text-2xl font-semibold tracking-tight">Was hier zusammenkommt</h2><p className="max-w-[45ch] text-sm leading-relaxed text-muted-foreground sm:justify-self-end">Wähle den Bereich, der zu deinem nächsten Schritt passt.</p></div>
              <div className="mt-7 grid gap-x-8 md:grid-cols-3">{areas.map(area => <Link key={area.href} href={area.href} className="group grid min-h-36 min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-3 border-t py-5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><span className="pt-1 text-xs font-semibold tabular-nums text-muted-foreground">{area.number}</span><span className="min-w-0"><span className="flex items-center gap-2 break-words text-lg font-semibold tracking-tight group-hover:text-primary [overflow-wrap:anywhere]"><area.Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />{area.title}<ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" /></span><span className="mt-2 block text-sm leading-relaxed text-muted-foreground">{area.description}</span></span></Link>)}</div>
            </section>
            <section aria-labelledby="about-maker-title" className="grid gap-6 border-t py-10 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-10 sm:py-14">
              <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Der Entwickler</p><h2 id="about-maker-title" className="mt-3 text-2xl font-semibold tracking-tight">Hinter ForgeCommunity</h2><p className="mt-3 max-w-[48ch] text-sm leading-relaxed text-muted-foreground">Ein persönlicher Kontakt für das Projekt.</p></div>
              <div className="min-w-0 border-t pt-5 sm:border-t-0 sm:pt-0"><div className="flex min-w-0 items-center gap-4"><Avatar className="h-16 w-16 shrink-0"><AvatarFallback>PM</AvatarFallback></Avatar><div className="min-w-0"><h3 className="break-words text-lg font-semibold [overflow-wrap:anywhere]">{developer.name}</h3><p className="text-sm text-muted-foreground">{developer.role}</p></div></div><p className="mt-4 text-sm leading-relaxed text-muted-foreground">{developer.bio}</p><div className="mt-5 flex flex-wrap gap-2"><a href={developer.links.github} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-input px-3 text-sm font-semibold hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><Github className="h-4 w-4" aria-hidden="true" />GitHub<span className="sr-only">(öffnet in neuem Tab)</span></a><a href={developer.links.linkedin} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-input px-3 text-sm font-semibold hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><Linkedin className="h-4 w-4" aria-hidden="true" />LinkedIn<span className="sr-only">(öffnet in neuem Tab)</span></a><a href={developer.links.email} className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-input px-3 text-sm font-semibold hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><Mail className="h-4 w-4" aria-hidden="true" />E-Mail schreiben</a></div></div>
            </section>
          </div>
        </main>
      </div>
    </AppShell>
  );
}
