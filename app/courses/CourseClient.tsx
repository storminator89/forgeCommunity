'use client'

import { PageState, LoadingScreen, RetryButton } from '@/components/page-state';
import { HeroBanner, PageContainer } from '@/components/discovery';
import { GraduationCap } from 'lucide-react';
import { AppShell, AppHeader } from '@/components/app-shell';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useSession } from '@/lib/sites-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from "@/components/ui/button";
import { UserNav } from "@/components/user-nav";
import { Sidebar } from "@/components/Sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, BookOpen, CalendarDays, ChevronDown, Clock3, Plus, Search, Trash2, Users } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';
import { canSeeLearnerPathways } from '@/lib/pathway-visibility';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { CourseGoalSummary } from './CourseGoalSummary';
import { readJourneyCourses } from './journey/journey-trail-data';
import { COURSE_SEARCH_LIMIT, courseCatalogHref, readCourseCatalogFilters, type CourseCatalogFilters } from './course-catalog-filters';

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

// Next's native-history adapter must see an external call to notify its
// search hooks. It restores its own __NA/tree metadata before the write.
// Vinext's distinct metadata and all unrelated caller fields remain intact.
function externalCatalogHistoryState() {
  const state: Record<string, unknown> = { ...window.history.state };
  if (state.__NA === true && '__PRIVATE_NEXTJS_INTERNALS_TREE' in state) {
    delete state.__NA;
    delete state._N;
  }
  return state;
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
  return <ScopedCourseClient key={JSON.stringify([session.user.id, session.user.role])} session={session} />;
}

function ScopedCourseClient({ session }: { session: NonNullable<ReturnType<typeof useSession>['data']> }) {
  const [filters, setFilters] = useState<CourseCatalogFilters>({ q: '', category: 'Alle', mine: false });
  const [filterUiReady, setFilterUiReady] = useState(false);
  const navigationSearch = useSearchParams().toString();
  const { q: searchTerm, category: categoryFilter } = filters;
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
  const catalogPathRef = useRef(typeof window === 'undefined' ? null : window.location.pathname);
  const ownedUrlRef = useRef<{ href: string; categoryKey: string } | null>(null);
  const pendingPopstateSyncRef = useRef(false);
  // All authenticated accounts can create courses. The role only changes
  // the suggested next step; it is not an additional authorization rule.
  const creatorPerspective = session.user.role === 'ADMIN' || session.user.role === 'INSTRUCTOR';
  const categoryKey = JSON.stringify(Array.from(new Set(courses.map(course => course.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'de')));
  // Enrollment/progress mutations do not change category membership or reset
  // an exact local selection whose ambiguous token was deliberately omitted.
  const categories = useMemo(() => JSON.parse(categoryKey) as string[], [categoryKey]);
  const mineOnly = filters.mine;
  const catalogUiReady = !isLoading && !loadError && filterUiReady;

  useEffect(() => {
    const restoreFilters = () => {
      if (window.location.pathname !== catalogPathRef.current) return;
      ownedUrlRef.current = null;
      const restored = readCourseCatalogFilters(window.location.search, categories);
      setFilters(restored);
      // Only a successful full catalog can validate category lookup tokens.
      // Never turn a loading/error response into an enrollment-empty state.
      if (!isLoading && !loadError) {
        const href = courseCatalogHref(window.location.href, restored, categories);
        if (pendingPopstateSyncRef.current || href !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
          // A retained router snapshot can skip updating its search cache on
          // Back/Forward. Refresh it once, after full category validation.
          pendingPopstateSyncRef.current = false;
          ownedUrlRef.current = { href: new URL(href, window.location.href).href, categoryKey };
          window.history.replaceState(externalCatalogHistoryState(), '', href);
        }
        setFilterUiReady(true);
      }
    };
    // Framework query changes include same-route Sidebar/Link navigation.
    // An echo of our own history write must retain an exact local category
    // whose ambiguous lookup token was deliberately omitted from the URL.
    if (ownedUrlRef.current?.href !== window.location.href || ownedUrlRef.current.categoryKey !== categoryKey) restoreFilters();
    const restoreOnPopstate = () => {
      if (window.location.pathname !== catalogPathRef.current) return;
      // Keep this pending through loading/errors until restoration is safe.
      pendingPopstateSyncRef.current = true;
      restoreFilters();
    };
    window.addEventListener('popstate', restoreOnPopstate);
    return () => window.removeEventListener('popstate', restoreOnPopstate);
  }, [categories, categoryKey, isLoading, loadError, navigationSearch]);

  const changeFilters = (next: CourseCatalogFilters, mode: 'push' | 'replace' = 'push') => {
    if (!catalogUiReady || window.location.pathname !== catalogPathRef.current) return;
    setFilters(next);
    const href = courseCatalogHref(window.location.href, next, categories);
    if (href === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
    // Native same-document history keeps search typing local: no navigation,
    // catalog refetch or next-step detail selection change.
    ownedUrlRef.current = { href: new URL(href, window.location.href).href, categoryKey };
    if (mode === 'replace') window.history.replaceState(externalCatalogHistoryState(), '', href);
    else window.history.pushState(externalCatalogHistoryState(), '', href);
  };

  useEffect(() => {
    activeRef.current = true;
    const controller = new AbortController();
    const fetchCourses = async () => {
      try {
        const response = await fetch('/api/courses', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) {
          throw new Error('Failed to fetch courses');
        }
        const data: unknown = await response.json();
        // Reject an unusable list before the existing catalog maps or renders it.
        // The shared allowlist also protects the next-step selection metadata.
        readJourneyCourses(data);
        if (!Array.isArray(data) || data.some(course =>
          typeof course.instructor !== 'string' || typeof course.duration !== 'string' || typeof course.category !== 'string' ||
          (course.startDate !== null && typeof course.startDate !== 'string') || (course.endDate !== null && typeof course.endDate !== 'string') ||
          typeof course.participants !== 'number' || !Number.isFinite(course.participants) ||
          (course.maxStudents !== null && (typeof course.maxStudents !== 'number' || !Number.isFinite(course.maxStudents))) ||
          (course.price !== null && (typeof course.price !== 'number' || !Number.isFinite(course.price))) ||
          (course.currency !== null && typeof course.currency !== 'string') || (course.imageUrl !== null && typeof course.imageUrl !== 'string')
        )) throw new Error('Invalid course list');
        if (activeRef.current && !controller.signal.aborted) setCourses(data as Course[]);
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

  const query = searchTerm.trim().toLocaleLowerCase('de');
  const filteredCourses = courses.filter(course =>
    (course.title.toLocaleLowerCase('de').includes(query) || course.instructor.toLocaleLowerCase('de').includes(query)) &&
    (categoryFilter === 'Alle' || course.category === categoryFilter) &&
    (!mineOnly || course.isEnrolled === true)
  );
  const hasFilters = Boolean(searchTerm) || categoryFilter !== 'Alle' || mineOnly;
  const hasEnrollments = courses.some(course => course.isEnrolled === true);
  const resetFilters = () => {
    if (!catalogUiReady || window.location.pathname !== catalogPathRef.current) return;
    changeFilters({ q: '', category: 'Alle', mine: false });
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
          <div className="app-header-row">
            <h1 className="app-header-title">Kurse</h1>
            <div className="app-header-actions"><ThemeToggle /><UserNav /></div>
          </div>
        </AppHeader>
        <main id="page-content" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto">
          <PageContainer>
            <HeroBanner icon={GraduationCap} title="Wissen teilen. Neues lernen." description="Finde deinen nächsten Kurs und wachse mit der Community." action={creatorPerspective ? <Button asChild><Link href="/courses/new"><Plus className="h-4 w-4" aria-hidden="true" />Neuer Kurs</Link></Button> : undefined} />
            <CourseGoalSummary key={JSON.stringify([session.user.id, session.user.role])} actorKey={JSON.stringify([session.user.id, session.user.role])} learner={session.user.role === 'USER'} courses={courses} isLoading={isLoading} loadError={loadError} />
            <section aria-labelledby="course-directory-title" className="min-w-0">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 id="course-directory-title" className="text-xl font-semibold tracking-tight">Kursübersicht</h2>
                  {catalogUiReady && <p role="status" aria-live="polite" className="mt-1 text-sm text-muted-foreground">{filteredCourses.length} {filteredCourses.length === 1 ? 'Kurs' : 'Kurse'} {hasFilters ? 'gefunden' : 'verfügbar'}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {catalogUiReady && hasFilters && filteredCourses.length > 0 && <Button type="button" variant="ghost" onClick={resetFilters}>Filter zurücksetzen</Button>}

                </div>
              </div>
              <div role="group" aria-label="Kursauswahl" className="mt-4 flex flex-wrap gap-2">
                <Button type="button" variant={mineOnly ? 'outline' : 'default'} aria-pressed={!mineOnly} disabled={!catalogUiReady} className="min-h-11" onClick={() => changeFilters({ ...filters, mine: false })}>Alle Kurse</Button>
                <Button type="button" variant={mineOnly ? 'default' : 'outline'} aria-pressed={mineOnly} disabled={!catalogUiReady} className="min-h-11" onClick={() => changeFilters({ ...filters, mine: true })}>Meine Kurse</Button>
              </div>
              <div className="fc-filter-bar fc-filter-surface mt-4 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end">
                <div className="min-w-0">
                  <label htmlFor="course-search" className="mb-1.5 block text-sm font-medium">Kurse suchen</label>
                  <div className="relative">
                    <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input ref={searchRef} id="course-search" aria-label="Suche nach Kursen oder Dozenten" type="search" placeholder="Titel oder Lehrkraft" value={searchTerm} disabled={!catalogUiReady} maxLength={COURSE_SEARCH_LIMIT} onChange={event => changeFilters({ ...filters, q: event.target.value }, 'replace')} className="pl-10" />
                  </div>
                </div>
                <div className="min-w-0">
                  <label id="course-category-label" className="mb-1.5 block text-sm font-medium">Kategorie</label>
                  <Select value={categoryFilter} disabled={!catalogUiReady} onValueChange={category => changeFilters({ ...filters, category })}>
                    <SelectTrigger aria-label="Kategorie wählen" aria-labelledby="course-category-label" className="h-11 w-full rounded-xl"><SelectValue placeholder="Kategorie wählen" /></SelectTrigger>
                    <SelectContent><SelectItem value="Alle">Alle Kategorien</SelectItem>{categories.map(category => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <nav aria-label="Weitere Kursbereiche" className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                {session.user.role === 'USER' && <Link href="/courses/journey" className="inline-flex min-h-11 items-center rounded-sm text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">Mein Lernweg</Link>}
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="ghost" className="px-2">Kursbereiche<ChevronDown aria-hidden="true" className="h-4 w-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent aria-label="Kursbereiche" align="end" collisionPadding={16} className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-56 max-w-[calc(100vw-2rem)] overflow-y-auto motion-reduce:animate-none">
                    {canSeeLearnerPathways(session.user.role) && <DropdownMenuItem asChild className="min-h-11"><Link href="/courses/pathways">Lernpfade</Link></DropdownMenuItem>}
                    <DropdownMenuItem asChild className="min-h-11"><Link href="/courses/goals">Mein Lernziel</Link></DropdownMenuItem>
                    <DropdownMenuItem asChild className="min-h-11"><Link href="/courses/authoring">Meine Kursentwürfe</Link></DropdownMenuItem>
                    {!creatorPerspective && <DropdownMenuItem asChild className="min-h-11"><Link href="/courses/new">Neuer Kurs</Link></DropdownMenuItem>}
                  </DropdownMenuContent>
                </DropdownMenu>
              </nav>
              <div className="mt-5">
                {!loadError && (isLoading || !filterUiReady) && <PageState kind="loading" title="Kurse werden geladen" />}
                {loadError && <PageState kind="error" title="Kurse konnten nicht geladen werden" description="Prüfe deine Verbindung und versuche es erneut." action={<RetryButton onClick={() => window.location.reload()} />} />}
                {catalogUiReady && filteredCourses.length === 0 && <PageState
                  title={mineOnly && !hasEnrollments ? 'Noch keine Kursanmeldung' : courses.length === 0 ? 'Noch keine Kurse' : 'Keine Kurse gefunden'}
                  description={mineOnly
                    ? hasEnrollments ? 'Ändere deine Suche oder setze die Filter zurück.' : 'Du bist aktuell zu keinem Kurs angemeldet.'
                    : courses.length === 0
                    ? creatorPerspective
                      ? 'Erstelle den ersten Kurs und teile dein Wissen mit der Community.'
                      : 'Hier sind aktuell keine Kurse verfügbar. Tausche dich in der Community aus oder sieh in der Veranstaltungsübersicht nach.'
                    : 'Versuche andere Suchbegriffe oder setze die Filter zurück.'}
                  action={<div className="flex w-full flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
                    {!mineOnly && courses.length === 0 && (creatorPerspective
                      ? <Button asChild><Link href="/courses/new">Kurs erstellen</Link></Button>
                      : <>
                        <Button asChild><Link href="/community">Zur Community</Link></Button>
                        <Button asChild variant="outline"><Link href="/events">Veranstaltungen ansehen</Link></Button>
                      </>)}
                    {hasFilters && <Button type="button" variant="outline" onClick={resetFilters}>{mineOnly && !hasEnrollments ? 'Alle Kurse ansehen' : 'Filter zurücksetzen'}</Button>}
                  </div>}
                />}
                {catalogUiReady && filteredCourses.length > 0 && <div className="fc-entity-list" role="list" aria-label="Kurse">
                  {filteredCourses.map(course => <CourseRow key={course.id} course={course}
                    onDelete={() => void handleDeleteCourse(course.id)} deleting={deletingCourseId === course.id}
                    onJoin={() => void changeEnrollment(course)} onLeave={() => void changeEnrollment(course, true)} pending={pendingCourseId === course.id}
                    canManageRewards={session.user.role === 'ADMIN' && course.canApproveRewards === true} rewardPending={rewardPendingCourseId === course.id}
                    onRewardEligibilityChange={eligible => void updateRewardEligibility(course, eligible)} />)}
                </div>}
              </div>
            </section>
          </PageContainer>
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
    <article role="listitem" className="fc-entity-card">
      <div className="grid min-w-0 gap-4 sm:grid-cols-[112px_minmax(0,1fr)] lg:grid-cols-[112px_minmax(0,1fr)_minmax(180px,240px)] lg:gap-6">
        <div className="relative hidden h-28 overflow-hidden rounded-2xl border bg-secondary sm:block">
          {course.imageUrl ? <Image src={course.imageUrl} alt="" fill sizes="112px" unoptimized={course.imageUrl.startsWith('/api/courses/')} className="object-cover" /> : <div className="flex h-full items-center justify-center text-muted-foreground"><BookOpen aria-hidden="true" className="h-8 w-8" /></div>}
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground [overflow-wrap:anywhere]">{course.category}</p>
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
