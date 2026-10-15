'use client'

import { PageState, LoadingScreen, RetryButton } from '@/components/page-state';
import { AppShell, AppHeader } from '@/components/app-shell';
import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from "@/components/ui/button";
import { UserNav } from "@/components/user-nav";
import { Sidebar } from "@/components/Sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, BookOpen, CalendarDays, Clock3, Plus, Search, Trash2, Users } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';
import { canSeeLearnerPathways } from '@/lib/pathway-visibility';

interface Course {
  id: string;
  title: string;
  instructor: string;
  duration: string;
  startDate: string | null;
  endDate: string | null;
  category: string;
  participants: number;
  maxStudents: number | null;
  price: number | null;
  currency: string | null;
  isEnrolled: boolean;
  completed: boolean;
  everCompleted?: boolean;
  canDelete: boolean;
  rewardEligible?: boolean;
  canApproveRewards?: boolean;
  imageUrl: string | null;
}

export default function CourseClient() {
  const { data: session, status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/');
  }, [status, router]);
  if (status === 'loading') return <LoadingScreen />;
  if (status !== 'authenticated' || !session?.user?.id) return null;
  // Account-specific enrollment, progress and editor rights never cross this
  // keyed boundary, even before a new fetch or effect can run.
  return <ScopedCourseClient key={session.user.id} session={session} />;
}

function ScopedCourseClient({ session }: { session: NonNullable<ReturnType<typeof useSession>['data']> }) {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('Alle');
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState(false);
  const [pendingCourseId, setPendingCourseId] = useState<string | null>(null);
  const [rewardPendingCourseId, setRewardPendingCourseId] = useState<string | null>(null);
  const [deletingCourseId, setDeletingCourseId] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();
  const activeRef = useRef(true);
  const searchRef = useRef<HTMLInputElement>(null);
  // All authenticated accounts can create courses. The role only changes
  // the suggested next step; it is not an additional authorization rule.
  const creatorPerspective = session.user.role === 'ADMIN' || session.user.role === 'INSTRUCTOR';

  useEffect(() => {
    activeRef.current = true;
    const controller = new AbortController();
    const fetchCourses = async () => {
      try {
        const response = await fetch('/api/courses', { signal: controller.signal });
        if (!response.ok) {
          throw new Error('Failed to fetch courses');
        }
        const data = (await response.json()) as Course[];
        if (activeRef.current && !controller.signal.aborted) setCourses(data);
      } catch (error) {
        if (activeRef.current && !controller.signal.aborted) {
          console.error('Error fetching courses:', error);
          setLoadError(true);
        }
      } finally {
        if (activeRef.current && !controller.signal.aborted) setIsLoading(false);
      }
    };

    void fetchCourses();
    return () => { activeRef.current = false; controller.abort(); };
  }, []);

  const changeEnrollment = async (course: Course, leaving = false) => {
    if (!activeRef.current) return;
    setPendingCourseId(course.id);
    try {
      const response = await fetch(`/api/courses/${course.id}/enrollment`, { method: leaving ? 'DELETE' : 'POST' });
      const result = await response.json();
      if (!activeRef.current) return;
      if (!response.ok) throw new Error(result.error || 'Die Anmeldung konnte nicht geändert werden.');
      setCourses(current => current.map(item => item.id === course.id
        ? { ...item, isEnrolled: result.isEnrolled, participants: result.participants }
        : item));
      toast({ title: leaving ? 'Kurs verlassen' : 'Zum Kurs angemeldet' });
      if (!leaving) router.push(`/courses/${course.id}/contents`);
    } catch (error) {
      if (activeRef.current) toast({ title: 'Fehler', description: error instanceof Error ? error.message : 'Bitte erneut versuchen.', variant: 'destructive' });
    } finally {
      if (activeRef.current) setPendingCourseId(null);
    }
  };

  const categories = Array.from(new Set(courses.map(course => course.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'de'));
  const query = searchTerm.trim().toLocaleLowerCase('de');
  const filteredCourses = courses.filter(course =>
    (course.title.toLocaleLowerCase('de').includes(query) || course.instructor.toLocaleLowerCase('de').includes(query)) &&
    (categoryFilter === 'Alle' || course.category === categoryFilter)
  );
  const hasFilters = Boolean(searchTerm) || categoryFilter !== 'Alle';
  const resetFilters = () => {
    setSearchTerm('');
    setCategoryFilter('Alle');
    // The reset button can disappear with the empty state. Keep keyboard
    // focus on the search control instead of leaving it on the document body.
    searchRef.current?.focus();
  };

  const handleDeleteCourse = async (courseId: string) => {
    if (!activeRef.current) return;
    setDeletingCourseId(courseId);
    try {
      const response = await fetch(`/api/courses/${courseId}`, {
        method: 'DELETE',
      });
      if (!activeRef.current) return;
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(typeof result?.error === 'string' ? result.error : 'Der Kurs konnte nicht gelöscht werden.');
      }
      setCourses(current => current.filter(course => course.id !== courseId));
      toast({ title: 'Kurs gelöscht' });
    } catch (error) {
      if (activeRef.current) toast({ title: 'Kurs konnte nicht gelöscht werden', description: error instanceof Error ? error.message : 'Bitte versuche es erneut.', variant: 'destructive' });
    } finally {
      if (activeRef.current) setDeletingCourseId(null);
    }
  };

  const updateRewardEligibility = async (course: Course, eligible: boolean) => {
    if (!activeRef.current || session.user.role !== 'ADMIN' || !course.canApproveRewards) return;
    setRewardPendingCourseId(course.id);
    try {
      const response = await fetch(`/api/admin/courses/${course.id}/reward-eligibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eligible }),
      });
      const result = await response.json().catch(() => null);
      if (!activeRef.current) return;
      if (!response.ok) throw new Error(result?.error || 'Die Freigabe konnte nicht geändert werden.');
      setCourses(current => current.map(item => item.id === course.id ? { ...item, rewardEligible: result.rewardEligible } : item));
      toast({ title: eligible ? 'Kurs für Belohnungen freigegeben' : 'Belohnungsfreigabe widerrufen' });
    } catch (error) {
      if (activeRef.current) toast({ title: 'Freigabe konnte nicht geändert werden', description: error instanceof Error ? error.message : 'Bitte erneut versuchen.', variant: 'destructive' });
    } finally {
      if (activeRef.current) setRewardPendingCourseId(null);
    }
  };

  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="flex items-center justify-between gap-3">
            <h1>Kurse</h1>
            <div className="flex shrink-0 items-center gap-1 sm:gap-2"><ThemeToggle /><UserNav /></div>
          </div>
        </AppHeader>
        <main id="page-content" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1440px] px-4 pb-16 pt-7 sm:px-6 sm:pt-10 lg:px-8">
            <div className="flex flex-col gap-5 border-b pb-7 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-2xl">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Lernen in der Community</p>
                <h2 className="text-[clamp(1.65rem,1.2rem+2vw,2.4rem)] font-semibold leading-tight tracking-tight">Wissen teilen. Gemeinsam weiterkommen.</h2>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">Entdecke Kurse aus der Community, lerne in deinem Tempo und teile selbst, was du kannst.</p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                {canSeeLearnerPathways(session.user.role) && <Button asChild variant="outline" className="w-full shrink-0 sm:w-auto"><Link href="/courses/pathways">Lernpfade</Link></Button>}
                <Button asChild variant="outline" className="w-full shrink-0 sm:w-auto"><Link href="/courses/goals">Mein Lernziel</Link></Button>
                <Button asChild variant="outline" className="w-full shrink-0 sm:w-auto"><Link href="/courses/authoring">Meine Kursentwürfe</Link></Button>
                <Button asChild variant={creatorPerspective ? 'default' : 'outline'} className="w-full shrink-0 sm:w-auto"><Link href="/courses/new"><Plus aria-hidden="true" className="h-4 w-4" />Neuer Kurs</Link></Button>
              </div>
            </div>
            <section aria-labelledby="course-directory-title" className="pt-7 sm:pt-9">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 id="course-directory-title" className="text-xl font-semibold tracking-tight">Kursübersicht</h2>
                  {!isLoading && !loadError && <p role="status" aria-live="polite" className="mt-1 text-sm text-muted-foreground">{filteredCourses.length} {filteredCourses.length === 1 ? 'Kurs' : 'Kurse'} {hasFilters ? 'gefunden' : 'verfügbar'}</p>}
                </div>
                {hasFilters && filteredCourses.length > 0 && <Button type="button" variant="ghost" className="self-start sm:self-auto" onClick={resetFilters}>Filter zurücksetzen</Button>}
              </div>
              <div className="mt-5 grid min-w-0 gap-3 rounded-2xl border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end sm:p-4">
                <div className="min-w-0">
                  <label htmlFor="course-search" className="mb-1.5 block text-sm font-medium">Kurse suchen</label>
                  <div className="relative">
                    <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input ref={searchRef} id="course-search" aria-label="Suche nach Kursen oder Dozenten" type="search" placeholder="Titel oder Lehrkraft" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} className="pl-10" />
                  </div>
                </div>
                <div className="min-w-0">
                  <label id="course-category-label" className="mb-1.5 block text-sm font-medium">Kategorie</label>
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger aria-label="Kategorie wählen" aria-labelledby="course-category-label" className="h-11 w-full rounded-xl"><SelectValue placeholder="Kategorie wählen" /></SelectTrigger>
                    <SelectContent><SelectItem value="Alle">Alle Kategorien</SelectItem>{categories.map(category => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="mt-5">
                {isLoading && <PageState kind="loading" title="Kurse werden geladen" />}
                {loadError && <PageState kind="error" title="Kurse konnten nicht geladen werden" description="Prüfe deine Verbindung und versuche es erneut." action={<RetryButton onClick={() => window.location.reload()} />} />}
                {!isLoading && !loadError && filteredCourses.length === 0 && <PageState
                  title={courses.length === 0 ? 'Noch keine Kurse' : 'Keine Kurse gefunden'}
                  description={courses.length === 0
                    ? creatorPerspective
                      ? 'Erstelle den ersten Kurs und teile dein Wissen mit der Community.'
                      : 'Hier sind aktuell keine Kurse verfügbar. Tausche dich in der Community aus oder sieh in der Veranstaltungsübersicht nach.'
                    : 'Versuche andere Suchbegriffe oder setze die Filter zurück.'}
                  action={<div className="flex w-full flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
                    {courses.length === 0 && (creatorPerspective
                      ? <Button asChild><Link href="/courses/new">Kurs erstellen</Link></Button>
                      : <>
                        <Button asChild><Link href="/community">Zur Community</Link></Button>
                        <Button asChild variant="outline"><Link href="/events">Veranstaltungen ansehen</Link></Button>
                      </>)}
                    {hasFilters && <Button type="button" variant="outline" onClick={resetFilters}>Filter zurücksetzen</Button>}
                  </div>}
                />}
                {!isLoading && !loadError && filteredCourses.length > 0 && <div className="divide-y border-y" role="list" aria-label="Kurse">
                  {filteredCourses.map(course => <CourseRow key={course.id} course={course}
                    onDelete={() => void handleDeleteCourse(course.id)} deleting={deletingCourseId === course.id}
                    onJoin={() => void changeEnrollment(course)} onLeave={() => void changeEnrollment(course, true)} pending={pendingCourseId === course.id}
                    canManageRewards={session.user.role === 'ADMIN' && course.canApproveRewards === true} rewardPending={rewardPendingCourseId === course.id}
                    onRewardEligibilityChange={eligible => void updateRewardEligibility(course, eligible)} />)}
                </div>}
              </div>
            </section>
          </div>
        </main>
      </div>
    </AppShell>
  );
}

function CourseRow({ course, onDelete, deleting, onJoin, onLeave, pending, canManageRewards, rewardPending, onRewardEligibilityChange }: {
  course: Course;
  onDelete: () => void;
  deleting: boolean;
  onJoin: () => void;
  onLeave: () => void;
  pending: boolean;
  canManageRewards: boolean;
  rewardPending: boolean;
  onRewardEligibilityChange: (eligible: boolean) => void;
}) {
  const router = useRouter();
  const isPaid = course.price !== null && course.price > 0;
  const isFull = course.maxStudents !== null && course.participants >= course.maxStudents;
  const canOpen = course.canDelete || course.isEnrolled;
  const unavailable = !canOpen && (isPaid || isFull);
  const actionLabel = pending ? 'Wird verarbeitet …' : course.canDelete ? 'Kurs verwalten' : course.isEnrolled ? 'Kurs öffnen' : isPaid ? 'Anmeldung derzeit nicht verfügbar' : isFull ? 'Kurs ausgebucht' : 'Kurs beitreten';

  return (
    <article role="listitem" className="min-w-0 py-5 sm:py-6">
      <div className="grid min-w-0 gap-4 sm:grid-cols-[112px_minmax(0,1fr)] lg:grid-cols-[112px_minmax(0,1fr)_minmax(180px,240px)] lg:gap-6">
        <div className="relative hidden h-28 overflow-hidden rounded-2xl border bg-secondary sm:block">
          {course.imageUrl ? <Image src={course.imageUrl} alt="" fill sizes="112px" unoptimized={course.imageUrl.startsWith('/api/courses/')} className="object-cover" /> : <div className="flex h-full items-center justify-center text-muted-foreground"><BookOpen aria-hidden="true" className="h-8 w-8" /></div>}
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground [overflow-wrap:anywhere]">{course.category}</p>
              <h3 className="mt-1 text-lg font-semibold leading-snug tracking-tight [overflow-wrap:anywhere] sm:text-xl">{course.title}</h3>
            </div>
            {course.canDelete && <AlertDialog>
              <AlertDialogTrigger asChild><Button type="button" aria-label="Löschen" title="Kurs löschen" variant="ghost" size="icon" disabled={deleting} className="shrink-0 text-muted-foreground hover:text-destructive"><Trash2 aria-hidden="true" className="h-4 w-4" /></Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader><AlertDialogTitle>Sind Sie sicher?</AlertDialogTitle><AlertDialogDescription>Diese Aktion kann nicht rückgängig gemacht werden. Der Kurs wird dauerhaft aus unserer Datenbank entfernt.</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>Abbrechen</AlertDialogCancel><AlertDialogAction onClick={onDelete}>Löschen</AlertDialogAction></AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">mit {course.instructor}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Clock3 aria-hidden="true" className="h-4 w-4" />{course.duration}</span>
            {course.startDate && <span className="inline-flex items-center gap-1.5"><CalendarDays aria-hidden="true" className="h-4 w-4" />Ab {new Date(course.startDate).toLocaleDateString('de-DE')}</span>}
            <span className="inline-flex items-center gap-1.5"><Users aria-hidden="true" className="h-4 w-4" />{course.participants}{course.maxStudents !== null ? ` / ${course.maxStudents}` : ''} Teilnehmer</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {course.completed ? <Badge variant="secondary">Abgeschlossen</Badge> : course.everCompleted ? <Badge variant="secondary">Früher abgeschlossen · neue Inhalte offen</Badge> : course.isEnrolled ? <Badge variant="secondary">Angemeldet</Badge> : null}
            {course.rewardEligible && <Badge variant="secondary">Für Kursbelohnungen freigegeben</Badge>}
            {isPaid && <span className="text-sm font-medium">{course.price?.toFixed(2)} {course.currency || 'EUR'}</span>}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:col-start-2 lg:col-start-3 lg:row-start-1 lg:justify-center">
          <Button type="button" variant={canOpen || unavailable ? 'outline' : 'default'} className={`w-full justify-between ${unavailable ? 'text-xs' : ''}`} onClick={canOpen ? () => router.push(`/courses/${course.id}/contents`) : onJoin} disabled={pending || unavailable}>
            <span className="min-w-0">{actionLabel}</span>{!unavailable && <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />}
          </Button>
          {isPaid && !canOpen && <p className="text-xs leading-relaxed text-muted-foreground">Für kostenpflichtige Kurse ist eine separate Buchung erforderlich.</p>}
          {isFull && !isPaid && !canOpen && <p className="text-xs leading-relaxed text-muted-foreground">Alle Plätze sind derzeit vergeben.</p>}
          {course.isEnrolled && !course.completed && !course.everCompleted && !isPaid && !course.canDelete && <Button type="button" variant="ghost" className="w-full" onClick={onLeave} disabled={pending}>Kurs verlassen</Button>}
        </div>
      </div>
      {canManageRewards && <div className="mt-5 min-w-0 rounded-2xl border bg-card p-4 sm:ml-32 sm:flex sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0"><p className="text-sm font-semibold">Kursbelohnungen</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Nur freigeben, wenn ein gültiges Quiz gespeichert ist. Punkte zählen erst bei einem bestandenen Versuch für die aktuelle Kursversion.</p></div>
        {course.rewardEligible ? <AlertDialog>
          <AlertDialogTrigger asChild><Button type="button" variant="outline" size="sm" className="mt-3 shrink-0 sm:mt-0" disabled={rewardPending}>Freigabe widerrufen</Button></AlertDialogTrigger>
          <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Belohnungsfreigabe widerrufen?</AlertDialogTitle><AlertDialogDescription>Dieser Kurs zählt dann nicht mehr für Kursbelohnungen. Bereits vergebene Belohnungen können sich ändern.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Abbrechen</AlertDialogCancel><AlertDialogAction onClick={() => onRewardEligibilityChange(false)}>Freigabe widerrufen</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
        </AlertDialog> : <Button type="button" variant="outline" size="sm" className="mt-3 shrink-0 sm:mt-0" disabled={rewardPending} onClick={() => onRewardEligibilityChange(true)}>Für Belohnungen freigeben</Button>}
      </div>}
    </article>
  );
}
