'use client';

import Link from 'next/link';
import type { Ref } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { missionUrl } from './mission-api';
import { missionQuestNextStep, type MissionQuestSnapshot } from './mission-quest-projection';
import styles from './friendly-missions.module.css';

/** One existing mission row, with two separate contribution goals, never a score. */
export function MissionQuestLine({ snapshot, title, actionRef }: { snapshot: MissionQuestSnapshot; title: string; actionRef?: Ref<HTMLAnchorElement> }) {
  if (snapshot.status !== 'ready') return <p role="status" className="mt-3 text-xs leading-relaxed text-muted-foreground">
    {snapshot.status === 'loading' ? 'Gemeinsamer Stand wird geprüft…' : 'Gemeinsamer Stand unbekannt. Prüfe ihn über „Übersicht aktualisieren“ erneut.'}
  </p>;

  const { progress, candidate } = snapshot;
  const next = missionQuestNextStep(progress.action);
  const authors = Math.min(progress.insightAuthors, 2);
  const buildOn = progress.hasCrossPersonBuildOn ? 1 : 0;
  return <div className="mt-4 border-t pt-3">
    <p className="text-xs font-medium text-muted-foreground">Euer gemeinsames Ziel · Aktuell sichtbar</p>
    <div role="group" aria-label="Zwei gemeinsame Teilziele" className="mt-2 grid gap-3 sm:grid-cols-2">
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-sm"><span>Personen mit Erkenntnis</span><span className="font-semibold tabular-nums">{authors}/2</span></p>
        <progress max={2} value={authors} aria-label="Verschiedene Erkenntnisautorinnen und Erkenntnisautoren" aria-valuetext={`${progress.insightAuthors} verschiedene Personen; Ziel mindestens zwei`} className="mt-1 block h-2 w-full accent-primary" />
      </div>
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-sm"><span>Gemeinsamer Aufbau</span><span className="font-semibold tabular-nums">{buildOn}/1</span></p>
        <progress max={1} value={buildOn} aria-label="Personenübergreifender Aufbau auf einer Erkenntnis" aria-valuetext={buildOn ? 'Ein gültiger personenübergreifender Aufbau vorhanden; Ziel erreicht' : 'Noch kein gültiger personenübergreifender Aufbau; Ziel ein Aufbau'} className="mt-1 block h-2 w-full accent-primary" />
      </div>
    </div>
    <p role="status" className="mt-3 text-sm leading-relaxed">{next.text}</p>
    <Button asChild className="mt-3 min-h-11 max-w-full whitespace-normal text-left">
      <Link ref={actionRef} prefetch={false} href={missionUrl(candidate.spaceId, candidate.id)} aria-label={`${next.label}: ${title}`}>{next.label}<ArrowUpRight size={16} className="shrink-0" aria-hidden="true" /></Link>
    </Button>
    <details className={`${styles.disclosure} mt-1`}>
      <summary>Zu diesem gemeinsamen Ziel</summary>
      <p>Die erste Mission mit deiner aktiven Teilnahme auf der ersten geladenen Seite dieser Ansicht.</p>
      <p>Gezählt werden aktuell sichtbare Beiträge aktiver Teilnehmender, auch nach der Lernwoche. Der Stand kann sinken. Die Zähler zeigen höchstens das jeweilige Ziel.</p>
      <p>Kein Wissensnachweis. Kein Einfluss auf deinen Kursfortschritt. Lesen wird nicht erfasst.</p>
    </details>
  </div>;
}
