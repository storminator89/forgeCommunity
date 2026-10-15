'use client';

/* Hallmark · component: learning-path controls · genre: utilitarian · theme: Forge
 * Local states: default · hover · focus · active · disabled · loading.
 * Save error/success feedback is owned by the surrounding author workspace.
 */

import type { CourseContent } from './types';
import { getCoursePathEntries } from './CoursePathOverview';

export function CoursePrerequisitesEditor({ contents, selected, busy, onChange }: {
  contents: CourseContent[];
  selected: CourseContent;
  busy: boolean;
  onChange: (prerequisiteIds: string[]) => Promise<void>;
}) {
  const entries = getCoursePathEntries(contents);
  const position = entries.findIndex(entry => entry.content.id === selected.id);
  if (position < 0 || !entries[position].isLeaf) return null;
  const options = entries.slice(0, position).filter(entry => entry.isLeaf);
  const chosen = selected.prerequisiteIds ?? [];
  return <section className="mt-6 border-t pt-6" aria-labelledby="course-prerequisites-heading" aria-busy={busy}>
    <h3 id="course-prerequisites-heading" className="text-lg font-semibold">Lernvoraussetzungen</h3>
    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Wähle bis zu 20 frühere Inhalte, die Lernende zuerst abschließen müssen. Änderungen bleiben bis zur Veröffentlichung im Entwurf.</p>
    {!options.length ? <p className="mt-4 text-sm text-muted-foreground">Für diesen ersten Inhalt gibt es noch keine früheren Inhalte.</p> :
      <fieldset disabled={busy} className="mt-4 space-y-1">
        <legend className="sr-only">Erforderliche frühere Inhalte für {selected.title}</legend>
        {options.map(option => <label key={option.content.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-transparent px-2 py-2 text-sm hover:bg-accent/60 focus-within:border-ring active:bg-accent/80 has-[:disabled]:cursor-wait has-[:disabled]:opacity-60">
          <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" checked={chosen.includes(option.content.id)} disabled={chosen.length >= 20 && !chosen.includes(option.content.id)}
            onChange={event => { const ids = event.target.checked ? [...chosen, option.content.id] : chosen.filter(id => id !== option.content.id); void onChange(ids); }} />
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{option.path} · {option.content.title}</span>
        </label>)}
      </fieldset>}
    <p role="status" aria-live="polite" className="mt-3 text-sm text-muted-foreground">{busy ? 'Voraussetzungen werden gespeichert …' : chosen.length ? `${chosen.length} ${chosen.length === 1 ? 'Voraussetzung' : 'Voraussetzungen'} im Entwurf` : 'Ohne Voraussetzung zugänglich'}</p>
  </section>;
}
