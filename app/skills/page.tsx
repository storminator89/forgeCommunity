"use client";

import { AppShell, AppHeader } from '@/components/app-shell';
import { useState, useEffect, useMemo, Suspense, useCallback, useRef } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Search, Award, Star, Mail, ExternalLink, Filter, ChevronUp, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useSession } from 'next-auth/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from 'react-toastify';
import { Skeleton } from "@/components/ui/skeleton";

interface Skill {
  id: string;
  name: string;
  category: string;
}

interface MemberSkill {
  skillName: string;
  level: number;
}

interface Member {
  id: string;
  name: string;
  avatar: string;
  title: string;
  bio: string;
  contact: string;
  endorsements: number;
  skills: MemberSkill[];
  hasEndorsed?: boolean;
}

const MemberCardSkeleton = () => (
  <Card className="h-full">
    <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-2">
      <Skeleton className="h-16 w-16 rounded-full" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
    </CardHeader>
    <CardContent>
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2 w-full" />
          </div>
        ))}
      </div>
    </CardContent>
  </Card>
);

export default function SkillDirectory() {
  const { data: session } = useSession();
  const [skillsData, setSkillsData] = useState<Skill[]>([]);
  const [membersData, setMembersData] = useState<Member[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [sortBy, setSortBy] = useState('endorsements');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSkills, setExpandedSkills] = useState<{ [key: string]: boolean }>({});
  const [isRetrying, setIsRetrying] = useState(false);
  const endorsementRequests = useRef(new Set<string>());
  const [endorsingMembers, setEndorsingMembers] = useState<string[]>([]);
  const dataRequestRef = useRef<AbortController | null>(null);

  const getSkillByName = useCallback((name: string): Skill | undefined => {
    return skillsData.find(skill => skill.name === name);
  }, [skillsData]);

  const loadData = useCallback(async (signal: AbortSignal) => {
    const [skillsResponse, membersResponse] = await Promise.all([
      fetch('/api/skills', { signal }),
      fetch('/api/members', { signal })
    ]);

    if (!skillsResponse.ok || !membersResponse.ok) {
      throw new Error('Failed to fetch data');
    }

    const [skills, members] = await Promise.all([
      skillsResponse.json() as Promise<Skill[]>,
      membersResponse.json() as Promise<Member[]>
    ]);

    return { skills, members };
  }, []);

  const fetchData = useCallback(async () => {
    dataRequestRef.current?.abort();
    const controller = new AbortController();
    dataRequestRef.current = controller;
    setIsLoading(true);
    setError(null);

    try {
      const data = await loadData(controller.signal);
      if (dataRequestRef.current !== controller) return;
      setSkillsData(data.skills);
      setMembersData(data.members);
    } catch (err) {
      if (controller.signal.aborted || dataRequestRef.current !== controller) return;
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      if (dataRequestRef.current === controller) {
        dataRequestRef.current = null;
        setIsLoading(false);
      }
    }
  }, [loadData]);

  useEffect(() => {
    const controller = new AbortController();
    dataRequestRef.current = controller;

    void loadData(controller.signal)
      .then((data) => {
        if (dataRequestRef.current !== controller) return;
        setSkillsData(data.skills);
        setMembersData(data.members);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || dataRequestRef.current !== controller) return;
        setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      })
      .finally(() => {
        if (dataRequestRef.current === controller) {
          dataRequestRef.current = null;
          setIsLoading(false);
        }
      });

    return () => {
      controller.abort();
      if (dataRequestRef.current === controller) dataRequestRef.current = null;
    };
  }, [loadData]);

  const categories = useMemo(() => ['All', ...Array.from(new Set(skillsData.map(skill => skill.category)))], [skillsData]);

  const filteredMembers = useMemo(() => {
    return membersData
      .filter(member => {
        const matchesCategory = selectedCategory === 'All' ||
          member.skills.some(s => {
            const skill = getSkillByName(s.skillName);
            return skill?.category === selectedCategory;
          });

        const searchTermLower = searchTerm.toLowerCase();
        const matchesSearch =
          member.name.toLowerCase().includes(searchTermLower) ||
          member.skills.some(s => s.skillName.toLowerCase().includes(searchTermLower));

        return matchesCategory && matchesSearch;
      })
      .sort((a, b) => {
        const comparison = sortBy === 'endorsements'
          ? a.endorsements - b.endorsements
          : a.name.localeCompare(b.name);
        return sortOrder === 'asc' ? comparison : -comparison;
      });
  }, [membersData, selectedCategory, searchTerm, sortBy, sortOrder, getSkillByName]);

  const toggleSortOrder = () => {
    setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
  };

  const toggleExpandSkills = (memberId: string) => {
    setExpandedSkills(prev => ({
      ...prev,
      [memberId]: !prev[memberId]
    }));
  };

  const endorseMember = async (memberId: string) => {
    if (!session?.user?.id) {
      toast.info('Bitte melde dich an, um ein Mitglied zu empfehlen.');
      return;
    }
    if (memberId === session.user.id || endorsementRequests.current.has(memberId)) return;
    endorsementRequests.current.add(memberId);
    setEndorsingMembers(prev => [...prev, memberId]);
    try {
      const response = await fetch(`/api/members/${memberId}/endorse`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      if (response.ok) {
        setMembersData(prev => prev.map(member => {
          if (member.id === memberId) {
            return { ...member, endorsements: member.endorsements + 1, hasEndorsed: true };
          }
          return member;
        }));
        setSelectedMember(prev => prev?.id === memberId
          ? { ...prev, endorsements: prev.endorsements + 1, hasEndorsed: true }
          : prev);
      } else {
        toast.error(data.error || 'Fehler beim Empfehlen des Mitglieds.');
      }
    } catch (error) {
      console.error("Fehler beim Empfehlen des Mitglieds:", error);
      toast.error('Ein unerwarteter Fehler ist aufgetreten.');
    } finally {
      endorsementRequests.current.delete(memberId);
      setEndorsingMembers(prev => prev.filter(id => id !== memberId));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-16 h-16 border-t-4 border-blue-500 rounded-full"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <p className="text-lg text-red-500 mb-4">{error}</p>
        <Button
          onClick={() => {
            setIsRetrying(true);
            fetchData().finally(() => setIsRetrying(false));
          }}
          disabled={isRetrying}
        >
          {isRetrying ? 'Retrying...' : 'Retry'}
        </Button>
      </div>
    );
  }

  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between">
            <h2 className="text-2xl font-bold text-foreground flex items-center mb-4 sm:mb-0">
              <Award className="mr-2 h-6 w-6" />
              Skill-Verzeichnis
            </h2>
            <div className="flex items-center space-x-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Name oder Fähigkeit suchen…"
                  aria-label="Mitglieder nach Name oder Fähigkeit suchen"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 w-full sm:w-64 rounded-full"
                />
              </div>
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </AppHeader>
        <main id="page-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="flex flex-col space-y-4 mb-6">
            <div className="flex items-center justify-end space-x-2">
              <Filter className="h-5 w-5 text-muted-foreground" />
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-[180px]" aria-label="Mitglieder sortieren nach">
                  <SelectValue placeholder="Sortieren nach" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="endorsements">Empfehlungen</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                </SelectContent>
              </Select>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" onClick={toggleSortOrder} aria-label={sortOrder === 'asc' ? 'Absteigend sortieren' : 'Aufsteigend sortieren'}>
                      {sortOrder === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {sortOrder === 'asc' ? 'Aufsteigend' : 'Absteigend'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            <Tabs
              value={selectedCategory}
              onValueChange={(value) => setSelectedCategory(value)}
              className="w-full"
            >
              <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-md bg-muted p-1 text-muted-foreground">
                {categories.map((category) => (
                  <TabsTrigger
                    key={category}
                    value={category}
                    className="inline-flex items-center justify-center whitespace-nowrap px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                  >
                    {category === 'All' ? 'Alle' : category}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          <Suspense fallback={
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {[1, 2, 3, 4].map((i) => (
                <MemberCardSkeleton key={i} />
              ))}
            </div>
          }>
            <motion.div
              layout
              className="grid grid-cols-1 lg:grid-cols-2 gap-6"
            >
              {filteredMembers.length === 0 && (
                <Card className="col-span-full">
                  <CardContent className="py-12 text-center">
                    <Search className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                    <h3 className="text-lg font-semibold">Keine passenden Mitglieder</h3>
                    <p className="mt-2 text-muted-foreground">Versuche einen anderen Suchbegriff oder zeige alle Kategorien.</p>
                    <Button variant="outline" className="mt-4" onClick={() => { setSearchTerm(''); setSelectedCategory('All'); }}>Filter zurücksetzen</Button>
                  </CardContent>
                </Card>
              )}
              {filteredMembers.map((member) => (
                <motion.div
                  key={member.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.2 }}
                >
                  <Card className="h-full hover:shadow-lg transition-all duration-300 transform hover:-translate-y-1">
                    <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-2">
                      <Avatar className="h-16 w-16">
                        <AvatarImage src={member.avatar} alt={member.name} />
                        <AvatarFallback>{member.name[0]}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <CardTitle className="text-xl break-words">{member.name}</CardTitle>
                        <p className="text-sm text-muted-foreground">{member.title}</p>
                      </div>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => endorseMember(member.id)}
                              disabled={!session || member.id === session.user.id || member.hasEndorsed || endorsingMembers.includes(member.id)}
                              className={`ml-auto shrink-0 p-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${member.hasEndorsed ? 'bg-secondary' : 'bg-amber-100 hover:bg-amber-200 dark:bg-amber-950 dark:hover:bg-amber-900'}`}
                              aria-label="Mitglied empfehlen"
                            >
                              <Star className={`h-6 w-6 ${member.hasEndorsed ? 'text-yellow-500' : 'text-amber-700 dark:text-amber-300'}`} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {member.hasEndorsed ? 'Bereits empfohlen' : 'Mitglied empfehlen'}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </CardHeader>
                    <CardContent className="flex-grow">
                      <div className="space-y-4 mb-4">
                        {member.skills.slice(0, expandedSkills[member.id] ? undefined : 3).map(({ skillName, level }) => {
                          const skill = getSkillByName(skillName);
                          if (!skill) return null;
                          return (
                            <TooltipProvider key={skill.id}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="space-y-1">
                                    <div className="flex justify-between">
                                      <Badge
                                        variant="outline"
                                        className="cursor-help transition-colors hover:bg-secondary"
                                      >
                                        {skill.name}
                                      </Badge>
                                      <span className="text-sm text-muted-foreground">{level}%</span>
                                    </div>
                                    <Progress value={level} className="w-full" />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-sm">{skill.category}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          );
                        })}
                      </div>
                      {member.skills.length > 3 && (
                        <Button
                          variant="link"
                          onClick={() => toggleExpandSkills(member.id)}
                          className="mt-2"
                        >
                          {expandedSkills[member.id] ? 'Weniger anzeigen' : 'Mehr anzeigen'}
                        </Button>
                      )}
                      <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
                        <span className="flex items-center text-sm text-muted-foreground">
                          <Star className="h-4 w-4 mr-1 text-yellow-500" />
                          {member.endorsements} Empfehlungen
                        </span>
                        <Button onClick={() => setSelectedMember(member)}>
                          Details zum Profil
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </motion.div>
          </Suspense>
        </main>
      </div>
      <Dialog open={!!selectedMember} onOpenChange={() => setSelectedMember(null)}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl">{selectedMember?.name}</DialogTitle>
          </DialogHeader>
          {selectedMember && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="grid gap-6 py-4"
            >
              <div className="flex items-center space-x-4">
                <Avatar className="h-20 w-20">
                  <AvatarImage src={selectedMember.avatar} alt={selectedMember.name} />
                  <AvatarFallback>{selectedMember.name[0]}</AvatarFallback>
                </Avatar>
                <div className="space-y-1">
                  <h4 className="text-xl font-semibold">{selectedMember.name}</h4>
                  <p className="text-sm text-muted-foreground">{selectedMember.title}</p>
                  <div className="flex items-center text-sm text-muted-foreground">
                    <Star className="h-4 w-4 mr-1 text-yellow-500" />
                    {selectedMember.endorsements} Empfehlungen
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h5 className="font-semibold text-lg">Über mich</h5>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selectedMember.bio}</p>
              </div>

              <div className="space-y-4">
                <h5 className="font-semibold text-lg">Skills & Expertise</h5>
                <div className="grid gap-3">
                  {selectedMember.skills.map(({ skillName, level }) => {
                    const skill = getSkillByName(skillName);
                    if (!skill) return null;
                    return (
                      <div key={skillName} className="space-y-1">
                        <div className="flex justify-between">
                          <Badge variant="outline" className="px-2 py-0.5">
                            {skillName}
                          </Badge>
                          <span className="text-sm text-muted-foreground">{level}%</span>
                        </div>
                        <Progress value={level} className="h-2" />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 pt-4 border-t">
                <Button
                  variant="outline"
                  disabled={!selectedMember.contact}
                  onClick={() => window.location.href = `mailto:${selectedMember.contact}`}
                  className="flex items-center gap-2"
                >
                  <Mail className="h-4 w-4" />
                  Kontakt aufnehmen
                </Button>
                <Button
                  variant="default"
                  onClick={() => endorseMember(selectedMember.id)}
                  disabled={!session || selectedMember.id === session.user.id || selectedMember.hasEndorsed || endorsingMembers.includes(selectedMember.id)}
                  className="flex items-center gap-2"
                >
                  <Star className="h-4 w-4" />
                  {selectedMember.hasEndorsed ? 'Bereits empfohlen' : 'Empfehlen'}
                </Button>
              </div>
            </motion.div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
