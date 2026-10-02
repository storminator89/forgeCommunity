"use client";

import { PageState } from '@/components/page-state';
import { PageIntro } from '@/components/page-intro';
import { AppShell, AppHeader } from '@/components/app-shell';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import debounce from 'lodash/debounce';
import { motion } from 'framer-motion';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import {
  Menu,
  Search,
  Mail,
  MapPin,
  Briefcase,
  Calendar,
  Users,
  Loader2,
  LayoutGrid,
  List,
  ChevronUp,
  SlidersHorizontal
} from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

interface Member {
  id: string;
  name: string;
  image: string;
  role: string;
  title?: string;
  location?: string;
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

export default function Members() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'name' | 'joinedAt' | 'followers'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [currentTime] = useState(() => Date.now());

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
        if (!controller.signal.aborted) console.error('Error fetching members:', error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [fetchMembers]);

  const getSortedAndFilteredMembers = useCallback(() => {
    let result = [...members];

    // Filter by search term
    if (searchTerm) {
      result = result.filter(member =>
        member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.location?.toLowerCase().includes(searchTerm.toLowerCase()) ||
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
  const mainRef = useRef<HTMLElement>(null);

  const handleSort = (key: 'name' | 'joinedAt' | 'followers') => {
    setSortBy(key);
    setSortOrder(prev => sortBy === key ? (prev === 'asc' ? 'desc' : 'asc') : key === 'name' ? 'asc' : 'desc');
  };

  const navigateToProfile = (userId: string) => {
    router.push(`/profile/${userId}`);
  };

  const scrollToTop = () => { mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); };

  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center">

              <h2 className="text-xl font-bold text-foreground">Mitglieder</h2>
            </div>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </AppHeader>

        <main ref={mainRef} onScroll={event => setShowScrollTop(event.currentTarget.scrollTop > 400)} id="page-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 lg:p-8">
          <TooltipProvider>
            <div className="max-w-7xl mx-auto space-y-6">
            <PageIntro eyebrow="Entdecken" title="Finde deine Leute." description="Entdecke Mitglieder mit passenden Interessen, Erfahrungen und Fähigkeiten." />
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {[
                  { label: 'Alle Mitglieder', value: members.length },
                  { label: 'Aktive Mitglieder', value: members.filter(m => m.followers > 0).length },
                  { label: 'Durchschn. Skills', value: members.length > 0 ? Math.round(members.reduce((acc, m) => acc + m.skills.length, 0) / members.length) : 0 },
                  { label: 'Neue diesen Monat', value: members.filter(m => new Date(m.joinedAt).getTime() > currentTime - 30 * 24 * 60 * 60 * 1000).length }
                ].map((stat, i) => (
                  <Card key={i} className="bg-card/50 dark:bg-card/50 backdrop-blur-sm">
                    <CardContent className="p-4">
                      <p className="text-sm text-muted-foreground">{stat.label}</p>
                      <h3 className="text-2xl font-bold mt-1">{stat.value}</h3>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row items-start gap-4 bg-card/50 dark:bg-card/50 backdrop-blur-sm p-4 rounded-lg">
                <div className="flex-1 w-full space-y-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="Suche nach Namen, Rollen, Skills oder Orten"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 transition-all duration-200 border-2 focus:border-primary/50 hover:border-border dark:hover:border-border w-full"
                      aria-label="Mitglieder durchsuchen"
                    />
                    {searchTerm && (
                      <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                        <Badge variant="secondary" className="animate-fadeIn">
                          {filteredMembers.length} {filteredMembers.length === 1 ? 'Ergebnis' : 'Ergebnisse'}
                        </Badge>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {selectedSkills.length > 0 && (
                      <div className="flex flex-wrap gap-2 animate-fadeIn">
                        {selectedSkills.map(skill => (
                          <Badge
                            key={skill}
                            variant="secondary"
                            role="button" tabIndex={0} aria-label={`Filter ${skill} entfernen`}
                            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedSkills(prev => prev.filter(s => s !== skill)); } }}
                            className="cursor-pointer hover:bg-destructive/20 transition-colors"
                            onClick={() => setSelectedSkills(prev => prev.filter(s => s !== skill))}
                          >
                            {skill} ×
                          </Badge>
                        ))}
                      </div>
                    )}
                    {selectedRoles.length > 0 && (
                      <div className="flex flex-wrap gap-2 animate-fadeIn">
                        {selectedRoles.map(role => (
                          <Badge
                            key={role}
                            variant="outline"
                            role="button" tabIndex={0} aria-label={`Filter ${role} entfernen`}
                            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedRoles(prev => prev.filter(r => r !== role)); } }}
                            className="cursor-pointer hover:bg-destructive/20 transition-colors"
                            onClick={() => setSelectedRoles(prev => prev.filter(r => r !== role))}
                          >
                            {role} ×
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-4">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="min-w-[130px]">
                        <SlidersHorizontal className="w-4 h-4 mr-2" />
                        Filter
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[200px] max-h-[400px] overflow-y-auto">
                      <div className="p-2 border-b">
                        <p className="text-sm font-medium mb-2">Skills</p>
                        <div className="space-y-1">
                          {uniqueSkills.map(skill => (
                            <DropdownMenuCheckboxItem key={skill} checked={selectedSkills.includes(skill)}
                              onSelect={event => event.preventDefault()}
                              onCheckedChange={checked => setSelectedSkills(prev => checked ? [...prev, skill] : prev.filter(value => value !== skill))}>
                              {skill}
                            </DropdownMenuCheckboxItem>
                          ))}
                        </div>
                      </div>
                      <div className="p-2">
                        <p className="text-sm font-medium mb-2">Rollen</p>
                        <div className="space-y-1">
                          {uniqueRoles.map(role => (
                            <DropdownMenuCheckboxItem key={role} checked={selectedRoles.includes(role)}
                              onSelect={event => event.preventDefault()}
                              onCheckedChange={checked => setSelectedRoles(prev => checked ? [...prev, role] : prev.filter(value => value !== role))}>
                              {role}
                            </DropdownMenuCheckboxItem>
                          ))}
                        </div>
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="min-w-[130px]">
                        <SlidersHorizontal className="w-4 h-4 mr-2" />
                        {sortBy === 'joinedAt' ? 'Datum' :
                          sortBy === 'followers' ? 'Follower' : 'Name'} {sortOrder === 'asc' ? '↑' : '↓'}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[180px]">
                      <DropdownMenuItem
                        onClick={() => handleSort('name')}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        Name {sortBy === 'name' && <span className="text-primary">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleSort('joinedAt')}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        Datum {sortBy === 'joinedAt' && <span className="text-primary">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleSort('followers')}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        Follower {sortBy === 'followers' && <span className="text-primary">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <div className="flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button aria-label="Kartenansicht"
                          variant="ghost"
                          size="icon"
                          onClick={() => setViewMode('grid')}
                          className={viewMode === 'grid' ? 'bg-primary/10' : ''}
                        >
                          <LayoutGrid className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Grid-Ansicht</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button aria-label="Listenansicht"
                          variant="ghost"
                          size="icon"
                          onClick={() => setViewMode('list')}
                          className={viewMode === 'list' ? 'bg-primary/10' : ''}
                        >
                          <List className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Listen-Ansicht</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>

              <div>
                {isLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[...Array(6)].map((_, i) => (
                      <Card key={`skeleton-${i}`} className="animate-pulse">
                        <CardContent className="p-6">
                          <div className="flex space-x-4">
                            <div className="h-16 w-16 rounded-full bg-muted" />
                            <div className="flex-1 space-y-4">
                              <div className="h-4 bg-muted rounded w-3/4" />
                              <div className="h-4 bg-muted rounded w-1/2" />
                              <div className="h-4 bg-muted rounded w-1/4" />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className={
                    viewMode === 'grid'
                      ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
                      : "flex flex-col gap-4"
                  }>
                    {filteredMembers.length === 0 && <div className="col-span-full"><PageState title="Keine Mitglieder gefunden" description="Versuche einen anderen Suchbegriff oder entferne deine Filter." action={<Button variant="outline" onClick={() => { setSearchTerm(''); setSelectedSkills([]); setSelectedRoles([]); }}>Filter zurücksetzen</Button>} /></div>}
                    {filteredMembers.map((member, index) => (
                      <motion.div
                        key={member.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: Math.min(index * 0.05, 0.5) }}
                      >
                        <Card
                          className="group cursor-pointer transition-all duration-200 hover:shadow-lg dark:hover:shadow-primary/5 hover:border-primary/30"
                          role="link" tabIndex={0} aria-label={`Profil von ${member.name} öffnen`}
                          onKeyDown={event => { if (event.key === 'Enter') navigateToProfile(member.id); }}
                          onClick={() => navigateToProfile(member.id)}
                        >
                          <CardContent className="p-6">
                            <div className="flex min-w-0 gap-3">
                              <Avatar className="h-12 w-12 shrink-0 ring-2 ring-transparent group-hover:ring-primary/20 transition-all duration-200">
                                <AvatarImage src={member.image} alt={member.name} />
                                <AvatarFallback className="bg-primary/10">
                                  {member.name.slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <h3 className="text-lg font-semibold text-foreground truncate">
                                    {member.name}
                                  </h3>
                                  <Badge variant="outline">{member.role}</Badge>
                                </div>
                                {member.title && (
                                  <p className="text-sm text-muted-foreground mt-1">
                                    {member.title}
                                  </p>
                                )}
                                <div className="flex flex-wrap items-center gap-2 mt-2 text-sm text-muted-foreground">
                                  {member.location && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="flex items-center hover:text-primary transition-colors">
                                          <MapPin className="h-4 w-4 mr-1" />
                                          {member.location}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>Standort</TooltipContent>
                                    </Tooltip>
                                  )}
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="flex items-center hover:text-primary transition-colors">
                                        <Calendar className="h-4 w-4 mr-1" />
                                        {format(new Date(member.joinedAt), 'MMM yyyy', { locale: de })}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>Beitrittsdatum</TooltipContent>
                                  </Tooltip>
                                </div>
                              </div>
                            </div>

                            <div className="mt-4">
                              <div className="flex items-center gap-4 text-sm">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="flex items-center hover:text-primary transition-colors">
                                      <Users className="h-4 w-4 mr-1" />
                                      {member.followers} Follower
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>Anzahl der Follower</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="flex items-center hover:text-primary transition-colors">
                                      <Briefcase className="h-4 w-4 mr-1" />
                                      {member.skills.length} Skills
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>Anzahl der Fähigkeiten</TooltipContent>
                                </Tooltip>
                              </div>
                              {member.skills.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-3">
                                  {member.skills.slice(0, 3).map((skill, index) => (
                                    <Badge key={index} variant="secondary">
                                      {skill}
                                    </Badge>
                                  ))}
                                  {member.skills.length > 3 && (
                                    <Badge variant="outline">
                                      +{member.skills.length - 3}
                                    </Badge>
                                  )}
                                </div>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>

              {showScrollTop && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed bottom-8 right-8"
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button aria-label="Nach oben"
                        variant="secondary"
                        size="icon"
                        onClick={scrollToTop}
                        className="rounded-full shadow-lg"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Nach oben scrollen</TooltipContent>
                  </Tooltip>
                </motion.div>
              )}
            </div>
          </TooltipProvider>
        </main>
      </div>
    </AppShell>
  );
}
