"use client";

import { PageState } from '@/components/page-state';
import { HeroBanner, PageContainer, SurfaceCard } from '@/components/discovery';
import { AppShell, AppHeader } from '@/components/app-shell';
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Search,
  Briefcase,
  Calendar,
  Users,
  LayoutGrid,
  List,
  ChevronUp,
  SlidersHorizontal,
  ArrowUpRight,
  X,
} from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { getPreferredScrollBehavior } from '@/lib/scroll-behavior';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Member {
  id: string;
  name: string;
  image: string;
  role: string;
  title?: string;
  joinedAt: string;
  followers: number;
  skills: string[];
}

interface MembersApiRecord {
  id: string;
  name: string | null;
  image: string | null;
  role: string;
  title: string | null;
  createdAt: string;
  followers: number;
  skills: string[];
}

const roleLabels: Record<string, string> = {
  USER: 'Mitglied',
  ADMIN: 'Administration',
  MODERATOR: 'Moderation',
  INSTRUCTOR: 'Lehrperson',
};
const roleLabel = (role: string) => roleLabels[role] ?? role;

export default function Members() {
  const [searchTerm, setSearchTerm] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [sortBy, setSortBy] = useState<'name' | 'joinedAt' | 'followers'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

  // Extrahiere einzigartige Skills und Rollen
  const uniqueSkills = [...new Set(members.flatMap(m => m.skills))].sort();
  const uniqueRoles = [...new Set(members.map(m => m.role))].sort();

  const fetchMembers = useCallback(async (signal: AbortSignal) => {
    const response = await fetch('/api/members', { signal });
    if (!response.ok) throw new Error('Failed to fetch members');
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error('Invalid members response');

    const transformedMembers: Member[] = (data as MembersApiRecord[]).map((member) => ({
      id: member.id,
      name: member.name || 'Unbekannt',
      image: member.image || '',
      role: member.role,
      title: member.title || undefined,
      joinedAt: member.createdAt,
      followers: member.followers,
      skills: member.skills,
    }));

    return transformedMembers;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchMembers(controller.signal)
      .then((nextMembers) => {
        if (!controller.signal.aborted) setMembers(nextMembers);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error('Error fetching members:', error);
          setLoadError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [fetchMembers, retryKey]);

  const getSortedAndFilteredMembers = useCallback(() => {
    let result = [...members];

    // Filter by search term
    if (searchTerm) {
      result = result.filter(member =>
        member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
        roleLabel(member.role).toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.skills.some(skill => skill.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }

    // Filter by selected skills
    if (selectedSkills.length > 0) {
      result = result.filter(member =>
        selectedSkills.every(skill => member.skills.includes(skill))
      );
    }

    // Filter by selected roles
    if (selectedRoles.length > 0) {
      result = result.filter(member =>
        selectedRoles.includes(member.role)
      );
    }

    // Sort results
    result.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return sortOrder === 'asc'
            ? a.name.localeCompare(b.name)
            : b.name.localeCompare(a.name);
        case 'joinedAt':
          return sortOrder === 'asc'
            ? new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime()
            : new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime();
        case 'followers':
          return sortOrder === 'asc'
            ? a.followers - b.followers
            : b.followers - a.followers;
        default:
          return 0;
      }
    });

    return result;
  }, [members, searchTerm, sortBy, sortOrder, selectedSkills, selectedRoles]);

  const filteredMembers = getSortedAndFilteredMembers();
  const selectedMember = filteredMembers.find(member => member.id === selectedMemberId);
  const mainRef = useRef<HTMLElement>(null);

  const handleSort = (key: 'name' | 'joinedAt' | 'followers') => {
    setSortBy(key);
    setSortOrder(prev => sortBy === key ? (prev === 'asc' ? 'desc' : 'asc') : key === 'name' ? 'asc' : 'desc');
  };

  const hasActiveFilters = Boolean(searchTerm || selectedSkills.length || selectedRoles.length);
  const closeInspector = () => { document.getElementById('member-preview-' + selectedMemberId)?.focus(); setSelectedMemberId(null); };
  const clearFilters = () => { setSearchTerm(''); setSelectedSkills([]); setSelectedRoles([]); };
  const retryLoad = () => { setIsLoading(true); setLoadError(false); setRetryKey(value => value + 1); };
  const scrollToTop = () => { mainRef.current?.scrollTo?.({ top: 0, behavior: getPreferredScrollBehavior() }); };

  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="app-header-row">
            <h1 className="app-header-title">Mitglieder</h1>
            <div className="app-header-actions"><ThemeToggle /><UserNav /></div>
          </div>
        </AppHeader>

        <main ref={mainRef} onScroll={event => setShowScrollTop(event.currentTarget.scrollTop > 400)} id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
          <PageContainer>
            <HeroBanner icon={Users} title="Lerne die Community kennen." description="Entdecke die Menschen hinter den Ideen. Vernetze dich und lerne von anderen." action={!isLoading && !loadError ? <div className="flex items-center gap-3 rounded-xl bg-card/80 px-4 py-3"><div className="flex -space-x-2" aria-hidden="true">{members.slice(0, 3).map(member => <Avatar key={member.id} className="h-9 w-9 border-2 border-card"><AvatarImage src={member.image} alt="" /><AvatarFallback className="bg-accent text-xs">{member.name.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>)}</div><span className="text-sm font-medium">{members.length} {members.length === 1 ? 'Mitglied' : 'Mitglieder'}</span></div> : undefined} />
            <div className="fc-member-layout">
            <section aria-labelledby="member-results-title">
              <div className="fc-filter-bar grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
                <div className="min-w-0">
                  <label htmlFor="member-search" className="mb-2 block text-sm font-medium">Mitglieder suchen</label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input id="member-search" type="search" placeholder="Name, Rolle oder Skill" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} className="pl-10" />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline"><SlidersHorizontal className="h-4 w-4" aria-hidden="true" />Filter{selectedSkills.length + selectedRoles.length > 0 && <span className="tabular-nums">({selectedSkills.length + selectedRoles.length})</span>}</Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="max-h-[min(60dvh,24rem)] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto">
                      <div className="border-b p-2">
                        <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Skills</p>
                        {uniqueSkills.length === 0 && <p className="px-2 pb-2 text-sm text-muted-foreground">Keine Skills vorhanden</p>}
                        {uniqueSkills.map(skill => (
                          <DropdownMenuCheckboxItem key={skill} checked={selectedSkills.includes(skill)}
                            onSelect={event => event.preventDefault()}
                            onCheckedChange={checked => setSelectedSkills(previous => checked ? [...previous, skill] : previous.filter(value => value !== skill))}>
                            {skill}
                          </DropdownMenuCheckboxItem>
                        ))}
                      </div>
                      <div className="p-2">
                        <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Rollen</p>
                        {uniqueRoles.length === 0 && <p className="px-2 pb-2 text-sm text-muted-foreground">Keine Rollen vorhanden</p>}
                        {uniqueRoles.map(role => (
                          <DropdownMenuCheckboxItem key={role} checked={selectedRoles.includes(role)}
                            onSelect={event => event.preventDefault()}
                            onCheckedChange={checked => setSelectedRoles(previous => checked ? [...previous, role] : previous.filter(value => value !== role))}>
                            {roleLabel(role)}
                          </DropdownMenuCheckboxItem>
                        ))}
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline">Sortieren: {sortBy === 'joinedAt' ? 'Datum' : sortBy === 'followers' ? 'Follower' : 'Name'} <span aria-hidden="true">{sortOrder === 'asc' ? '↑' : '↓'}</span></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => handleSort('name')}>Name {sortBy === 'name' && <span className="ml-auto" aria-hidden="true">{sortOrder === 'asc' ? '↑' : '↓'}</span>}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleSort('joinedAt')}>Datum {sortBy === 'joinedAt' && <span className="ml-auto" aria-hidden="true">{sortOrder === 'asc' ? '↑' : '↓'}</span>}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleSort('followers')}>Follower {sortBy === 'followers' && <span className="ml-auto" aria-hidden="true">{sortOrder === 'asc' ? '↑' : '↓'}</span>}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <div role="group" aria-label="Ansicht wählen" className="flex items-center rounded-[10px] border border-input p-0.5">
                    <Button type="button" aria-label="Kartenansicht" aria-pressed={viewMode === 'grid'} variant="ghost" size="icon" onClick={() => setViewMode('grid')} className={viewMode === 'grid' ? 'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground' : ''}><LayoutGrid className="h-4 w-4" aria-hidden="true" /></Button>
                    <Button type="button" aria-label="Listenansicht" aria-pressed={viewMode === 'list'} variant="ghost" size="icon" onClick={() => setViewMode('list')} className={viewMode === 'list' ? 'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground' : ''}><List className="h-4 w-4" aria-hidden="true" /></Button>
                  </div>
                </div>
              </div>

              {hasActiveFilters && (
                <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="Aktive Filter">
                  {selectedSkills.map(skill => (
                    <Button type="button" key={'skill-' + skill} variant="secondary" size="sm" className="max-w-full rounded-full" aria-label={'Filter ' + skill + ' entfernen'} onClick={() => setSelectedSkills(previous => previous.filter(value => value !== skill))}><span className="truncate">{skill}</span><X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /></Button>
                  ))}
                  {selectedRoles.map(role => (
                    <Button type="button" key={'role-' + role} variant="secondary" size="sm" className="max-w-full rounded-full" aria-label={'Filter ' + roleLabel(role) + ' entfernen'} onClick={() => setSelectedRoles(previous => previous.filter(value => value !== role))}><span className="truncate">{roleLabel(role)}</span><X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /></Button>
                  ))}
                  <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>Filter zurücksetzen</Button>
                </div>
              )}

              <div className="mt-6 flex flex-wrap items-baseline justify-between gap-2 border-b pb-4">
                <h2 id="member-results-title" className="text-xl font-semibold tracking-tight">Mitglieder entdecken</h2>
                <p className="text-sm tabular-nums text-muted-foreground" role="status">{!isLoading && !loadError && <>{filteredMembers.length} {filteredMembers.length === 1 ? 'Ergebnis' : 'Ergebnisse'}</>}</p>
              </div>

              {isLoading ? (
                <div className="grid gap-x-8 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Mitglieder werden geladen">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="flex gap-3 border-b py-6">
                      <div className="h-12 w-12 shrink-0 rounded-full bg-muted motion-safe:animate-pulse" />
                      <div className="flex-1 space-y-3"><div className="h-4 w-2/3 rounded-[0.25rem] bg-muted motion-safe:animate-pulse" /><div className="h-3 w-1/2 rounded-[0.25rem] bg-muted motion-safe:animate-pulse" /></div>
                    </div>
                  ))}
                </div>
              ) : loadError ? (
                <div className="mt-6"><PageState kind="error" title="Mitglieder konnten nicht geladen werden" description="Bitte versuche es erneut." action={<Button type="button" variant="outline" onClick={retryLoad}>Erneut versuchen</Button>} /></div>
              ) : filteredMembers.length === 0 ? (
                <div className="mt-6"><PageState title={hasActiveFilters ? 'Keine Mitglieder gefunden' : 'Noch keine Mitglieder'} description={hasActiveFilters ? 'Versuche einen anderen Suchbegriff oder entferne deine Filter.' : 'Sobald Mitglieder da sind, erscheinen sie hier.'} action={hasActiveFilters ? <Button type="button" variant="outline" onClick={clearFilters}>Filter zurücksetzen</Button> : undefined} /></div>
              ) : (
                <div className={viewMode === 'grid' ? 'fc-entity-grid' : 'fc-entity-list'}>
                  {filteredMembers.map(member => (
                    <div key={member.id} className="fc-member-card group min-w-0">
                      <div className="flex min-w-0 items-start gap-3">
                        <Avatar className="h-12 w-12 shrink-0">
                          <AvatarImage src={member.image} alt="" />
                          <AvatarFallback className="bg-coral-highlight/35 text-foreground">{member.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                            <h3 className="min-w-0 break-words text-base font-semibold tracking-tight [overflow-wrap:anywhere]"><Link href={'/profile/' + member.id} aria-label={'Profil von ' + member.name + ' öffnen'} className="hover:text-primary">{member.name}</Link></h3>
                            <Badge variant="secondary" className="bg-accent/70 text-accent-foreground font-medium">{roleLabel(member.role)}</Badge>
                          </div>
                          {member.title && <p className="mt-1 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">{member.title}</p>}
                          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" aria-hidden="true" />Seit {format(new Date(member.joinedAt), 'MMM yyyy', { locale: de })}</span>
                            <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" aria-hidden="true" />{member.followers} Follower</span>
                            <span className="inline-flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" aria-hidden="true" />{member.skills.length} Skills</span>
                          </div>
                          {member.skills.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">
                            {member.skills.slice(0, 3).map(skill => <Badge key={skill} variant="secondary" className="max-w-full truncate">{skill}</Badge>)}
                            {member.skills.length > 3 && <Badge variant="outline">+{member.skills.length - 3}</Badge>}
                          </div>}
                        </div>
                        <Button type="button" variant="outline" size="sm" id={'member-preview-' + member.id} aria-label={'Kurzprofil von ' + member.name} aria-pressed={selectedMemberId === member.id} aria-controls={selectedMemberId === member.id ? 'member-inspector' : undefined} onClick={() => setSelectedMemberId(previous => previous === member.id ? null : member.id)} className="shrink-0"><span className="hidden 2xl:inline">Kurzprofil</span><ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
            {selectedMember && <aside id="member-inspector" aria-label={'Kurzprofil von ' + selectedMember.name} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closeInspector(); } }} className="fc-profile-inspector fc-surface">
              <div className="flex items-start gap-3"><Avatar className="h-16 w-16"><AvatarImage src={selectedMember.image} alt="" /><AvatarFallback className="bg-coral-highlight/35 text-lg">{selectedMember.name.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar><div className="min-w-0 flex-1 pt-2"><h2 className="break-words font-semibold">{selectedMember.name}</h2><p className="mt-1 text-sm text-muted-foreground">{roleLabel(selectedMember.role)}</p></div><Button type="button" variant="ghost" size="icon" aria-label="Kurzprofil schließen" onClick={closeInspector}><X className="h-4 w-4" /></Button></div>
              {selectedMember.title && <p className="mt-4 text-sm text-muted-foreground">{selectedMember.title}</p>}
              <Button asChild className="mt-5 w-full"><Link href={'/profile/' + selectedMember.id}>Profil ansehen<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
              <h3>Über</h3><dl className="grid grid-cols-2 gap-2"><div className="rounded-xl bg-muted/60 p-3"><dt className="text-xs text-muted-foreground">Mitglied seit</dt><dd className="mt-2 text-sm font-medium">{format(new Date(selectedMember.joinedAt), 'MMM yyyy', { locale: de })}</dd></div><div className="rounded-xl bg-muted/60 p-3"><dt className="text-xs text-muted-foreground">Follower</dt><dd className="mt-2 text-sm font-medium">{selectedMember.followers}</dd></div></dl>
              <h3>Interessen & Skills</h3>{selectedMember.skills.length > 0 ? <div className="flex flex-wrap gap-2">{selectedMember.skills.map(skill => <Badge key={skill} variant="secondary">{skill}</Badge>)}</div> : <SurfaceCard className="bg-muted/30 p-5 text-center"><Briefcase className="mx-auto mb-3 h-5 w-5 text-muted-foreground" aria-hidden="true" /><p className="text-sm">Noch keine Skills hinterlegt</p><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Dieses Mitglied hat noch keine Skills angegeben.</p></SurfaceCard>}
            </aside>}
            </div>
          </PageContainer>

          {showScrollTop && <Button type="button" aria-label="Nach oben" variant="secondary" size="icon" onClick={scrollToTop} className="fixed bottom-6 right-6 z-20 border shadow-xs"><ChevronUp className="h-4 w-4" aria-hidden="true" /></Button>}
        </main>
      </div>
    </AppShell>
  );
}
