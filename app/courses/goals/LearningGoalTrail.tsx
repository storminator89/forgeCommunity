'use client';

import Link from 'next/link';
import { Check } from 'lucide-react';
import type { LearningGoalView } from './learning-goal-view';

/** A current projection, never a historical ledger or a success event player. */
export function LearningGoalTrail({ goal }: { goal: LearningGoalView }) {
  const date = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: goal.timezone });
  return <div className="mt-4 min-w-0">
    <p className="text-sm font-semibold">Deine Lernspur</p>
    <p className="mt-1 text-xs text-muted-foreground">Aktuell zählende Abschlüsse ({goal.timezone}).</p>
    <ol aria-label="Deine Lernspur" className="mt-3 grid min-w-0 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      {Array.from({ length: goal.targetLeaves }, (_, index) => {
        const completion = goal.creditedCompletions[index];
        return <li key={index} className="min-w-0 [overflow-wrap:anywhere]">
          <div aria-hidden="true" className="flex items-center gap-2">
            <span className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${completion ? 'border-success/40 bg-success/10 text-success' : 'border-border bg-muted text-muted-foreground'}`}>
              {completion ? <Check className="size-4" /> : index + 1}
            </span>
            <span className={`h-0 min-w-0 flex-1 border-t ${completion ? 'border-success/40' : 'border-dashed border-border'}`} />
          </div>
          <p className="mt-2 text-xs font-medium"><span className="sr-only">Schritt {index + 1}: </span>{completion ? 'Bestätigt' : 'Noch offen'}</p>
          {completion && <>
            <time dateTime={completion.completedAt} className="mt-1 block text-xs text-muted-foreground">{date.format(new Date(completion.completedAt))}</time>
            <p className="mt-1 line-clamp-2 text-xs" title={completion.courseTitle}>{completion.courseTitle}</p>
            <Link prefetch={false} href={`/courses/${encodeURIComponent(completion.courseId)}/contents`} aria-label={`Kurs öffnen: ${completion.courseTitle}`}
              className="inline-flex min-h-11 max-w-full items-center rounded-sm text-xs text-primary underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">Kurs öffnen</Link>
          </>}
        </li>;
      })}
    </ol>
  </div>;
}
