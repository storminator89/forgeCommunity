'use client';

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 */
/* Hallmark · genre: editorial · macrostructure: administration ledger · design-system: design.md · designed-as-app */

import { useEffect, useState, type ComponentProps, type ElementType } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { ArrowUpRight, BookOpen, Calendar, MessageSquare, RefreshCw, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageState } from '@/components/page-state';
import { RecentActivity } from '@/components/admin/RecentActivity';

interface DashboardStats {
  totalUsers: number;
  totalCourses: number;
  totalEvents: number;
  totalPosts: number;
  activities: NonNullable<ComponentProps<typeof RecentActivity>['activities']>;
}

const metrics: {
  key: keyof Omit<DashboardStats, 'activities'>;
  title: string;
  icon: ElementType;
  href: string;
}[] = [
  { key: 'totalUsers', title: 'Benutzer', icon: Users, href: '/admin/users' },
  { key: 'totalCourses', title: 'Kurse', icon: BookOpen, href: '/courses' },
  { key: 'totalEvents', title: 'Events', icon: Calendar, href: '/events' },
  { key: 'totalPosts', title: 'Beiträge', icon: MessageSquare, href: '/community' },
];

export default function AdminDashboard() {
  const { data: session, status } = useSession();
  const isAdmin = session?.user.role === 'ADMIN';
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    if (!isAdmin || status === 'loading') return;

    const controller = new AbortController();
    let active = true;

    async function fetchStats() {
      setIsLoading(true);
      setError(null);
      setStats(null);
      try {
        const response = await fetch('/api/admin/dashboard-stats', { signal: controller.signal });
        if (!response.ok) throw new Error('Failed to fetch dashboard stats');
        const data: DashboardStats = await response.json();
        if (active) setStats(data);
      } catch (error) {
        if (active) {
          setError('Fehler beim Laden der Dashboard-Daten. Bitte versuche es erneut.');
          console.error('Error fetching dashboard stats:', error);
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void fetchStats();
    return () => {
      active = false;
      controller.abort();
    };
  }, [isAdmin, status, requestVersion]);

  if (status === 'loading') {
    return <PageState kind="loading" title="Berechtigung wird geprüft" />;
  }

  if (!isAdmin) {
    return <PageState kind="error" title="Du hast keine Berechtigung für diese Seite." description="Dieses Dashboard ist nur für Administratoren zugänglich." />;
  }

  const refresh = () => {
    if (!isLoading) setRequestVersion(version => version + 1);
  };

  return (
    <div className="min-w-0 space-y-8">
      <header className="fc-detail-header flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-2">
          <h1 className="text-[clamp(1.65rem,1.1rem+2vw,2.35rem)] font-semibold tracking-tight">Dashboard</h1>

        </div>
        <Button variant="outline" onClick={refresh} disabled={isLoading} aria-busy={isLoading} data-state={isLoading ? 'loading' : undefined} className="shrink-0">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {isLoading ? 'Wird geladen' : 'Aktualisieren'}
        </Button>
      </header>

      <section aria-labelledby="overview-heading" aria-busy={isLoading} className="min-w-0">
        <div className="mb-4 space-y-1">
          <h2 id="overview-heading" className="text-lg font-semibold tracking-tight">Community im Überblick</h2>

        </div>
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map(({ key, title, icon: Icon, href }) => (
            <Link
              key={key}
              href={href}
              aria-label={`${title} öffnen`}
              aria-describedby={!isLoading ? `metric-${key}` : undefined}
              className="fc-section-card group min-w-0 transition-colors hover:bg-muted active:bg-accent focus-visible:z-10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <div className="flex items-center justify-between gap-3 text-sm font-medium">
                <span className="whitespace-nowrap">{title}</span>
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </div>
              {isLoading ? (
                <Skeleton className="my-3 h-10 w-24" aria-hidden="true" />
              ) : (
                <p id={`metric-${key}`} className="my-3 break-words text-3xl font-semibold tabular-nums tracking-tight">
                  <span className="sr-only">{title} insgesamt: </span>
                  {stats?.[key] !== undefined ? stats[key].toLocaleString('de-DE') : '—'}
                </p>
              )}
              <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm text-muted-foreground">
                Übersicht öffnen <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </span>
            </Link>
          ))}
        </div>
        <p role="status" className="sr-only">{isLoading ? 'Dashboard-Daten werden geladen.' : error ? 'Dashboard-Daten konnten nicht geladen werden.' : 'Dashboard-Daten wurden geladen.'}</p>
      </section>

      {error ? (
        <PageState kind="error" title="Dashboard-Daten konnten nicht geladen werden" description={error} action={<Button variant="outline" onClick={refresh}>Erneut versuchen</Button>} />
      ) : (
        <section aria-labelledby="activity-heading" aria-busy={isLoading} className="fc-section-card">
          <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
            <div className="min-w-0 space-y-1">
              <h2 id="activity-heading" className="text-lg font-semibold tracking-tight">Letzte Aktivitäten</h2>

            </div>
            {!isLoading && !!stats?.activities?.length && (
              <p className="shrink-0 text-sm tabular-nums text-muted-foreground">
                {stats.activities.length} {stats.activities.length === 1 ? 'Aktivität' : 'Aktivitäten'}
              </p>
            )}
          </div>
          {isLoading ? (
            <div aria-hidden="true" className="space-y-6">
              {[0, 1, 2].map(index => (
                <div key={index} className="flex min-w-0 items-start gap-3">
                  <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-32 max-w-full" />
                    <Skeleton className="h-4 w-64 max-w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : stats?.activities?.length ? (
            <RecentActivity activities={stats.activities} />
          ) : (
            <div role="status" className="rounded-2xl border border-dashed px-5 py-8">
              <MessageSquare className="mb-3 h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <p className="font-medium">Noch keine Aktivitäten</p>
              <p className="mt-1 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
                Sobald sich Benutzer registrieren oder neue Beiträge und Kurse entstehen, erscheinen sie hier.
              </p>
              <Button variant="outline" asChild className="mt-4"><Link href="/community">Zur Community</Link></Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
