"use client";

import { useState, useEffect, useMemo, Suspense } from 'react';
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
    <CardHeader className="flex flex-row items-center space-x-4 pb-2">
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

  const getSkillByName = (name: string): Skill | undefined => {
    return skillsData.find(skill => skill.name === name);
  };

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const [skillsResponse, membersResponse] = await Promise.all([
        fetch('/api/skills'),
        fetch('/api/members')
      ]);

      if (!skillsResponse.ok || !membersResponse.ok) {
        throw new Error('Failed to fetch data');
      }

      const [skillsData, membersData] = await Promise.all([
        skillsResponse.json() as Promise<Skill[]>,
        membersResponse.json() as Promise<Member[]>
      ]);

      setSkillsData(skillsData);
      setMembersData(membersData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

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
          ? b.endorsements - a.endorsements
          : a.name.localeCompare(b.name);
        return sortOrder === 'asc' ? comparison : -comparison;
      });
  }, [membersData, selectedCategory, searchTerm, sortBy, sortOrder]);

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
      } else {
        alert(data.error || 'Fehler beim Empfehlen des Mitglieds.');
      }
    } catch (error) {
      console.error("Fehler beim Empfehlen des Mitglieds:", error);
      alert('Ein unerwarteter Fehler ist aufgetreten.');
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
    <div className="flex flex-col lg:flex-row min-h-screen h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Sidebar className="lg:w-64" />
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-md z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center mb-4 sm:mb-0">
              <Award className="mr-2 h-6 w-6" />
              Skill-Verzeichnis
            </h2>
            <div className="flex items-center space-x-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Suche..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 w-full sm:w-64 rounded-full"
                />
              </div>
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="flex flex-col space-y-4 mb-6">
            <div className="flex items-center justify-end space-x-2">
              <Filter className="h-5 w-5 text-gray-500" />
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-[180px]">
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
                    <Button variant="outline" size="icon" onClick={toggleSortOrder}>
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
              <TabsList className="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground">
                {categories.map((category) => (
                  <TabsTrigger
                    key={category}
                    value={category}
                    className="inline-flex items-center justify-center whitespace-nowrap px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                  >
                    {category}
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
                    <CardHeader className="flex flex-row items-center space-x-4 pb-2">
                      <Avatar className="h-16 w-16">
                        <AvatarImage src={member.avatar} alt={member.name} />
                        <AvatarFallback>{member.name[0]}</AvatarFallback>
                      </Avatar>
                      <div>
                        <CardTitle className="text-xl">{member.name}</CardTitle>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{member.title}</p>
                      </div>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => endorseMember(member.id)}
                              disabled={member.hasEndorsed}
                              className={`ml-auto p-2 rounded-full ${member.hasEndorsed ? 'bg-gray-300 cursor-not-allowed' : 'bg-yellow-200 hover:bg-yellow-300'}`}
                              aria-label="Mitglied empfehlen"
                            >
                              <Star className={`h-6 w-6 ${member.hasEndorsed ? 'text-yellow-500' : 'text-gray-500'}`} />
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
                                      <span className="text-sm text-gray-500">{level}%</span>
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
                      <div className="flex items-center justify-between mt-4">
                        <span className="flex items-center text-sm text-gray-500">
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
                  onClick={() => window.location.href = `mailto:${selectedMember.contact}`}
                  className="flex items-center gap-2"
                >
                  <Mail className="h-4 w-4" />
                  Kontakt aufnehmen
                </Button>
                <Button
                  variant="default"
                  onClick={() => endorseMember(selectedMember.id)}
                  disabled={selectedMember.hasEndorsed}
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
    </div>
  );
}