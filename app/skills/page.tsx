'use client';

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: editorial · macrostructure: skills directory · design-system: design.md · designed-as-app */

import { AppShell, AppHeader } from '@/components/app-shell';
import { PageState } from '@/components/page-state';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { ArrowUpRight, ChevronDown, ChevronUp, Search, Star } from 'lucide-react';
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

// The directory response includes viewer-specific endorsement flags. Remounting at
// the account boundary discards those flags, open details and in-flight UI state.
export default function SkillDirectory() {
  const { data: session, status } = useSession();
  const viewerId = status === 'loading' ? null : session?.user?.id ?? null;
  return <SkillDirectoryForViewer key={viewerId ?? status} viewerId={viewerId} sessionLoading={status === 'loading'} />;
}

function SkillDirectoryForViewer({ viewerId, sessionLoading }: { viewerId: string | null; sessionLoading: boolean }) {
  const [skillsData, setSkillsData] = useState<Skill[]>([]);
  const [membersData, setMembersData] = useState<Member[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [sortBy, setSortBy] = useState<'endorsements' | 'name'>('endorsements');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [expandedSkills, setExpandedSkills] = useState<Record<string, boolean>>({});
  const endorsementRequests = useRef(new Set<string>());
  const [endorsingMembers, setEndorsingMembers] = useState<string[]>([]);

  useEffect(() => {
    if (!viewerId) return;
    const controller = new AbortController();
    void fetch('/api/skills/directory', { signal: controller.signal })
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
      const matchesSearch = !query || member.name.toLocaleLowerCase('de-DE').includes(query) || member.skills.some(item => item.skillName.toLocaleLowerCase('de-DE').includes(query));
      return matchesCategory && matchesSearch;
    }).sort((a, b) => {
      const comparison = sortBy === 'endorsements' ? a.endorsements - b.endorsements : a.name.localeCompare(b.name, 'de');
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [membersData, searchTerm, selectedCategory, skillByName, sortBy, sortOrder]);
  const hasFilters = Boolean(searchTerm || selectedCategory !== 'All');
  const clearFilters = () => { setSearchTerm(''); setSelectedCategory('All'); };

  const endorseMember = async (memberId: string) => {
    if (!viewerId) { toast.info('Bitte melde dich an, um ein Mitglied zu empfehlen.'); return; }
    if (memberId === viewerId || endorsementRequests.current.has(memberId)) return;
    endorsementRequests.current.add(memberId);
    setEndorsingMembers(previous => [...previous, memberId]);
    try {
      const response = await fetch(`/api/members/${memberId}/endorse`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Empfehlung konnte nicht gespeichert werden.');
      const update = (member: Member) => member.id === memberId ? { ...member, endorsements: member.endorsements + 1, hasEndorsed: true } : member;
      setMembersData(previous => previous.map(update));
      setSelectedMember(previous => previous ? update(previous) : previous);
    } catch (error) {
      console.error('Fehler beim Empfehlen des Mitglieds:', error);
      toast.error(error instanceof Error ? error.message : 'Ein unerwarteter Fehler ist aufgetreten.');
    } finally {
      endorsementRequests.current.delete(memberId);
      setEndorsingMembers(previous => previous.filter(id => id !== memberId));
    }
  };

  const canEndorse = (member: Member) => Boolean(viewerId && member.id !== viewerId && !member.hasEndorsed && !endorsingMembers.includes(member.id));
  const endorsementLabel = (member: Member) => member.hasEndorsed ? 'Bereits empfohlen' : member.id === viewerId ? 'Eigenes Profil' : endorsingMembers.includes(member.id) ? 'Wird empfohlen…' : 'Empfehlen';

  return <AppShell>
    <Sidebar />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <AppHeader><div className="flex min-w-0 items-center justify-between gap-3"><h1 className="min-w-0 truncate">Skill-Verzeichnis</h1><div className="flex shrink-0 items-center gap-2"><ThemeToggle /><UserNav /></div></div></AppHeader>
      <main id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
        <ToastContainer position="top-right" />
        <div className="mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
          <div className="border-b pb-7"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Community / Fähigkeiten</p><p className="mt-2 max-w-[55ch] text-base leading-relaxed text-muted-foreground">Finde Menschen mit Erfahrung und entdecke ihre Fähigkeiten.</p></div>

          <section aria-label="Mitglieder filtern" className="grid min-w-0 gap-4 border-b py-7 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
            <div className="min-w-0"><Label htmlFor="skill-search" className="mb-2 block">Name oder Fähigkeit suchen</Label><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input id="skill-search" type="search" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="Name oder Fähigkeit" className="pl-10" /></div></div>
            <div className="min-w-0"><Label htmlFor="skill-sort" className="mb-2 block">Sortieren nach</Label><Select value={sortBy} onValueChange={value => setSortBy(value as 'endorsements' | 'name')}><SelectTrigger id="skill-sort"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="endorsements">Empfehlungen</SelectItem><SelectItem value="name">Name</SelectItem></SelectContent></Select></div>
            <Button type="button" variant="outline" size="icon" aria-label={sortOrder === 'asc' ? 'Absteigend sortieren' : 'Aufsteigend sortieren'} onClick={() => setSortOrder(value => value === 'asc' ? 'desc' : 'asc')}>{sortOrder === 'asc' ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}</Button>
          </section>

          <div role="group" aria-label="Skill-Kategorie wählen" className="flex flex-wrap gap-2 border-b py-5">{categories.map(category => <button key={category} type="button" onClick={() => setSelectedCategory(category)} aria-pressed={selectedCategory === category} className={'min-h-11 max-w-full rounded-[10px] border px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [overflow-wrap:anywhere] ' + (selectedCategory === category ? 'border-primary bg-accent text-foreground' : 'border-border text-muted-foreground hover:bg-muted')}>{category === 'All' ? 'Alle Kategorien' : category}</button>)}</div>

          <section aria-labelledby="skill-results-title" className="pt-7"><div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-4"><h2 id="skill-results-title" className="text-xl font-semibold tracking-tight">Mitglieder entdecken</h2><p role="status" className="text-sm tabular-nums text-muted-foreground">{filteredMembers.length} {filteredMembers.length === 1 ? 'Ergebnis' : 'Ergebnisse'}</p></div>
            {sessionLoading ? <div className="mt-6"><PageState kind="loading" title="Anmeldung wird geprüft" /></div>
              : !viewerId ? <div className="mt-6"><PageState kind="error" title="Anmeldung erforderlich" description="Melde dich an, um das Skill-Verzeichnis zu sehen." /></div>
              : isLoading ? <div className="mt-6"><PageState kind="loading" title="Skill-Verzeichnis wird geladen" /></div>
              : loadError ? <div className="mt-6"><PageState kind="error" title="Skill-Verzeichnis konnte nicht geladen werden" description="Prüfe deine Verbindung und versuche es erneut." action={<Button type="button" variant="outline" onClick={() => { setIsLoading(true); setLoadError(false); setRetryKey(value => value + 1); }}>Erneut versuchen</Button>} /></div>
              : filteredMembers.length === 0 ? <div className="mt-6"><PageState title={hasFilters ? 'Keine passenden Mitglieder' : 'Noch keine Mitglieder'} description={hasFilters ? 'Versuche es mit einem anderen Suchbegriff oder einer anderen Kategorie.' : 'Sobald Mitglieder Fähigkeiten eintragen, findest du sie hier.'} action={hasFilters ? <Button type="button" variant="outline" onClick={clearFilters}>Filter zurücksetzen</Button> : undefined} /></div>
              : <ul className="divide-y">{filteredMembers.map(member => {
                const visibleSkills = member.skills.slice(0, expandedSkills[member.id] ? undefined : 3);
                return <li key={member.id} className="min-w-0 py-6"><div className="flex min-w-0 items-start gap-4"><Avatar className="h-12 w-12 shrink-0"><AvatarImage src={member.avatar} alt="" /><AvatarFallback>{member.name[0]}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><h3 className="min-w-0 break-words text-lg font-semibold tracking-tight [overflow-wrap:anywhere]"><Link href={`/profile/${member.id}`} className="hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{member.name}</Link></h3>{member.title && <p className="mt-1 text-sm text-muted-foreground">{member.title}</p>}<p className="mt-2 text-xs tabular-nums text-muted-foreground">{member.endorsements} {member.endorsements === 1 ? 'Empfehlung' : 'Empfehlungen'}</p></div></div>
                  <div id={`member-skills-${member.id}`} className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">{visibleSkills.map(({ skillName, level }) => <div key={skillName} className="min-w-0 border-t pt-3"><div className="flex min-w-0 items-baseline justify-between gap-2 text-sm"><span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">{skillName}</span><span className="shrink-0 tabular-nums text-muted-foreground">{level}%</span></div>{skillByName.get(skillName)?.category && <p className="mt-1 text-xs text-muted-foreground">{skillByName.get(skillName)?.category}</p>}<Progress value={Math.max(0, Math.min(100, level))} aria-label={`${skillName}: ${level}%`} className="mt-2 h-2" /></div>)}{visibleSkills.length === 0 && <p className="text-sm text-muted-foreground">Noch keine Fähigkeiten eingetragen.</p>}</div>
                  <div className="mt-5 flex flex-wrap items-center gap-2">{member.skills.length > 3 && <Button type="button" variant="ghost" size="sm" aria-expanded={Boolean(expandedSkills[member.id])} aria-controls={`member-skills-${member.id}`} onClick={() => setExpandedSkills(previous => ({ ...previous, [member.id]: !previous[member.id] }))}>{expandedSkills[member.id] ? 'Weniger anzeigen' : `Alle ${member.skills.length} Fähigkeiten`}</Button>}<Button type="button" variant="outline" size="sm" onClick={() => setSelectedMember(member)}>Details anzeigen</Button><Button type="button" variant="ghost" size="sm" disabled={!canEndorse(member)} onClick={() => void endorseMember(member.id)}><Star className="h-4 w-4" aria-hidden="true" />{endorsementLabel(member)}</Button></div>
                </li>;
              })}</ul>}
          </section>
        </div>
      </main>

      <Dialog open={!!selectedMember} onOpenChange={open => { if (!open) setSelectedMember(null); }}>
        <DialogContent className="sm:max-w-[600px]"><DialogHeader><DialogTitle className="break-words [overflow-wrap:anywhere]">{selectedMember?.name}</DialogTitle><DialogDescription>Fähigkeiten und Empfehlungen</DialogDescription></DialogHeader>
          {selectedMember && <div className="min-w-0 space-y-6 py-2"><div className="flex min-w-0 items-center gap-4"><Avatar className="h-14 w-14 shrink-0"><AvatarImage src={selectedMember.avatar} alt="" /><AvatarFallback>{selectedMember.name[0]}</AvatarFallback></Avatar><div className="min-w-0"><p className="break-words font-semibold [overflow-wrap:anywhere]">{selectedMember.name}</p>{selectedMember.title && <p className="text-sm text-muted-foreground">{selectedMember.title}</p>}<p className="text-sm tabular-nums text-muted-foreground">{selectedMember.endorsements} Empfehlungen</p></div></div>
            <section aria-label="Fähigkeiten" className="space-y-3">{selectedMember.skills.length ? selectedMember.skills.map(({ skillName, level }) => <div key={skillName} className="border-t pt-3"><div className="flex items-baseline justify-between gap-2 text-sm"><span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">{skillName}</span><span className="shrink-0 tabular-nums text-muted-foreground">{level}%</span></div><Progress value={Math.max(0, Math.min(100, level))} aria-label={`${skillName}: ${level}%`} className="mt-2 h-2" /></div>) : <p className="text-sm text-muted-foreground">Noch keine Fähigkeiten eingetragen.</p>}</section>
            <div className="flex flex-wrap gap-2 border-t pt-5"><Button asChild variant="outline"><Link href={`/profile/${selectedMember.id}`}>Profil öffnen<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link></Button><Button type="button" disabled={!canEndorse(selectedMember)} onClick={() => void endorseMember(selectedMember.id)}><Star className="h-4 w-4" aria-hidden="true" />{endorsementLabel(selectedMember)}</Button></div>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  </AppShell>;
}
