'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { AppHeader, AppShell } from '@/components/app-shell';
import { PageState } from '@/components/page-state';
import { Sidebar } from '@/components/Sidebar';
import { UserNav } from '@/components/user-nav';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { reportReasonLabel, type ReportStatus, type ReportTargetType } from '@/lib/reporting';

interface ReportItem {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  details: string | null;
  status: ReportStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewedById: string | null;
  resolutionNote: string | null;
  targetAvailable: boolean;
  targetTitle: string | null;
  targetPreview: string | null;
}

interface QueueResponse {
  items: ReportItem[];
  total: number;
  page: number;
  pageSize: number;
}

function ReviewForm({ reportId, onReviewed }: { reportId: string; onReviewed: () => void }) {
  const statusId = useId();
  const noteId = useId();
  const actionId = useId();
  const [status, setStatus] = useState<'DISMISSED' | 'RESOLVED'>('DISMISSED');
  const [note, setNote] = useState('');
  const [actionTaken, setActionTaken] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(reportId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, resolutionNote: note, actionTaken }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Bearbeitung fehlgeschlagen');
      onReviewed();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Bearbeitung fehlgeschlagen');
    } finally {
      setPending(false);
    }
  }

  return <form onSubmit={submit} className="mt-4 space-y-3 border-t pt-4">
    <div className="space-y-1">
      <label htmlFor={statusId} className="text-sm font-medium">Entscheidung</label>
      <select id={statusId} value={status} onChange={(event) => setStatus(event.target.value as typeof status)}
        className="flex h-11 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <option value="DISMISSED">Ohne Maßnahme schließen</option>
        <option value="RESOLVED">Bereits durchgeführte Maßnahme dokumentieren</option>
      </select>
    </div>
    <div className="space-y-1">
      <label htmlFor={noteId} className="text-sm font-medium">Begründung oder durchgeführte Maßnahme</label>
      <Textarea id={noteId} value={note} onChange={(event) => setNote(event.target.value)}
        minLength={5} maxLength={500} required placeholder="Was wurde geprüft oder unternommen?" />
    </div>
    {status === 'RESOLVED' && <div className="flex items-start gap-2 text-sm">
      <input id={actionId} type="checkbox" checked={actionTaken} onChange={(event) => setActionTaken(event.target.checked)}
        required className="mt-1" />
      <label htmlFor={actionId}>Ich habe die beschriebene Maßnahme bereits durchgeführt. Diese Ansicht entfernt Inhalte nicht automatisch.</label>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={pending || note.trim().length < 5 || (status === 'RESOLVED' && !actionTaken)}>
      {pending ? 'Wird gespeichert…' : 'Entscheidung speichern'}
    </Button>
  </form>;
}

export function ModerationQueue() {
  const { data, status } = useSession();
  if (status === 'loading') return <PageState kind="loading" title="Berechtigung wird geprüft" />;
  if (status !== 'authenticated' || !data?.user?.id) return <PageState kind="error" title="Anmeldung erforderlich" />;
  // The layout and API authorize against the database. A session role refresh
  // must also discard private state and pending reads, including a demotion
  // that keeps the same user ID. The role here only invalidates client state.
  return <ModerationQueueForViewer key={`${data.user.id}:${data.user.role ?? ''}`} />;
}

function ModerationQueueForViewer() {
  const [status, setStatus] = useState<ReportStatus>('OPEN');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/reports?status=${status}&page=${page}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Meldungen konnten nicht geladen werden');
        return body as QueueResponse;
      })
      .then((body) => { if (!controller.signal.aborted) { setQueue(body); setError(''); } })
      .catch((caught) => { if (!controller.signal.aborted) {
        setQueue(null);
        setError(caught instanceof Error ? caught.message : 'Laden fehlgeschlagen');
      } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [status, page, refresh]);

  function reviewed() {
    setFeedback('Entscheidung gespeichert.');
    setLoading(true);
    setRefresh((value) => value + 1);
  }

  function changeStatus(nextStatus: ReportStatus) {
    setStatus(nextStatus);
    setPage(1);
    setQueue(null);
    setFeedback('');
    setError('');
    setLoading(true);
  }

  function changePage(nextPage: number) {
    setPage(nextPage);
    setQueue(null);
    setError('');
    setLoading(true);
  }

  function retryQueue() {
    setQueue(null);
    setError('');
    setLoading(true);
    setRefresh((value) => value + 1);
  }

  const hasNextPage = queue !== null && page * queue.pageSize < queue.total;
  return <AppShell>
    <Sidebar />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <AppHeader>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <h1 className="min-w-0 truncate">Meldungen prüfen</h1>
          <div className="flex shrink-0 items-center gap-2"><ThemeToggle /><UserNav /></div>
        </div>
      </AppHeader>
      <main id="page-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 lg:p-8">
        <div className="mx-auto max-w-4xl space-y-5">
          <p className="text-sm text-muted-foreground">Nur Moderation und Administration können Meldungen sehen und bearbeiten. Entscheidungen werden mit Zeit und Bearbeiter protokolliert.</p>
          <div role="group" aria-label="Meldungsstatus" className="flex flex-wrap gap-2">
            {([['OPEN', 'Offen'], ['DISMISSED', 'Abgewiesen'], ['RESOLVED', 'Maßnahme dokumentiert']] as const).map(([value, label]) =>
              <Button key={value} type="button" variant={status === value ? 'default' : 'outline'}
                aria-pressed={status === value} onClick={() => changeStatus(value)}>{label}</Button>)}
          </div>
          {feedback && <p role="status" className="text-sm text-primary">{feedback}</p>}
          {error && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 p-4 text-sm text-destructive"><p>{error}</p><Button type="button" variant="outline" onClick={retryQueue}>Erneut versuchen</Button></div>}
          {loading ? <p role="status">Meldungen werden geladen…</p> : queue && <>
            <p aria-live="polite" className="text-sm text-muted-foreground">{queue.total} Meldungen, Seite {page}</p>
            {queue.items.length === 0 ? <p>Keine Meldungen in diesem Status.</p> :
              <ul className="space-y-4">
                {queue.items.map((report) => <li key={report.id} className="rounded-xl border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-semibold">{report.targetType === 'POST' ? 'Beitrag' : 'Kommentar'} · {reportReasonLabel(report.reason)}</h2>
                    <time dateTime={report.createdAt} className="text-xs text-muted-foreground">
                      Gemeldet: {new Date(report.createdAt).toLocaleString('de-DE')}
                    </time>
                  </div>
                  {report.targetAvailable ? <>
                    {report.targetTitle && <p className="mt-2 font-medium">{report.targetTitle}</p>}
                    {report.targetPreview && <p className="mt-1 text-sm text-muted-foreground">{report.targetPreview}</p>}
                    <Link href={`/community#${report.targetType === 'POST' ? 'post' : 'comment'}-${report.targetId}`}
                      className="mt-2 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Inhalt in der Community öffnen
                    </Link>
                  </> : <p className="mt-2 text-sm text-muted-foreground">Inhalt ist nicht mehr öffentlich verfügbar.</p>}
                  {report.details && <p className="mt-3 text-sm"><span className="font-medium">Hinweis: </span>{report.details}</p>}
                  {report.status === 'OPEN' ? <ReviewForm reportId={report.id} onReviewed={reviewed} /> :
                    <div className="mt-3 border-t pt-3 text-sm">
                      <p>{report.status === 'DISMISSED' ? 'Ohne Maßnahme geschlossen' : 'Durchgeführte Maßnahme dokumentiert'}</p>
                      {report.resolutionNote && <p className="mt-1">Begründung: {report.resolutionNote}</p>}
                      {report.reviewedAt && <p className="mt-1 text-muted-foreground">Bearbeitet: {new Date(report.reviewedAt).toLocaleString('de-DE')} · {report.reviewedById}</p>}
                    </div>}
                </li>)}
              </ul>}
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" disabled={page <= 1} onClick={() => changePage(page - 1)}>Vorherige Seite</Button>
              <Button type="button" variant="outline" disabled={!hasNextPage} onClick={() => changePage(page + 1)}>Nächste Seite</Button>
            </div>
          </>}
        </div>
      </main>
    </div>
  </AppShell>;
}
