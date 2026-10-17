'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { BookOpen, ChevronRight, Plus } from 'lucide-react'
import { AppHeader, AppShell } from '@/components/app-shell'
import { Sidebar } from '@/components/Sidebar'
import { UserNav } from '@/components/user-nav'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { LoadingScreen, PageState, RetryButton } from '@/components/page-state'
import { authorResponse, type ActivePublication } from '../[courseId]/contents/authoring-api'

interface AuthorCourseSummary {
  id: string
  title: string
  revision: number
  activePublication: ActivePublication | null
  hasUnpublishedChanges: boolean
}

export default function AuthorCoursesPage() {
  const { data: session, status } = useSession()
  if (status === 'loading') return <LoadingScreen />
  if (status !== 'authenticated' || !session?.user?.id) return <PageState kind="error" title="Bitte melde dich an" description="Deine privaten Kursentwürfe sind nur für dich sichtbar." />
  return <ScopedAuthorCourses key={session.user.id} />
}

function ScopedAuthorCourses() {
  const [courses, setCourses] = useState<AuthorCourseSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const load = async () => {
      try {
        const response = await fetch('/api/courses/authoring', { cache: 'no-store', signal: controller.signal })
        const data = await authorResponse<{ courses: AuthorCourseSummary[] }>(response, 'Deine Kursentwürfe konnten nicht geladen werden.')
        if (active && !controller.signal.aborted) setCourses(data.courses)
      } catch (cause) {
        if (active && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Deine Kursentwürfe konnten nicht geladen werden.')
      } finally {
        if (active && !controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => { active = false; controller.abort() }
  }, [retry])

  const retryLoad = () => { setLoading(true); setError(null); setRetry(value => value + 1) }

  return <AppShell data-page-family="authoring">
    <Sidebar />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <AppHeader><div className="app-header-row"><h1 className="app-header-title">Meine Kursentwürfe</h1><div className="app-header-actions"><ThemeToggle /><UserNav /></div></div></AppHeader>
      <main id="page-content" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto">
        <div className="fc-page-container mx-auto max-w-[1200px]">
          <Link href="/courses" className="inline-flex min-h-11 items-center text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:rounded-sm">← Zur Kursübersicht</Link>
          <div className="fc-detail-header mt-3 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0"><h2 className="text-[clamp(1.65rem,1.2rem+2vw,2.4rem)] font-semibold leading-tight tracking-tight">Deine Kurse und Entwürfe.</h2><p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">Hier findest du deine privat gespeicherten Entwürfe. Änderungen werden erst nach deiner ausdrücklichen Veröffentlichung für Lernende sichtbar.</p></div>
            <Button asChild className="w-full shrink-0 sm:w-auto"><Link href="/courses/new"><Plus aria-hidden="true" className="h-4 w-4" />Neuer Kursentwurf</Link></Button>
          </div>
          <section aria-labelledby="author-course-list-title" className="pt-7 sm:pt-9">
            <h2 id="author-course-list-title" className="text-xl font-semibold tracking-tight">Gespeicherte Kurse</h2>
            {loading && <div className="mt-5"><PageState kind="loading" title="Kursentwürfe werden geladen" /></div>}
            {!loading && error && <div className="mt-5"><PageState kind="error" title="Kursentwürfe konnten nicht geladen werden" description={error} action={<RetryButton onClick={retryLoad} />} /></div>}
            {!loading && !error && courses.length === 0 && <div className="mt-5"><PageState title="Noch keine Kursentwürfe" description="Lege deinen ersten privaten Kursentwurf an. Du entscheidest später selbst, wann er veröffentlicht wird." action={<Button asChild><Link href="/courses/new">Kursentwurf anlegen</Link></Button>} /></div>}
            {!loading && !error && courses.length > 0 && <div role="list" aria-label="Meine Kursentwürfe" className="fc-entity-list mt-5">
              {courses.map(course => <article role="listitem" key={course.id} className="fc-entity-card flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                <div className="flex min-w-0 gap-4"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground"><BookOpen aria-hidden="true" className="h-5 w-5" /></span><div className="min-w-0"><h3 className="text-base font-semibold [overflow-wrap:anywhere]">{course.title || 'Unbenannter Kurs'}</h3><div className="mt-2 flex flex-wrap items-center gap-2"><Badge variant="secondary">{course.activePublication ? course.hasUnpublishedChanges ? 'Unveröffentlichte Änderungen' : 'Veröffentlicht · aktuell' : 'Privater Entwurf'}</Badge>{course.activePublication && <span className="text-xs text-muted-foreground">Live-Version {course.activePublication.sequence}</span>}</div></div></div>
                <Button asChild variant="outline" className="w-full shrink-0 justify-between sm:w-auto"><Link href={`/courses/${encodeURIComponent(course.id)}/contents`}>Im Autorenarbeitsplatz öffnen<ChevronRight aria-hidden="true" className="h-4 w-4" /></Link></Button>
              </article>)}
            </div>}
          </section>
        </div>
      </main>
    </div>
  </AppShell>
}
