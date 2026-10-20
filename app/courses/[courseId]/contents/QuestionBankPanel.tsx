'use client';

/* Hallmark · component: author question-bank utility · genre: editorial workbench · design-system: design.md
 * states: default · hover · focus · active · disabled · loading · error · success */
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { quizQuestionTypeLabel } from './quiz-authoring';
import type { QuizQuestion } from './types';

type BankSummary = { id: string; latestRevision: number; updatedAt: string; question: string; type: QuizQuestion['type'] };
type BankHistory = { id: string; latestRevision: number; revisions: { revision: number; createdAt: string }[] };

async function bankResponse<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof body?.error === 'string' ? body.error : 'Fragenpool konnte nicht geladen werden.');
  }
  return response.json() as Promise<T>;
}

const endpoint = '/api/courses/questions';

export function QuestionBankPanel({ activeQuestion, onInsert }: {
  activeQuestion: QuizQuestion | null;
  onInsert: (question: QuizQuestion) => boolean | void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<BankSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [history, setHistory] = useState<BankHistory | null>(null);
  const [selectedRevision, setSelectedRevision] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);

  const loadHistory = async (itemId: string) => {
    setSelectedId(itemId);
    setHistory(null);
    setSelectedRevision('');
    if (!itemId) return;
    const next = await bankResponse<BankHistory>(`${endpoint}/${encodeURIComponent(itemId)}`);
    setHistory(next);
    setSelectedRevision(String(next.latestRevision));
  };

  const loadItems = async (preferredId?: string) => {
    const next = await bankResponse<{ questions: BankSummary[]; nextCursor: string | null }>(endpoint);
    setItems(next.questions);
    setNextCursor(next.nextCursor);
    const itemId = next.questions.some(item => item.id === preferredId) ? preferredId! : next.questions[0]?.id ?? '';
    await loadHistory(itemId);
  };

  const run = async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try { await work(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Fragenpool konnte nicht verarbeitet werden.'); }
    finally { inFlight.current = false; setBusy(false); }
  };

  const toggle = () => {
    if (inFlight.current) return;
    if (open) { setOpen(false); return; }
    setItems([]); setNextCursor(null); setHistory(null); setSelectedId(''); setSelectedRevision('');
    setOpen(true);
    void run(async () => { await loadItems(); });
  };

  const loadMore = () => {
    if (!nextCursor) return;
    void run(async () => {
      const next = await bankResponse<{ questions: BankSummary[]; nextCursor: string | null }>(
        `${endpoint}?cursor=${encodeURIComponent(nextCursor)}`);
      setItems(previous => [...previous, ...next.questions]);
      setNextCursor(next.nextCursor);
    });
  };

  const chooseItem = (itemId: string) => {
    void run(async () => { await loadHistory(itemId); });
  };

  const saveNew = () => {
    if (!activeQuestion) return;
    void run(async () => {
      const result = await bankResponse<{ id: string }>(endpoint, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: activeQuestion }) });
      await loadItems(result.id);
      setNotice('Frage als eigene Pool-Frage gespeichert. Das Quiz bleibt unverändert.');
    });
  };

  const revise = () => {
    if (!activeQuestion || !history) return;
    void run(async () => {
      await bankResponse(`${endpoint}/${encodeURIComponent(history.id)}`, { method: 'PATCH',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: history.latestRevision, question: activeQuestion }) });
      await loadItems(history.id);
      setNotice('Neue Frageversion gespeichert. Vorhandene Quizfragen bleiben unverändert.');
    });
  };

  const insert = () => {
    if (!selectedId || !selectedRevision) return;
    void run(async () => {
      const result = await bankResponse<{ question: QuizQuestion }>(
        `${endpoint}/${encodeURIComponent(selectedId)}/revisions/${encodeURIComponent(selectedRevision)}`);
      const inserted = onInsert(result.question);
      if (inserted === false) { setNotice('Die Pool-Frage wurde nicht eingefügt. Warte das Speichern ab und wähle die gewünschte Frage danach erneut.'); return; }
      setNotice('Frage als Kopie in dieses Quiz eingefügt. Speichere anschließend den Kursentwurf.');
    });
  };

  return <section className="mb-6 border-y py-4" aria-label="Eigener Fragenpool">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1"><h4 className="font-semibold">Eigener Fragenpool</h4></div>
      <Button type="button" variant="outline" onClick={toggle} aria-expanded={open} aria-controls={`${id}-content`} className="min-h-11 shrink-0">
        {open ? 'Fragenpool schließen' : 'Fragenpool öffnen'}
      </Button>
    </div>
    {open && <div id={`${id}-content`} className="mt-4 space-y-4">
      {busy && <p role="status" className="text-sm text-muted-foreground">Fragenpool wird verarbeitet …</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm text-foreground"><span aria-hidden="true">✓ </span>{notice}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="min-h-11" disabled={busy || !activeQuestion} onClick={saveNew}>Als Pool-Frage speichern</Button>
      </div>
      <p className="min-w-0 break-words text-sm text-muted-foreground">{activeQuestion ? `Aktive Quizfrage: ${activeQuestion.question || 'Fragetext fehlt'}` : 'Wähle im Quiz eine vollständige Frage aus.'} Eine neue Version ändert keine bereits eingefügten oder veröffentlichten Fragen.</p>
      {items.length ? <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1"><label htmlFor={`${id}-item`} className="block text-sm font-medium">Pool-Frage</label>
          <select id={`${id}-item`} value={selectedId} disabled={busy} onChange={event => chooseItem(event.target.value)}
            className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50">
            {items.map(item => <option key={item.id} value={item.id}>{item.question.slice(0, 90)} · {quizQuestionTypeLabel(item.type)} · V{item.latestRevision}</option>)}
          </select></div>
        <div className="min-w-0 space-y-1"><label htmlFor={`${id}-revision`} className="block text-sm font-medium">Version</label>
          <select id={`${id}-revision`} value={selectedRevision} disabled={busy || !history} onChange={event => setSelectedRevision(event.target.value)}
            className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50">
            {history?.revisions.map(row => <option key={row.revision} value={row.revision}>Version {row.revision}</option>)}
          </select></div>
      </div> : <p className="text-sm text-muted-foreground">Noch keine gespeicherten Fragen. Wähle oben eine vollständige Quizfrage und speichere sie im Pool.</p>}
      {nextCursor && <Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={loadMore}>Weitere Fragen laden</Button>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="min-h-11" disabled={busy || !history || !selectedRevision} onClick={insert}>Version als Kopie einfügen</Button>
        <Button type="button" variant="outline" className="min-h-11" disabled={busy || !activeQuestion || !history} onClick={revise}>Neue Version speichern</Button>
      </div>
    </div>}
  </section>;
}
