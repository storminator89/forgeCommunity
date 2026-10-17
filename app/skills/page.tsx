'use client';

import { HeroBanner } from '@/components/discovery';
import { Award as PageBannerIcon } from 'lucide-react';
import { AppShell, AppHeader } from '@/components/app-shell';
import { PageState } from '@/components/page-state';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useSession } from '@/lib/sites-auth/react';
import { toast, ToastContainer } from 'react-toastify';
import { SkillIcon } from '@/components/skills/skill-icons';
import { OwnSkillsWorkbench } from '@/components/skills/own-skills-workbench';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sidebar } from '@/components/Sidebar';
import { UserNav } from '@/components/user-nav';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';

interface Skill { id: string; name: string; category: string }
interface MemberSkill { skillName: string; level: number }
interface Member {
  id: string;
  name: string;
  avatar: string;
  title: string;
  endorsements: number;
  hasEndorsed: boolean;
  skills: MemberSkill[];
}
interface DirectoryResponse { skills: Skill[]; members: Member[] }

function browserSkillsView(): 'own' | 'community' {
  return new URLSearchParams(window.location.search).get('view') === 'mine' ? 'own' : 'community';
}

// The directory response includes viewer-specific endorsement flags. Remounting at
// the account boundary discards those flags, open details and in-flight UI state.
export default function SkillDirectory() {
  return <Suspense fallback={<PageState kind="loading" title="Skill-Verzeichnis wird geladen" />}><SkillDirectoryWithUrl /></Suspense>;
}

function SkillDirectoryWithUrl() {
  const searchParams = useSearchParams();
  const queryFromUrl = (searchParams.get('query') ?? '').slice(0, 120);
  const viewFromUrl = searchParams.get('view') === 'mine' ? 'own' : 'community';
  const { data: session, status } = useSession();
  const viewerId = status === 'authenticated' ? session?.user?.id ?? null : null;
  return <SkillDirectoryForViewer key={viewerId ?? status} viewerId={viewerId} sessionLoading={status === 'loading'} queryFromUrl={queryFromUrl} viewFromUrl={viewFromUrl} />;
}

function SkillDirectoryForViewer({ viewerId, sessionLoading, queryFromUrl, viewFromUrl }: { viewerId: string | null; sessionLoading: boolean; queryFromUrl: string; viewFromUrl: 'own' | 'community' }) {
  const [activeView, setActiveView] = useState<'own' | 'community'>(() => typeof window === 'undefined' ? viewFromUrl : browserSkillsView());
  const [skillsData, setSkillsData] = useState<Skill[]>([]);
  const [membersData, setMembersData] = useState<Member[]>([]);
  const [searchState, setSearchState] = useState({ query: queryFromUrl, urlQuery: queryFromUrl });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [sortBy, setSortBy] = useState<'endorsements' | 'name'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [expandedSkills, setExpandedSkills] = useState<Record<string, boolean>>({});
  const endorsementRequests = useRef(new Set<string>());
  const lifetime = useRef<AbortController | null>(null);
  const [showAllSkills, setShowAllSkills] = useState(false);

  // The browser URL is authoritative even when Next search params lag behind
  // native history or a same-route navigation returns identical router props.
  if (typeof window !== 'undefined' && activeView !== browserSkillsView()) {
    setActiveView(browserSkillsView());
  }

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  const [endorsingMembers, setEndorsingMembers] = useState<string[]>([]);

  // Adjust URL-derived state during this render, before children see it.
  // A delayed router render from an older keystroke must not replace the draft.
  if (searchState.urlQuery !== queryFromUrl) {
    const currentQuery = (new URLSearchParams(window.location.search).get('query') ?? '').slice(0, 120);
    setSearchState({ query: currentQuery === queryFromUrl ? queryFromUrl : searchState.query, urlQuery: queryFromUrl });
  }
  const searchTerm = searchState.query;

  useEffect(() => {
    const restoreNavigation = () => {
      const query = (new URLSearchParams(window.location.search).get('query') ?? '').slice(0, 120);
      setSearchState({ query, urlQuery: query });
      setActiveView(browserSkillsView());
    };
    window.addEventListener('popstate', restoreNavigation);
    return () => window.removeEventListener('popstate', restoreNavigation);
  }, []);

  const updateQuery = (value: string) => {
    const query = value.slice(0, 120);
    setSearchState(previous => ({ ...previous, query }));
    const url = new URL(window.location.href);
    if (query) url.searchParams.set('query', query);
    else url.searchParams.delete('query');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  };

  useEffect(() => {
    if (!viewerId) return;
    const controller = new AbortController();
    void fetch('/api/skills/directory', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Verzeichnis konnte nicht geladen werden.');
        return response.json() as Promise<DirectoryResponse>;
      })
      .then(data => {
        if (controller.signal.aborted) return;
        setSkillsData(data.skills);
        setMembersData(data.members);
        setLoadError(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error('Fehler beim Laden des Skill-Verzeichnisses:', error);
        setLoadError(true);
      })
      .finally(() => { if (!controller.signal.aborted) setIsLoading(false); });
    return () => controller.abort();
  }, [retryKey, viewerId]);

  const skillByName = useMemo(() => new Map(skillsData.map(skill => [skill.name, skill])), [skillsData]);
  const categories = useMemo(() => ['All', ...new Set(skillsData.map(skill => skill.category))], [skillsData]);
  const filteredMembers = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase('de-DE');
    return membersData.filter(member => {
      const matchesCategory = selectedCategory === 'All' || member.skills.some(item => skillByName.get(item.skillName)?.category === selectedCategory);
      const matchesSearch = !query || member.name.toLocaleLowerCase('de-DE').includes(query) || member.skills.some(item =>
        item.skillName.toLocaleLowerCase('de-DE').includes(query) &&
        (selectedCategory === 'All' || skillByName.get(item.skillName)?.category === selectedCategory));
      return matchesCategory && matchesSearch;
    }).sort((a, b) => {
      const comparison = sortBy === 'endorsements' ? a.endorsements - b.endorsements : a.name.localeCompare(b.name, 'de');
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [membersData, searchTerm, selectedCategory, skillByName, sortBy, sortOrder]);
  const catalogMatches = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase('de-DE');
    return skillsData.filter(skill => (selectedCategory === 'All' || skill.category === selectedCategory) &&
      (!query || skill.name.toLocaleLowerCase('de-DE').includes(query)));
  }, [skillsData, selectedCategory, searchTerm]);
  const skillMemberCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const member of membersData) for (const name of new Set(member.skills.map(skill => skill.skillName))) counts.set(name, (counts.get(name) ?? 0) + 1);
    return counts;
  }, [membersData]);
  const hasFilters = Boolean(searchTerm || selectedCategory !== 'All');
  const clearFilters = () => { updateQuery(''); setSelectedCategory('All'); searchInputRef.current?.focus(); };

  const endorseMember = async (memberId: string) => {
    if (!viewerId) { toast.info('Bitte melde dich an, um ein Mitglied zu empfehlen.'); return; }
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || memberId === viewerId || endorsementRequests.current.has(memberId) || membersData.find(member => member.id === memberId)?.hasEndorsed) return;
    endorsementRequests.current.add(memberId);
    setEndorsingMembers(previous => [...previous, memberId]);
    try {
      const response = await fetch(`/api/members/${memberId}/endorse`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' } });
      const data = await response.json();
      if (signal.aborted) return;
      if (!response.ok) throw new Error(data.error || 'Empfehlung konnte nicht gespeichert werden.');
      const update = (member: Member) => member.id === memberId ? { ...member, endorsements: member.endorsements + 1, hasEndorsed: true } : member;
      setMembersData(previous => previous.map(update));
      setSelectedMember(previous => previous ? update(previous) : previous);
    } catch (error) {
      if (signal.aborted) return;
      console.error('Fehler beim Empfehlen des Mitglieds:', error);
      toast.error(error instanceof Error ? error.message : 'Ein unerwarteter Fehler ist aufgetreten.');
    } finally {
      endorsementRequests.current.delete(memberId);
      if (!signal.aborted) setEndorsingMembers(previous => previous.filter(id => id !== memberId));
    }
  };

  const canEndorse = (member: Member) => Boolean(viewerId && member.id !== viewerId && !member.hasEndorsed && !endorsingMembers.includes(member.id));
  const endorsementLabel = (member: Member) => member.hasEndorsed ? 'Bereits empfohlen' : member.id === viewerId ? 'Eigenes Profil' : endorsingMembers.includes(member.id) ? 'Wird empfohlen…' : 'Empfehlen';

  return <AppShell data-page-family="discovery">
    <Sidebar />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <AppHeader><div className="app-header-row"><h1 className="app-header-title [overflow-wrap:anywhere]">Skill-Verzeichnis</h1><div className="app-header-actions"><ThemeToggle /><UserNav /></div></div></AppHeader>
      <main id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
        <ToastContainer position="top-right" />
        <div className="fc-page-container mx-auto w-full max-w-[1440px]">
          <HeroBanner title="Fähigkeiten verbinden." description="Finde Menschen mit passenden Kenntnissen und bring deine eigenen Stärken ein." icon={PageBannerIcon} />
          <Tabs value={viewerId ? activeView : 'community'} onValueChange={value => {
            setActiveView(value as 'own' | 'community');
            const url = new URL(window.location.href);
            if (value === 'own') url.searchParams.set('view', 'mine');
            else url.searchParams.delete('view');
            window.history.pushState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
          }} className="min-w-0">
            {viewerId && <TabsList aria-label="Skills-Bereich" className="grid w-full grid-cols-2 sm:inline-flex sm:w-auto"><TabsTrigger value="community" className="min-h-11 gap-2 px-2 sm:px-3"><SkillIcon name="people" className="hidden h-4 w-4 sm:block" />Community</TabsTrigger><TabsTrigger value="own" className="min-h-11 gap-2 px-2 sm:px-3"><SkillIcon name="skills" className="hidden h-4 w-4 sm:block" />Meine Fähigkeiten</TabsTrigger></TabsList>}
            {viewerId && <TabsContent value="own"><OwnSkillsWorkbench viewerId={viewerId} catalog={skillsData} catalogLoading={isLoading} catalogError={loadError} onCatalogRetry={() => { setIsLoading(true); setLoadError(false); setRetryKey(value => value + 1); }} onCatalogCreated={skill => setSkillsData(previous => [...previous.filter(item => item.id !== skill.id), skill].sort((a, b) => a.name.localeCompare(b.name, 'de')))} onChanged={() => { setSelectedMember(null); setRetryKey(value => value + 1); }} /></TabsContent>}
            <TabsContent value="community" className="mt-0">

          <section aria-label="Mitglieder filtern" className="fc-filter-surface mt-4 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_15rem] sm:items-end">
            <div className="min-w-0"><Label htmlFor="skill-search" className="mb-2 block">Name oder Fähigkeit suchen</Label><div className="relative"><SkillIcon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input ref={searchInputRef} id="skill-search" type="search" maxLength={120} value={searchTerm} onChange={event => updateQuery(event.target.value)} placeholder="Name oder Fähigkeit" className="h-11 pl-10" /></div></div>
            <div className="min-w-0"><Label htmlFor="skill-sort" className="mb-2 block">Sortieren nach</Label><div className="flex items-center gap-2"><Select value={sortBy} onValueChange={value => setSortBy(value as 'endorsements' | 'name')}><SelectTrigger id="skill-sort" className="min-w-0 flex-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="endorsements">Empfehlungen</SelectItem><SelectItem value="name">Name</SelectItem></SelectContent></Select><Button type="button" variant="outline" size="icon" className="shrink-0" aria-label={sortOrder === 'asc' ? 'Absteigend sortieren' : 'Aufsteigend sortieren'} onClick={() => setSortOrder(value => value === 'asc' ? 'desc' : 'asc')}>{sortOrder === 'asc' ? <SkillIcon name="up" className="h-4 w-4" /> : <SkillIcon name="down" className="h-4 w-4" />}</Button></div></div>
          </section>

          <div role="group" aria-label="Skill-Kategorie wählen" className="flex flex-wrap gap-2 border-b py-3">{categories.map(category => <button key={category} type="button" onClick={() => setSelectedCategory(category)} aria-pressed={selectedCategory === category} className={'min-h-11 max-w-full rounded-[10px] border px-3 py-2 text-sm font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [overflow-wrap:anywhere] ' + (selectedCategory === category ? 'border-primary bg-accent text-foreground' : 'border-border text-muted-foreground hover:bg-muted')}>{category === 'All' ? 'Alle Kategorien' : category}</button>)}</div>

          <section aria-labelledby="skill-results-title" className="pt-5"><div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-4"><div><h2 id="skill-results-title" className="text-xl font-semibold tracking-tight">Mitglieder entdecken</h2><p className="mt-1 text-xs text-muted-foreground">Kenntnisstände sind Selbsteinschätzungen.</p></div><p role="status" className="text-sm tabular-nums text-muted-foreground">{viewerId && !isLoading && !loadError && <>{filteredMembers.length} {filteredMembers.length === 1 ? 'Ergebnis' : 'Ergebnisse'}</>}</p></div>
            {sessionLoading ? <div className="mt-6"><PageState kind="loading" title="Anmeldung wird geprüft" /></div>
              : !viewerId ? <div className="mt-6"><PageState kind="error" title="Anmeldung erforderlich" description="Melde dich an, um das Skill-Verzeichnis zu sehen." /></div>
              : isLoading ? <div className="mt-6"><PageState kind="loading" title="Skill-Verzeichnis wird geladen" /></div>
              : loadError ? <div className="mt-6"><PageState kind="error" title="Skill-Verzeichnis konnte nicht geladen werden" description="Prüfe deine Verbindung und versuche es erneut." action={<Button type="button" variant="outline" onClick={() => { setIsLoading(true); setLoadError(false); setRetryKey(value => value + 1); }}>Erneut versuchen</Button>} /></div>
              : filteredMembers.length === 0 ? <div className="mt-6"><PageState title={hasFilters ? 'Keine passenden Mitglieder' : 'Noch keine Mitglieder'} description={hasFilters ? 'Versuche es mit einem anderen Suchbegriff oder einer anderen Kategorie.' : 'Sobald Mitglieder Fähigkeiten eintragen, findest du sie hier.'} action={hasFilters ? <Button type="button" variant="outline" onClick={clearFilters}>Filter zurücksetzen</Button> : undefined} /></div>
              : <ul className="fc-entity-list">{filteredMembers.map(member => {
                const visibleSkills = member.skills.slice(0, expandedSkills[member.id] ? undefined : 3);
                return <li key={member.id} className="fc-entity-card"><div className="flex min-w-0 items-start gap-4"><Avatar className="h-12 w-12 shrink-0"><AvatarImage src={member.avatar} alt="" /><AvatarFallback>{member.name[0]}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><h3 className="min-w-0 break-words text-lg font-semibold tracking-tight [overflow-wrap:anywhere]"><Link href={`/profile/${member.id}`} className="hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{member.name}</Link></h3>{member.title && <p className="mt-1 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">{member.title}</p>}<p className="mt-2 text-xs tabular-nums text-muted-foreground">{member.endorsements} {member.endorsements === 1 ? 'Empfehlung' : 'Empfehlungen'}</p></div></div>
                  <div id={`member-skills-${member.id}`} className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">{visibleSkills.map(({ skillName, level }) => <div key={skillName} className="min-w-0 border-t pt-3"><div className="flex min-w-0 items-baseline justify-between gap-2 text-sm"><span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">{skillName}</span><span className="shrink-0 tabular-nums text-muted-foreground">{level}%</span></div>{skillByName.get(skillName)?.category && <p className="mt-1 text-xs text-muted-foreground">{skillByName.get(skillName)?.category}</p>}<Progress value={Math.max(0, Math.min(100, level))} aria-label={`${skillName}: ${level}%`} className="mt-2 h-2" /></div>)}{visibleSkills.length === 0 && <p className="text-sm text-muted-foreground">Noch keine Fähigkeiten eingetragen.</p>}</div>
                  <div className="mt-5 flex flex-wrap items-center gap-2">{member.skills.length > 3 && <Button type="button" variant="ghost" size="sm" aria-expanded={Boolean(expandedSkills[member.id])} aria-controls={`member-skills-${member.id}`} onClick={() => setExpandedSkills(previous => ({ ...previous, [member.id]: !previous[member.id] }))}>{expandedSkills[member.id] ? 'Weniger anzeigen' : `Alle ${member.skills.length} Fähigkeiten`}</Button>}<Button type="button" variant="outline" size="sm" onClick={event => { detailTrigger.current = event.currentTarget; setSelectedMember(member); }}>Details anzeigen</Button><Button type="button" variant="ghost" size="sm" disabled={!canEndorse(member)} onClick={() => void endorseMember(member.id)}><SkillIcon name="check" className="h-4 w-4" />{endorsementLabel(member)}</Button></div>
                </li>;
              })}</ul>}
          </section>
          {viewerId && !isLoading && !loadError && catalogMatches.length > 0 && <details aria-labelledby="skill-catalog-title" className="fc-section-card group mt-5"><summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><span id="skill-catalog-title" className="font-medium">Fähigkeiten entdecken</span><span className="text-xs text-muted-foreground">{catalogMatches.length} im Verzeichnis</span><SkillIcon name="down" className="ml-auto h-4 w-4 shrink-0 group-open:rotate-180" /></summary><div className="flex min-w-0 flex-wrap gap-2">{catalogMatches.slice(0, showAllSkills ? undefined : 8).map(skill => <button key={skill.id} type="button" aria-label={`${skill.name}: ${skillMemberCounts.get(skill.name) ?? 0} ${(skillMemberCounts.get(skill.name) ?? 0) === 1 ? 'Mitglied' : 'Mitglieder'} finden`} onClick={() => { updateQuery(skill.name); searchInputRef.current?.focus(); }} className="inline-flex min-h-11 max-w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"><SkillIcon name="skills" className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 break-words [overflow-wrap:anywhere]">{skill.name}</span><span className="shrink-0 text-xs tabular-nums text-muted-foreground">{skillMemberCounts.get(skill.name) ?? 0}</span></button>)}</div>{catalogMatches.length > 8 && <Button type="button" variant="ghost" size="sm" className="mt-2" aria-expanded={showAllSkills} onClick={() => setShowAllSkills(value => !value)}>{showAllSkills ? 'Weniger Fähigkeiten' : `Alle ${catalogMatches.length} Fähigkeiten entdecken`}</Button>}</details>}
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <Dialog open={!!selectedMember} onOpenChange={open => { if (!open) setSelectedMember(null); }}>
        <DialogContent className="sm:max-w-[600px]" onCloseAutoFocus={event => { event.preventDefault(); (detailTrigger.current?.isConnected ? detailTrigger.current : searchInputRef.current)?.focus(); }}><DialogHeader><DialogTitle className="break-words [overflow-wrap:anywhere]">{selectedMember?.name}</DialogTitle><DialogDescription>Fähigkeiten · Selbsteinschätzungen und Empfehlungen</DialogDescription></DialogHeader>
          {selectedMember && <div className="min-w-0 space-y-6 py-2"><div className="flex min-w-0 items-center gap-4"><Avatar className="h-14 w-14 shrink-0"><AvatarImage src={selectedMember.avatar} alt="" /><AvatarFallback>{selectedMember.name[0]}</AvatarFallback></Avatar><div className="min-w-0"><p className="break-words font-semibold [overflow-wrap:anywhere]">{selectedMember.name}</p>{selectedMember.title && <p className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">{selectedMember.title}</p>}<p className="text-sm tabular-nums text-muted-foreground">{selectedMember.endorsements} Empfehlungen</p></div></div>
            <section aria-label="Fähigkeiten" className="space-y-3">{selectedMember.skills.length ? selectedMember.skills.map(({ skillName, level }) => <div key={skillName} className="border-t pt-3"><div className="flex items-baseline justify-between gap-2 text-sm"><span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">{skillName}</span><span className="shrink-0 tabular-nums text-muted-foreground">{level}%</span></div><Progress value={Math.max(0, Math.min(100, level))} aria-label={`${skillName}: ${level}%`} className="mt-2 h-2" /></div>) : <p className="text-sm text-muted-foreground">Noch keine Fähigkeiten eingetragen.</p>}</section>
            <div className="flex flex-wrap gap-2 border-t pt-5"><Button asChild variant="outline"><Link href={`/profile/${selectedMember.id}`}>Profil öffnen<SkillIcon name="arrow" className="h-4 w-4" /></Link></Button><Button type="button" disabled={!canEndorse(selectedMember)} onClick={() => void endorseMember(selectedMember.id)}><SkillIcon name="check" className="h-4 w-4" />{endorsementLabel(selectedMember)}</Button></div>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  </AppShell>;
}
