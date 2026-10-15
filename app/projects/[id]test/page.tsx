"use client";

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: utilitarian · macrostructure: legacy route handoff · design-system: design.md · designed-as-app */

import { useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export default function LegacyProjectDetail() {
  const { id } = useParams<{ id?: string }>();
  const router = useRouter();
  const destination = id ? `/projects/${encodeURIComponent(id)}` : '/showcases';

  useEffect(() => { router.replace(destination); }, [destination, router]);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a href="#page-content" className="skip-link">Zum Inhalt springen</a>
      <main id="page-content" tabIndex={-1} className="mx-auto flex min-h-dvh w-full max-w-xl items-center px-4 py-12 sm:px-6">
        <div className="w-full border-t pt-7">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Projekte / Weiterleitung</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Projekt wird geöffnet</h1>
          <p role="status" className="mt-3 text-sm leading-relaxed text-muted-foreground">Du wirst zur {id ? 'Projektseite' : 'Projektübersicht'} weitergeleitet.</p>
          <Button asChild variant="outline" className="mt-6"><Link href={destination}>Jetzt öffnen</Link></Button>
        </div>
      </main>
    </div>
  );
}
