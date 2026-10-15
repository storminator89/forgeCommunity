'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppHeader, AppShell } from '@/components/app-shell';
import { Sidebar } from '@/components/Sidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserNav } from '@/components/user-nav';

type Status = 'all' | 'not-started' | 'in-progress' | 'current-complete' | 'unmeasurable' | 'needs-quiz-review';
type Row = {
  enrollmentId: string; displayName: string; enrolledAt: string;
  currentStatus: Exclude<Status, 'all' | 'needs-quiz-review'>; completedLeaves: number; totalLeaves: number;
  firstIncomplete: { id: string; title: string } | null; quizAttempts: number; quizNeedsReview: number;
  latestQuiz: { title: string; score: number; passed: boolean; submittedAt: string } | null;
  historicalCompletedAt: string | null; certificateIssuedAt: string | null;
};
type Result = {
  course: { id: string; title: string; activePublicationId: string | null };
  summary: { enrolled: number; currentComplete: number; notStarted: number; inProgress: number; unmeasurable: number;
    quizSignals: Array<{ contentId: string; title: string; attemptedLearners: number; latestFailureLearners: number }> };
  pagination: { page: number; pageSize: number; total: number; pages: number };
  learners: Row[];
};
const statusLabels: Record<Row['currentStatus'], string> = {
  'not-started': 'Keine aktuelle Aktivität erfasst', 'in-progress': 'In Bearbeitung',
  'current-complete': 'Aktuelle Fassung abgeschlossen', unmeasurable: 'Noch nicht messbar',
};
const formatter = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });
function date(value: string | null) { return value ? formatter.format(new Date(value)) : '–'; }

export function CourseAnalytics({ courseId, accountId, sessionStatus }: { courseId: string; accountId: string | null; sessionStatus: string }) {
  const [searchInput, setSearchInput] = useState('');
  const [statusInput, setStatusInput] = useState<Status>('all');
  const [query, setQuery] = useState({ search: '', status: 'all' as Status, page: 1 });
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [retry, setRetry] = useState(0);
  const apiBase = `/api/courses/${encodeURIComponent(courseId)}/analytics`;
  const parameters = new URLSearchParams({ page: String(query.page), pageSize: '25', status: query.status, search: query.search });

  useEffect(() => {
    if (sessionStatus !== 'authenticated' || !accountId) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) { setResult(null); setBusy(true); setError(null); }
    });
    void fetch(`${apiBase}?${parameters}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Kursanalyse konnte nicht geladen werden.');
      }
      return response.json() as Promise<Result>;
    }).then(data => { if (!controller.signal.aborted) setResult(data); }).catch(cause => {
      if (!controller.signal.aborted) { setResult(null); setError(cause instanceof Error ? cause.message : 'Kursanalyse konnte nicht geladen werden.'); }
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  // The URLSearchParams string is the primitive dependency, not its new object identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, accountId, sessionStatus, parameters.toString(), retry]);

  const exportCsv = async () => {
    if (!result || exporting || result.pagination.total > 500 || !result.pagination.total) return;
    setExportError(null);
    setExporting(true);
    try {
      const response = await fetch(`${apiBase}/export?${parameters}`, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (response.status === 401 || response.status === 403) {
          setResult(null);
          setError(body.error || 'Kein Zugriff mehr auf die Kursanalyse.');
          return;
        }
        throw new Error(body.error || 'CSV konnte nicht geladen werden.');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'kursanalyse.csv';
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setExportError(cause instanceof Error ? cause.message : 'CSV konnte nicht geladen werden.'); }
    finally { setExporting(false); }
  };

  return <AppShell>
    <Sidebar />
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <AppHeader><div className="flex min-w-0 items-center justify-between gap-2"><h1 className="min-w-0 break-words text-base font-semibold [overflow-wrap:anywhere]">Kursanalyse</h1><div className="flex shrink-0 items-center gap-1"><ThemeToggle /><UserNav /></div></div></AppHeader>
      <main id="page-content" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl space-y-7">
          <div className="space-y-3 border-b pb-6">
            <Link href={`/courses/${encodeURIComponent(courseId)}/contents`} className="inline-flex whitespace-nowrap text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">← Zum Autorenarbeitsplatz</Link>
            <div className="flex flex-wrap items-end justify-between gap-4"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Veröffentlichter Kurs</p><h2 className="mt-1 min-w-0 break-words text-2xl font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-3xl">{result?.course.title || 'Lernfortschritt'}</h2><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Aktueller Stand der veröffentlichten Inhalte. Frühere Abschlüsse und Zertifikate stehen getrennt davon.</p></div></div>
          </div>
          {sessionStatus !== 'authenticated' || !accountId ? <p role="status" className="rounded-xl border bg-card p-5 text-sm">Bitte melde dich an, um die Kursanalyse zu sehen.</p> : null}
          {error && <div role="alert" className="space-y-3 rounded-xl border border-destructive/40 bg-card p-5 text-sm"><p>{error}</p><Button variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}>Erneut versuchen</Button></div>}
          {busy && <p role="status" className="text-sm text-muted-foreground">Kursanalyse wird geladen …</p>}
          {result && <>
            <section aria-labelledby="course-analytics-summary" className="space-y-3"><div><h3 id="course-analytics-summary" className="text-lg font-semibold">Überblick</h3><p className="text-sm text-muted-foreground">Alle aktuell eingeschriebenen Personen, unabhängig vom Filter.</p></div><dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {[
                ['Eingeschrieben', result.summary.enrolled], ['Aktuell abgeschlossen', result.summary.currentComplete],
                ['In Bearbeitung', result.summary.inProgress], ['Keine aktuelle Aktivität erfasst', result.summary.notStarted],
                ['Nicht messbar', result.summary.unmeasurable],
              ].map(([label, count]) => <div key={label} className="rounded-xl border bg-card p-4"><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{count}</dd></div>)}
            </dl>{!result.course.activePublicationId && <p className="rounded-lg border bg-muted/30 p-3 text-sm">Dieser Kurs ist noch nicht veröffentlicht. Aktueller Fortschritt kann deshalb nicht gemessen werden.</p>}</section>
            <section aria-labelledby="quiz-signal-title" className="space-y-2 border-b pb-6"><h3 id="quiz-signal-title" className="text-lg font-semibold">Quizsignale</h3><p className="text-sm text-muted-foreground">Quizzes mit den meisten zuletzt nicht bestandenen Versuchen pro Person, nur für aktuell veröffentlichte Quizinhalte.</p>{result.summary.quizSignals.length ? <ul className="grid gap-2 sm:grid-cols-3">{result.summary.quizSignals.map(signal => <li key={signal.contentId} className="min-w-0 rounded-xl border bg-card p-4"><p className="break-words font-medium [overflow-wrap:anywhere]">{signal.title}</p><p className="mt-1 text-sm text-muted-foreground">{signal.latestFailureLearners} von {signal.attemptedLearners} Personen zuletzt nicht bestanden</p></li>)}</ul> : <p className="text-sm text-muted-foreground">Noch keine auswertbaren Quizversuche in der aktuellen Fassung.</p>}</section>
            <section aria-labelledby="learner-analytics-title" className="space-y-4"><div><h3 id="learner-analytics-title" className="text-lg font-semibold">Lernende</h3><p className="text-sm text-muted-foreground">Name, Fortschritt und Quizsignale sind nur für die Kursleitung und Administratoren sichtbar.</p></div>
              <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4" onSubmit={event => { event.preventDefault(); setQuery({ search: searchInput.trim(), status: statusInput, page: 1 }); }}>
                <div className="min-w-0 flex-1 basis-48 space-y-1"><Label htmlFor="analytics-search">Name suchen</Label><Input id="analytics-search" value={searchInput} maxLength={64} onChange={event => setSearchInput(event.target.value)} placeholder="Anzeigename" /></div>
                <div className="min-w-0 flex-1 basis-48 space-y-1"><Label htmlFor="analytics-status">Status</Label><select id="analytics-status" value={statusInput} onChange={event => setStatusInput(event.target.value as Status)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><option value="all">Alle</option><option value="not-started">Keine aktuelle Aktivität erfasst</option><option value="in-progress">In Bearbeitung</option><option value="current-complete">Aktuell abgeschlossen</option><option value="needs-quiz-review">Quiz erneut ansehen</option><option value="unmeasurable">Nicht messbar</option></select></div>
                <Button type="submit" variant="secondary" className="whitespace-nowrap">Anwenden</Button>
                <Button type="button" variant="outline" disabled={exporting || result.pagination.total === 0 || result.pagination.total > 500} onClick={() => void exportCsv()} className="whitespace-nowrap">{exporting ? 'CSV wird erstellt …' : 'CSV exportieren'}</Button>
              </form>
              {result.pagination.total > 500 && <p className="text-sm text-muted-foreground">Der Export ist auf 500 Personen begrenzt. Grenze die Liste mit den Filtern ein.</p>}
              {exportError && <p role="alert" className="text-sm text-destructive">{exportError}</p>}
              <p role="status" className="text-sm text-muted-foreground">{result.pagination.total} Treffer · Seite {result.pagination.page} von {Math.max(1, result.pagination.pages)}</p>
              {result.learners.length ? <ul className="space-y-2" aria-label="Lernende im Kurs">{result.learners.map(row => <li key={row.enrollmentId} className="min-w-0 rounded-xl border bg-card p-4 sm:p-5"><div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]"><div className="min-w-0"><h4 className="break-words font-semibold [overflow-wrap:anywhere]">{row.displayName}</h4><p className="mt-1 text-xs text-muted-foreground">Eingeschrieben {date(row.enrolledAt)}</p><p className="mt-1 break-all text-xs text-muted-foreground">ID {row.enrollmentId}</p></div><div className="min-w-0 text-sm"><p className="font-medium">{statusLabels[row.currentStatus]}</p><p className="text-muted-foreground">{row.completedLeaves} von {row.totalLeaves} aktuellen Inhalten erledigt</p>{row.firstIncomplete && <p className="mt-1 break-words text-muted-foreground [overflow-wrap:anywhere]">Nächster offener Inhalt: {row.firstIncomplete.title}</p>}</div><div className="min-w-0 text-sm"><p>{row.quizAttempts} aktuelle Quizversuche · {row.quizNeedsReview} Quizzes zuletzt nicht bestanden</p>{row.latestQuiz && <p className="mt-1 break-words text-muted-foreground [overflow-wrap:anywhere]">Letzter Versuch: {row.latestQuiz.title}, {Math.round(row.latestQuiz.score)} %, {row.latestQuiz.passed ? 'bestanden' : 'nicht bestanden'}</p>}<p className="mt-2 text-xs text-muted-foreground">Früherer Abschluss: {date(row.historicalCompletedAt)} · Zertifikat: {date(row.certificateIssuedAt)}</p></div></div></li>)}</ul> : <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">Keine Lernenden für diesen Filter gefunden.</p>}
              <nav aria-label="Seiten der Lernenden" className="flex flex-wrap items-center justify-between gap-3"><Button type="button" variant="outline" size="sm" disabled={busy || query.page <= 1} onClick={() => setQuery(value => ({ ...value, page: value.page - 1 }))} className="whitespace-nowrap">Vorherige Seite</Button><span className="text-sm text-muted-foreground">Seite {result.pagination.page} von {Math.max(1, result.pagination.pages)}</span><Button type="button" variant="outline" size="sm" disabled={busy || query.page >= result.pagination.pages} onClick={() => setQuery(value => ({ ...value, page: value.page + 1 }))} className="whitespace-nowrap">Nächste Seite</Button></nav>
            </section>
          </>}
        </div>
      </main>
    </div>
  </AppShell>;
}
