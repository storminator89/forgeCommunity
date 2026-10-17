"use client";

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: editorial · macrostructure: member profile and activity · design-system: design.md · designed-as-app */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useSession } from '@/lib/sites-auth/react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { ArrowUp, Award, Calendar, Github, Globe, Linkedin, Mail, MessageSquare, Settings, Star, Twitter } from 'lucide-react';
import { toast } from 'react-toastify';
import { AppHeader, AppShell } from '@/components/app-shell';
import { PageState } from '@/components/page-state';
import { Sidebar } from '@/components/Sidebar';
import { UserNav } from '@/components/user-nav';
import { ThemeToggle } from '@/components/theme-toggle';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProfileEditor } from '@/components/profile/ProfileEditor';
import { ActivityFeed } from '@/components/profile/ActivityFeed';
import { ProjectsList } from '@/components/profile/ProjectsList';
import { FollowButton } from '@/components/profile/FollowButton';
import { FollowersList } from '@/components/profile/FollowersList';
import { getSafeHttpUrl, getSafeNavigationUrl } from '@/lib/security';
import { VERIFIED_COURSE_BADGE } from '@/lib/course-achievement-badge';
import type { SocialLinks, User as UserType } from '@/types';

type Profile = Omit<UserType, 'email'> & { email?: string; hasEndorsed?: boolean };
type LoadState = 'loading' | 'ready' | 'missing' | 'unauthorized' | 'error';

const socialDestinations = [
  { key: 'github', label: 'GitHub', Icon: Github },
  { key: 'linkedin', label: 'LinkedIn', Icon: Linkedin },
  { key: 'twitter', label: 'Twitter', Icon: Twitter },
  { key: 'website', label: 'Website', Icon: Globe },
] as const satisfies ReadonlyArray<{ key: keyof SocialLinks; label: string; Icon: typeof Github }>;

const roleLabels: Record<Profile['role'], string> = {
  USER: 'Mitglied',
  ADMIN: 'Administration',
  MODERATOR: 'Moderation',
  INSTRUCTOR: 'Lehrperson',
};

export default function ProfilePage() {
  const { id: profileId } = useParams<{ id: string }>();
  const { data: session, status } = useSession();
  const accountId = status === 'authenticated' ? session?.user?.id ?? null : null;
  // Profile responses include owner-only fields. Remount before another
  // account can see a cached owner response or edit state.
  return <AccountProfilePage key={`${profileId}:${accountId ?? 'anonymous'}`} profileId={profileId} accountId={accountId} status={status} />;
}

function AccountProfilePage({ profileId, accountId, status }: { profileId: string; accountId: string | null; status: 'loading' | 'authenticated' | 'unauthenticated' }) {
  const mainRef = useRef<HTMLElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [retryKey, setRetryKey] = useState(0);
  const [activeTab, setActiveTab] = useState('overview');
  const [isEditing, setIsEditing] = useState(false);
  const [isEndorsing, setIsEndorsing] = useState(false);
  const [hasEndorsed, setHasEndorsed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoadState('loading');
      setProfile(null);
      setHasEndorsed(false);
      setActionError(null);

      if (!profileId) {
        setLoadState('missing');
        return;
      }

      const encodedId = encodeURIComponent(profileId);
      void Promise.all([
        fetch(`/api/users/${encodedId}`, { credentials: 'include', signal: controller.signal }),
        fetch(`/api/users/${encodedId}/social`, { credentials: 'include', signal: controller.signal }).catch(() => null),
      ]).then(async ([response, socialResponse]) => {
        if (response.status === 404) { setLoadState('missing'); return; }
        if (response.status === 401) { setLoadState('unauthorized'); return; }
        if (!response.ok) throw new Error('Profil konnte nicht geladen werden');

        const data = await response.json() as Profile;
        if (socialResponse?.ok) {
          const socialData = await socialResponse.json() as { socialLinks?: SocialLinks };
          data.socialLinks = socialData.socialLinks ?? data.socialLinks;
        }
        if (controller.signal.aborted) return;
        setProfile(data);
        setHasEndorsed(Boolean(data.hasEndorsed));
        setLoadState('ready');
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error('Error fetching profile:', error);
        setLoadState('error');
      });
    }, 0);

    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [profileId, retryKey, accountId]);

  const handleProfileUpdate = (data: Partial<Profile>) => {
    setProfile(previous => previous ? { ...previous, ...data } : null);
    setIsEditing(false);
  };

  const handleEndorseProfile = async () => {
    if (!profile || profile.isCurrentUser || hasEndorsed || isEndorsing) return;
    if (!accountId) {
      setActionError('Bitte melde dich an, um dieses Profil zu empfehlen.');
      return;
    }
    setActionError(null);
    setIsEndorsing(true);
    try {
      const response = await fetch(`/api/members/${encodeURIComponent(profile.id)}/endorse`, {
        method: 'POST', credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Profil konnte nicht empfohlen werden.');
      setProfile(previous => previous ? { ...previous, endorsements: previous.endorsements + 1 } : null);
      setHasEndorsed(true);
      toast.success('Profil erfolgreich empfohlen');
    } catch (error) {
      console.error('Error endorsing profile:', error);
      setActionError(error instanceof Error ? error.message : 'Profil konnte nicht empfohlen werden.');
    } finally {
      setIsEndorsing(false);
    }
  };

  const ownProfile = Boolean(accountId && profile?.id === accountId);
  const visibleProfile = status === 'authenticated' && loadState === 'ready' && profile?.id === profileId
    ? { ...profile, isCurrentUser: ownProfile, email: ownProfile ? profile.email : undefined, lastLogin: ownProfile ? profile.lastLogin : null }
    : null;
  const safeCoverImage = getSafeNavigationUrl(visibleProfile?.coverImage);
  const availableSocialLinks = socialDestinations.flatMap(({ key, label, Icon }) => {
    const href = getSafeHttpUrl(visibleProfile?.socialLinks?.[key]);
    return href ? [{ key, label, Icon, href }] : [];
  });
  const hasExpertise = Boolean(visibleProfile?.teachingLanguages?.length || visibleProfile?.expertise?.length);

  return (
    <AppShell data-page-family="profile">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="app-header-row">
            <span className="app-header-title text-sm font-semibold">Profil</span>
            <div className="app-header-actions"><ThemeToggle /><UserNav /></div>
          </div>
        </AppHeader>
        <main id="page-content" tabIndex={-1} ref={mainRef} onScroll={event => setShowBackToTop(event.currentTarget.scrollTop > 500)} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
            {!visibleProfile ? (
              <>
                <h1 className="sr-only">Profil</h1>
                {status === 'loading' || (accountId && (loadState === 'loading' || loadState === 'ready')) ? (
                  <PageState kind="loading" title="Profil wird geladen" />
                ) : loadState === 'missing' ? (
                  <PageState title="Profil nicht gefunden" description="Das angeforderte Mitgliedsprofil ist nicht verfügbar." action={<Button asChild variant="outline"><Link href="/members">Zu den Mitgliedern</Link></Button>} />
                ) : !accountId || loadState === 'unauthorized' ? (
                  <PageState kind="error" title="Anmeldung erforderlich" description="Melde dich an, um dieses Profil zu sehen." action={<Button asChild><Link href={`/login?callbackUrl=${encodeURIComponent(`/profile/${encodeURIComponent(profileId)}`)}`}>Zur Anmeldung</Link></Button>} />
                ) : (
                  <PageState kind="error" title="Profil konnte nicht geladen werden" description="Prüfe deine Verbindung und versuche es erneut." action={<Button variant="outline" onClick={() => setRetryKey(value => value + 1)}>Erneut versuchen</Button>} />
                )}
              </>
            ) : (
              <>
                {safeCoverImage && <div className="mt-5 h-32 overflow-hidden rounded-[14px] bg-muted bg-cover bg-center sm:h-44" style={{ backgroundImage: `url("${safeCoverImage.replaceAll('"', '%22')}")` }} role="img" aria-label="Titelbild" />}
                <header className="fc-detail-header mt-6 flex min-w-0 flex-wrap items-start justify-between gap-6">
                  <div className="flex min-w-0 flex-wrap items-start gap-5">
                    <Avatar className="h-20 w-20 shrink-0 border-2 border-background sm:h-24 sm:w-24">
                      <AvatarImage src={visibleProfile.image || undefined} alt="" />
                      <AvatarFallback>{visibleProfile.name?.slice(0, 2).toUpperCase() || 'M'}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <h1 className="min-w-0 break-words text-[clamp(1.65rem,1.1rem+2vw,2.35rem)] font-semibold leading-tight tracking-tight [overflow-wrap:anywhere]">{visibleProfile.name || 'Unbenanntes Mitglied'}</h1>
                        <Badge variant="secondary">{roleLabels[visibleProfile.role]}</Badge>
                      </div>
                      {visibleProfile.title && <p className="mt-2 break-words text-base text-muted-foreground [overflow-wrap:anywhere]">{visibleProfile.title}</p>}
                      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-2"><Calendar className="h-4 w-4 shrink-0" aria-hidden="true" />Mitglied seit {format(new Date(visibleProfile.createdAt), 'MMMM yyyy', { locale: de })}</span>
                        {visibleProfile.contact && <span className="inline-flex min-w-0 items-center gap-2 break-all"><Mail className="h-4 w-4 shrink-0" aria-hidden="true" />{visibleProfile.contact}</span>}
                        {visibleProfile.isCurrentUser && visibleProfile.lastLogin && <span>Zuletzt angemeldet: {format(new Date(visibleProfile.lastLogin), 'dd.MM.yyyy HH:mm', { locale: de })}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                    {visibleProfile.isCurrentUser ? (
                      <Button type="button" variant="outline" onClick={() => setIsEditing(value => !value)}><Settings className="h-4 w-4" aria-hidden="true" />{isEditing ? 'Bearbeitung schließen' : 'Profil bearbeiten'}</Button>
                    ) : (
                      <>
                        <FollowButton key={visibleProfile.id} userId={visibleProfile.id} initialIsFollowing={!!visibleProfile.isFollowing} userName={visibleProfile.name || 'diesem Mitglied'} onFollowChange={isFollowing => setProfile(previous => previous ? { ...previous, isFollowing, stats: { ...previous.stats, followers: previous.stats.followers + (isFollowing ? 1 : -1) } } : null)} />
                        <Button asChild variant="outline"><Link href="/chat"><MessageSquare className="h-4 w-4" aria-hidden="true" />Chat öffnen</Link></Button>
                      </>
                    )}
                  </div>
                </header>

                {actionError && <p role="alert" className="mt-5 rounded-[10px] border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{actionError} {!accountId && <Link href="/login" className="font-semibold underline underline-offset-2">Zur Anmeldung</Link>}</p>}

                <section aria-label="Profilzahlen" className="fc-section-card my-5 grid grid-cols-2 sm:grid-cols-4">
                  <div className="min-w-0 border-r p-2 sm:p-3"><FollowersList userId={visibleProfile.id} count={visibleProfile.stats.followers} type="followers" /></div>
                  <div className="min-w-0 p-2 sm:border-r sm:p-3"><FollowersList userId={visibleProfile.id} count={visibleProfile.stats.following} type="following" /></div>
                  <div className="min-w-0 border-r border-t p-3 sm:border-t-0"><p className="text-2xl font-semibold tabular-nums">{visibleProfile.endorsements}</p><p className="text-sm text-muted-foreground">Empfehlungen</p>{!visibleProfile.isCurrentUser && <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={() => void handleEndorseProfile()} disabled={isEndorsing || hasEndorsed}><Star className="h-4 w-4" aria-hidden="true" />{hasEndorsed ? 'Bereits empfohlen' : isEndorsing ? 'Wird empfohlen…' : 'Empfehlen'}</Button>}</div>
                  <div className="min-w-0 border-t p-3 sm:border-t-0"><p className="text-2xl font-semibold tabular-nums">{visibleProfile.stats.projects}</p><p className="text-sm text-muted-foreground">Projekte</p></div>
                </section>

                {availableSocialLinks.length > 0 && <section aria-label="Externe Profile" className="flex flex-wrap gap-2 border-b py-5">{availableSocialLinks.map(({ key, label, Icon, href }) => <Button key={key} asChild variant="outline" size="sm"><a href={href} target="_blank" rel="noopener noreferrer"><Icon className="h-4 w-4" aria-hidden="true" />{label}<span className="sr-only">(öffnet in neuem Tab)</span></a></Button>)}</section>}

                {visibleProfile.isCurrentUser && isEditing && <ProfileEditor profile={visibleProfile} onUpdate={handleProfileUpdate} />}

                <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-8">
                  <TabsList aria-label="Profilbereiche" className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-none border-b bg-transparent p-0">
                    <TabsTrigger value="overview" className="min-h-11">Übersicht</TabsTrigger>
                    <TabsTrigger value="activity" className="min-h-11">Aktivität {visibleProfile.stats.posts > 0 && <span className="tabular-nums text-muted-foreground">{visibleProfile.stats.posts}</span>}</TabsTrigger>
                    <TabsTrigger value="projects" className="min-h-11">Projekte {visibleProfile.stats.projects > 0 && <span className="tabular-nums text-muted-foreground">{visibleProfile.stats.projects}</span>}</TabsTrigger>
                  </TabsList>
                  <TabsContent value="overview" className="pt-6">
                    <div className="grid min-w-0 gap-x-10 gap-y-8 md:grid-cols-2">
                      <section aria-labelledby="profile-bio-title" className="fc-section-card">
                        <h2 id="profile-bio-title" className="text-xl font-semibold tracking-tight">Über mich</h2>
                        <p className="mt-4 whitespace-pre-wrap break-words text-base leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{visibleProfile.bio || 'Noch keine Biografie vorhanden.'}</p>
                      </section>
                      <section aria-labelledby="profile-skills-title" className="fc-section-card">
                        <h2 id="profile-skills-title" className="text-xl font-semibold tracking-tight">Skills</h2><p className="mt-1 text-xs text-muted-foreground">Kenntnisstände sind Selbsteinschätzungen.</p>
                        {visibleProfile.skills.length === 0 ? <div className="mt-4 space-y-3"><p className="text-base text-muted-foreground">Noch keine Skills vorhanden.</p>{visibleProfile.isCurrentUser && <Button asChild variant="outline"><Link href="/settings?tab=skills">Fähigkeiten ergänzen</Link></Button>}</div> : <ul className="mt-4 divide-y">{visibleProfile.skills.map(skill => <li key={skill.id} className="py-3 first:pt-0"><div className="flex flex-wrap items-baseline justify-between gap-2"><span className="min-w-0 break-words font-medium">{skill.name}</span><span className="text-sm text-muted-foreground">{skill.endorsements} Empfehlungen</span></div><p className="mt-2 text-xs tabular-nums text-muted-foreground">Selbsteinschätzung {skill.level}%</p><Progress value={Math.max(0, Math.min(100, skill.level))} className="mt-2 h-2" aria-label={`${skill.name}: ${skill.level} Prozent`} /></li>)}</ul>}
                      </section>
                      {visibleProfile.badges.length > 0 && <section aria-labelledby="profile-achievements-title" className="fc-section-card md:col-span-2">
                        <h2 id="profile-achievements-title" className="text-xl font-semibold tracking-tight">Auszeichnungen</h2>
                        <ul className="mt-4 divide-y border-y">{visibleProfile.badges.map(badge => {
                          const awardedAt = new Date(badge.awardedAt);
                          return <li key={badge.id} className="flex min-w-0 items-start gap-3 py-4">
                            <Award aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-reward-ink" />
                            <div className="min-w-0">
                              <p className="break-words font-medium">{badge.name}</p>
                              <p className="mt-1 break-words text-sm text-muted-foreground">{badge.description}</p>
                              {Number.isFinite(awardedAt.getTime()) && <time dateTime={awardedAt.toISOString()} className="mt-1 block text-xs text-muted-foreground">Erhalten am {format(awardedAt, 'dd.MM.yyyy', { locale: de })}</time>}
                            </div>
                          </li>;
                        })}</ul>
                        {visibleProfile.isCurrentUser && visibleProfile.badges.some(badge => badge.badgeId === VERIFIED_COURSE_BADGE.id) && <p className="mt-3 text-sm text-muted-foreground">Deine Lern-Auszeichnung sehen andere nur, wenn du der öffentlichen Rangliste zustimmst. <Link href="/settings" className="text-primary underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">Sichtbarkeit einstellen</Link></p>}
                      </section>}
                      {visibleProfile.role === 'INSTRUCTOR' && hasExpertise && <section aria-labelledby="profile-expertise-title" className="fc-section-card md:col-span-2"><h2 id="profile-expertise-title" className="text-xl font-semibold tracking-tight">Expertise</h2><div className="mt-4 grid gap-5 sm:grid-cols-2"><div><h3 className="font-medium">Unterrichtssprachen</h3><div className="mt-2 flex flex-wrap gap-2">{visibleProfile.teachingLanguages?.length ? visibleProfile.teachingLanguages.map(language => <Badge key={language} variant="secondary">{language}</Badge>) : <p className="text-sm text-muted-foreground">Keine angegeben</p>}</div></div><div><h3 className="font-medium">Fachgebiete</h3><div className="mt-2 flex flex-wrap gap-2">{visibleProfile.expertise?.length ? visibleProfile.expertise.map(subject => <Badge key={subject} variant="secondary">{subject}</Badge>) : <p className="text-sm text-muted-foreground">Keine angegeben</p>}</div></div></div></section>}
                    </div>
                  </TabsContent>
                  <TabsContent value="activity" className="pt-6"><ActivityFeed userId={visibleProfile.id} /></TabsContent>
                  <TabsContent value="projects" className="pt-6"><ProjectsList userId={visibleProfile.id} isOwner={!!visibleProfile.isCurrentUser} /></TabsContent>
                </Tabs>
              </>
            )}
          </div>
          {showBackToTop && <Button type="button" variant="outline" size="icon" className="fixed bottom-4 right-4 z-40 bg-background shadow-xs" aria-label="Zurück nach oben" onClick={() => mainRef.current?.scrollTo({ top: 0, behavior: 'auto' })}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>}
        </main>
      </div>
    </AppShell>
  );
}
