'use client';

/* Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V4 */
/* Hallmark · genre: editorial · macrostructure: administration ledger · design-system: design.md · designed-as-app */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { ArrowDown, ArrowUp, Check, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageState } from '@/components/page-state';
import type { AdminPathway } from '@/app/courses/pathways/pathway-types';

type CandidateCourse = {
  id: string;
  title: string;
  rewardEligible: boolean;
  price: number | null;
};

export default function LearningPathwaysAdmin() {
  const { data: session, status } = useSession();
  if (status === 'loading') return <PageState kind="loading" title="Berechtigung wird geprüft" />;
  if (status !== 'authenticated' || session?.user?.role !== 'ADMIN' || !session.user.id) {
    return <PageState kind="error" title="Keine Berechtigung" description="Nur Administratoren können Lernpfade erstellen." />;
  }
  return <ScopedAdmin key={session.user.id} />;
}

function ScopedAdmin() {
  const [pathways, setPathways] = useState<AdminPathway[] | null>(null);
  const [candidates, setCandidates] = useState<CandidateCourse[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [badgeLabel, setBadgeLabel] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);
  const sequence = useRef(0);
  const mutationInFlight = useRef(false);
  const createReceipt = useRef<{ payload: string; requestId: string } | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void load(controller.signal);
    return () => { mounted.current = false; controller.abort(); };
  }, []);

  async function load(signal?: AbortSignal) {
    const current = ++sequence.current;
    setError('');
    try {
      const [pathwaysResponse, coursesResponse] = await Promise.all([
        fetch('/api/admin/learning-pathways', { cache: 'no-store', signal }),
        fetch('/api/courses', { cache: 'no-store', signal }),
      ]);
      if (!pathwaysResponse.ok || !coursesResponse.ok) throw new Error();
      const [{ pathways: loaded }, courses] = await Promise.all([
        pathwaysResponse.json() as Promise<{ pathways: AdminPathway[] }>,
        coursesResponse.json() as Promise<CandidateCourse[]>,
      ]);
      if (!mounted.current || signal?.aborted || current !== sequence.current) return;
      setPathways(loaded);
      setCandidates(courses.filter(course => course.rewardEligible && (course.price === null || course.price <= 0))
        .sort((a, b) => a.title.localeCompare(b.title, 'de')));
      // A changed approval must not leave an invisible or ineligible ID in the draft.
      const eligible = new Set(courses.filter(course => course.rewardEligible && (course.price === null || course.price <= 0)).map(course => course.id));
      setSelectedIds(ids => ids.filter(id => eligible.has(id)));
    } catch {
      if (mounted.current && !signal?.aborted && current === sequence.current) setError('Lernpfade und verfügbare Kurse konnten nicht geladen werden.');
    }
  }

  function toggleCourse(id: string) {
    setSelectedIds(current => current.includes(id) ? current.filter(value => value !== id)
      : current.length < 4 ? [...current, id] : current);
  }

  function moveCourse(id: string, delta: number) {
    setSelectedIds(current => {
      const oldIndex = current.indexOf(id);
      const nextIndex = oldIndex + delta;
      if (oldIndex < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[oldIndex], next[nextIndex]] = [next[nextIndex], next[oldIndex]];
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationInFlight.current) return;
    if (selectedIds.length < 2 || selectedIds.length > 4) {
      setError('Wähle zwei bis vier Kurse für den Lernpfad.');
      return;
    }
    mutationInFlight.current = true;
    ++sequence.current;
    setPending(true);
    setError('');
    setNotice('');
    try {
      const definition = { title: title.trim(), description: description.trim(), badgeLabel: badgeLabel.trim(), courseIds: selectedIds };
      const payload = JSON.stringify(definition);
      if (createReceipt.current?.payload !== payload) createReceipt.current = { payload, requestId: crypto.randomUUID() };
      const response = await fetch('/api/admin/learning-pathways', {
        method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...definition, requestId: createReceipt.current.requestId }),
      });
      const result = await response.json().catch(() => null) as { pathway?: AdminPathway; error?: string } | null;
      if (!response.ok || !result?.pathway) throw new Error(result?.error || 'Der Lernpfad konnte nicht erstellt werden.');
      if (!mounted.current) return;
      setPathways(current => [result.pathway!, ...(current ?? []).filter(row => row.id !== result.pathway!.id)]);
      createReceipt.current = null;
      setTitle(''); setDescription(''); setBadgeLabel(''); setSelectedIds([]);
      setNotice(`„${result.pathway.title}“ wurde erstellt.`);
      window.requestAnimationFrame(() => { if (mounted.current) titleRef.current?.focus(); });
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : 'Der Lernpfad konnte nicht erstellt werden.');
      }
    } finally {
      mutationInFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return <div className="min-w-0 space-y-8">
    <header className="flex min-w-0 flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between"><div className="min-w-0 max-w-[68ch]"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Kursverwaltung</p><h1 className="mt-2 break-words text-[clamp(1.65rem,1.1rem+2vw,2.35rem)] font-semibold tracking-tight">Lernpfade verwalten</h1><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Verbinde zwei bis vier kostenlose, veröffentlichte und für Belohnungen freigegebene Kurse. Teilnahme, Fortschritt und Pfad-Abzeichen sind ausschließlich privat.</p></div><Button type="button" variant="outline" onClick={() => void load()} disabled={pending} className="self-start whitespace-nowrap sm:self-auto"><RefreshCw className="h-4 w-4" aria-hidden="true" />Aktualisieren</Button></header>
    {notice && <p role="status" aria-live="polite" className="rounded-xl border bg-card px-4 py-3 text-sm font-medium">{notice}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {pathways === null && !error && <PageState kind="loading" title="Lernpfade werden geladen" />}
    {pathways !== null && <div className="grid min-w-0 gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
      <section aria-labelledby="create-pathway-title" className="min-w-0"><div className="border-b pb-4"><h2 id="create-pathway-title" className="text-xl font-semibold">Neuen Lernpfad erstellen</h2><p className="mt-1 text-sm text-muted-foreground">Der Server prüft Kursfreigabe und Veröffentlichung beim Speichern erneut.</p></div>
        <form onSubmit={submit} className="mt-6 space-y-6">
          <div><label htmlFor="pathway-title" className="mb-1.5 block text-sm font-medium">Titel</label><Input ref={titleRef} id="pathway-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={120} required placeholder="Zum Beispiel: Grundlagen der Zusammenarbeit" /></div>
          <div><label htmlFor="pathway-description" className="mb-1.5 block text-sm font-medium">Beschreibung</label><Textarea id="pathway-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={500} required rows={3} placeholder="Was lernen Mitglieder auf diesem Weg?" /></div>
          <div><label htmlFor="pathway-badge" className="mb-1.5 block text-sm font-medium">Name des privaten Abzeichens</label><Input id="pathway-badge" value={badgeLabel} onChange={event => setBadgeLabel(event.target.value)} maxLength={80} required placeholder="Zum Beispiel: Zusammenarbeit vertieft" /><p className="mt-1 text-xs text-muted-foreground">Keine Zertifikats- oder Qualifikationszusage formulieren.</p></div>
          <fieldset className="min-w-0"><legend className="text-sm font-semibold">Kurse wählen und ordnen</legend><p className="mt-1 text-sm text-muted-foreground">Wähle zwei bis vier Kurse. Die Reihenfolge ist eine Empfehlung; bereits bestätigte Abschlüsse zählen mit.</p>
            {candidates.length === 0 ? <p className="mt-4 rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">Zurzeit sind keine veröffentlichten, kostenlosen und freigegebenen Kurse verfügbar.</p>
              : <div className="mt-4 divide-y border-y">{candidates.map(course => {
                const selectedIndex = selectedIds.indexOf(course.id);
                const checked = selectedIndex >= 0;
                return <div key={course.id} className="flex min-w-0 flex-wrap items-center gap-3 py-3 sm:flex-nowrap"><label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" checked={checked} disabled={!checked && selectedIds.length >= 4 || pending} onChange={() => toggleCourse(course.id)} className="h-5 w-5 shrink-0 accent-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" /><span className="min-w-0 break-words">{course.title}</span></label>{checked && <div className="ml-8 flex items-center gap-1 sm:ml-0"><span className="mr-1 text-xs tabular-nums text-muted-foreground">{selectedIndex + 1}.</span><Button type="button" variant="outline" size="icon" aria-label={`${course.title} nach oben`} disabled={selectedIndex === 0 || pending} onClick={() => moveCourse(course.id, -1)}><ArrowUp className="h-4 w-4" /></Button><Button type="button" variant="outline" size="icon" aria-label={`${course.title} nach unten`} disabled={selectedIndex === selectedIds.length - 1 || pending} onClick={() => moveCourse(course.id, 1)}><ArrowDown className="h-4 w-4" /></Button></div>}</div>;
              })}</div>}
            <p className="mt-3 text-sm tabular-nums" role="status" aria-live="polite">{selectedIds.length} von 2–4 Kursen gewählt</p>
          </fieldset>
          <Button type="submit" disabled={pending || selectedIds.length < 2 || selectedIds.length > 4 || !title.trim() || !description.trim() || !badgeLabel.trim()} className="w-full sm:w-auto"><Plus className="h-4 w-4" aria-hidden="true" />{pending ? 'Wird erstellt…' : 'Lernpfad erstellen'}</Button>
        </form>
      </section>
      <aside aria-labelledby="created-pathways-title" className="min-w-0 xl:border-l xl:pl-8"><h2 id="created-pathways-title" className="border-b pb-4 text-xl font-semibold">Bestehende Lernpfade</h2>{pathways.length === 0 ? <p className="mt-5 text-sm leading-relaxed text-muted-foreground">Noch keine Lernpfade erstellt. Der erste kann links zusammengestellt werden.</p> : <ol className="divide-y">{pathways.map(pathway => <li key={pathway.id} className="min-w-0 py-5"><h3 className="break-words font-semibold">{pathway.title}</h3>{pathway.unavailable && <p className="mt-2 text-sm font-medium text-destructive">Derzeit nicht verfügbar: Mindestens ein Kurs ist entfernt oder unveröffentlicht. Bestehende private Teilnahmen bleiben erhalten.</p>}<p className="mt-1 break-words text-sm leading-relaxed text-muted-foreground">{pathway.description}</p><p className="mt-3 flex items-center gap-1.5 text-xs font-medium"><Check className="h-4 w-4 text-primary" aria-hidden="true" />{pathway.courses.length} Kurse · Privates Abzeichen: {pathway.badgeLabel}</p><ol className="mt-2 list-inside list-decimal space-y-1 text-xs text-muted-foreground">{[...pathway.courses].sort((a, b) => a.order - b.order).map(course => <li key={course.courseId} className="break-words">{course.title}</li>)}</ol></li>)}</ol>}</aside>
    </div>}
  </div>;
}
