'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { CourseEnrollment, courseRequestError } from '../hooks/useCourseProgress';

export interface CourseDetails {
  id: string;
  name: string;
  description: string;
  price: number | null;
  currency: string | null;
  maxStudents: number | null;
  participants: number;
  canManage: boolean;
  hasAccess: boolean;
  enrollment: CourseEnrollment | null;
}

export function CourseEnrollmentButton({ course, onEnrolled }: { course: CourseDetails; onEnrolled: () => Promise<void> }) {
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const isPaid = (course.price ?? 0) > 0;
  const isFull = course.maxStudents !== null && course.participants >= course.maxStudents;

  const enroll = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setIsEnrolling(true);
    setError(null);
    try {
      const response = await fetch(`/api/courses/${course.id}/enroll`, { method: 'POST' });
      if (!response.ok) throw await courseRequestError(response, 'Einschreibung fehlgeschlagen. Bitte erneut versuchen.');
      await onEnrolled();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Einschreibung fehlgeschlagen.');
    } finally {
      submitting.current = false;
      setIsEnrolling(false);
    }
  };

  return <div className="space-y-3">
    {isPaid ? <>
      <p className="font-medium">Kostenpflichtiger Kurs: {course.price?.toLocaleString('de-DE')} {course.currency || ''}</p>
      <p className="text-sm text-muted-foreground">Die Kursleitung oder ein Administrator muss Ihren Zugang freischalten. In dieser Anwendung werden keine Zahlungen abgewickelt.</p>
    </> : <>
      <Button onClick={enroll} disabled={isEnrolling || isFull}>{isEnrolling ? 'Wird eingeschrieben...' : isFull ? 'Kurs ist ausgebucht' : 'Kostenlos einschreiben'}</Button>
      <p className="text-xs text-muted-foreground">Ihre Einschreibung und Ihr Lernfortschritt werden in Ihrem Konto gespeichert.</p>
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}

interface EnrollmentRow extends CourseEnrollment {
  user: { id: string; name: string | null; email: string };
}

export function CourseAccessManager({ courseId, onAccessChanged }: { courseId: string; onAccessChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant="outline" size="sm">Teilnehmer verwalten</Button></DialogTrigger>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>Kurszugang freischalten</DialogTitle><DialogDescription>Schalten Sie ein bestehendes Benutzerkonto per E-Mail für diesen Kurs frei. Dies löst keine Zahlung aus.</DialogDescription></DialogHeader>
      {open && <AccessManagerForm courseId={courseId} onAccessChanged={onAccessChanged} />}
    </DialogContent>
  </Dialog>;
}

function AccessManagerForm({ courseId, onAccessChanged }: { courseId: string; onAccessChanged: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [capacity, setCapacity] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const readController = new AbortController();
    void fetch(`/api/courses/${courseId}/enrollments?page=${page}`, { signal: readController.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw await courseRequestError(response, 'Teilnehmer konnten nicht geladen werden.');
        return response.json();
      }).then(data => {
        if (!readController.signal.aborted) {
          setEnrollments(data.enrollments);
          setCapacity(data.maxStudents);
          setTotal(data.total);
          setHasMore(data.hasMore);
        }
      }).catch(cause => {
        if (!readController.signal.aborted) setError(cause instanceof Error ? cause.message : 'Teilnehmer konnten nicht geladen werden.');
      }).finally(() => { if (!readController.signal.aborted) setLoading(false); });
    return () => readController.abort();
  }, [courseId, reload, page]);

  useEffect(() => () => { controller.current?.abort(); }, []);

  const grantAccess = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    const writeController = new AbortController();
    controller.current = writeController;
    try {
      const response = await fetch(`/api/courses/${courseId}/enrollments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }), signal: writeController.signal,
      });
      if (!response.ok) throw await courseRequestError(response, 'Zugang wurde nicht freigeschaltet.');
      if (writeController.signal.aborted) return;
      setEmail('');
      setSuccess('Kurszugang ist freigeschaltet.');
      setLoading(true);
      setPage(1);
      setReload(value => value + 1);
      await onAccessChanged();
    } catch (cause) {
      if (!writeController.signal.aborted) setError(cause instanceof Error ? cause.message : 'Zugang wurde nicht freigeschaltet.');
    } finally {
      if (!writeController.signal.aborted) {
        inFlight.current = false;
        setSubmitting(false);
      }
    }
  };

  return <div className="space-y-5">
    <form onSubmit={grantAccess} className="space-y-3">
      <Label htmlFor="enrollment-email">E-Mail des Benutzerkontos</Label>
      <Input id="enrollment-email" type="email" value={email} onChange={event => setEmail(event.target.value)} required disabled={submitting} autoComplete="off" />
      <Button type="submit" disabled={submitting || !email.trim()}>{submitting ? 'Wird freigeschaltet...' : 'Zugang freischalten'}</Button>
    </form>
    {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p><Button size="sm" variant="outline" onClick={() => { setError(null); setLoading(true); setReload(value => value + 1); }} disabled={loading || submitting}>Teilnehmer erneut laden</Button></div>}
    {success && <p role="status" className="text-sm text-green-600">{success}</p>}
    <section className="space-y-2"><h3 className="font-medium">Eingeschriebene Teilnehmer{!loading && ` (${total}${capacity === null ? '' : `/${capacity}`})`}</h3>
      {loading ? <p role="status" className="text-sm">Teilnehmer werden geladen...</p> : enrollments.length === 0 ? <p className="text-sm text-muted-foreground">Noch keine Teilnehmer</p> : <ul className="space-y-2">
        {enrollments.map(enrollment => <li key={enrollment.id} className="rounded border border-border p-3 text-sm"><p>{enrollment.user.name || enrollment.user.email}</p><p className="text-muted-foreground break-all">{enrollment.user.email}</p><p className="text-xs mt-1">{enrollment.completedAt ? 'Kurs abgeschlossen' : 'Zugang freigeschaltet'}</p></li>)}
      </ul>}
      {(page > 1 || hasMore) && <div className="flex items-center justify-between gap-2 pt-2">
        <Button size="sm" variant="outline" disabled={loading || submitting || page === 1} onClick={() => { setLoading(true); setPage(value => value - 1); }}>Zurück</Button>
        <span className="text-sm">Seite {page}</span>
        <Button size="sm" variant="outline" disabled={loading || submitting || !hasMore} onClick={() => { setLoading(true); setPage(value => value + 1); }}>Weiter</Button>
      </div>}
    </section>
  </div>;
}
