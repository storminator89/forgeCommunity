"use client";

import { useState, useEffect, useMemo } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

  const getSkillByName = (name: string): Skill | undefined => {
    return skillsData.find(skill => skill.name === name);
  };

  useEffect(() => {
    const fetchSkills = async () => {
      try {
        const response = await fetch('/api/skills');
        if (!response.ok) {
          throw new Error('Fehler beim Abrufen der Skills');
        }
        const data: Skill[] = await response.json();
        setSkillsData(data);
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Ein unerwarteter Fehler ist aufgetreten');
      }
    };

    fetchSkills();
  }, []);

  useEffect(() => {
    const fetchMembers = async () => {
      try {
        const response = await fetch('/api/members');
        if (!response.ok) {
          throw new Error('Fehler beim Abrufen der Mitglieder');
        }
        const data: Member[] = await response.json();
        setMembersData(data);
        setIsLoading(false);
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Ein unerwarteter Fehler ist aufgetreten');
        setIsLoading(false);
      }
    };

    fetchMembers();
  }, []);

  const categories = useMemo(() => ['All', ...Array.from(new Set(skillsData.map(skill => skill.category)))], [skillsData]);

  const filteredMembers = useMemo(() => {
    return membersData
      .filter(member =>
        (selectedCategory === 'All' || member.skills.some(s => {
          const skill = getSkillByName(s.skillName);
          return skill && skill.category === selectedCategory;
        })) &&
        (member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
         member.skills.some(s => s.skillName.toLowerCase().includes(searchTerm.toLowerCase())))
      )
      .sort((a, b) => {
        let comparison = 0;
        if (sortBy === 'endorsements') {
          comparison = b.endorsements - a.endorsements;
        } else if (sortBy === 'name') {
          comparison = a.name.localeCompare(b.name);
        }
        return sortOrder === 'asc' ? comparison : -comparison;
      });
  }, [membersData, selectedCategory, searchTerm, sortBy, sortOrder, skillsData]);

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
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Sidebar className="lg:w-64" />
      <div className="flex-1 flex flex-col overflow-hidden">
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
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 space-y-4 sm:space-y-0">
            <Tabs
              value={selectedCategory}
              onValueChange={(value) => setSelectedCategory(value)}
              className="w-full sm:w-auto"
            >
              <TabsList className="grid grid-cols-3 sm:flex">
                {categories.map((category) => (
                  <TabsTrigger key={category} value={category} className="capitalize">
                    {category}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="flex items-center space-x-2">
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
          </div>
          <AnimatePresence>
            <motion.div
              className="grid grid-cols-1 lg:grid-cols-2 gap-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {filteredMembers.map((member) => (
                <motion.div key={member.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <Card className="h-full flex flex-col hover:shadow-lg transition-shadow duration-300">
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
                            <div key={skill.id} className="space-y-1">
                              <div className="flex justify-between">
                                <Badge variant="outline">{skill.name}</Badge>
                                <span className="text-sm text-gray-500">{level}%</span>
                              </div>
                              <Progress value={level} className="w-full" />
                            </div>
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
          </AnimatePresence>
        </main>
      </div>
      <Dialog open={!!selectedMember} onOpenChange={() => setSelectedMember(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{selectedMember?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex items-center space-x-4">
              <Avatar className="h-12 w-12">
                <AvatarImage src={selectedMember?.avatar} alt={selectedMember?.name} />
                <AvatarFallback>{selectedMember?.name[0]}</AvatarFallback>
              </Avatar>
              <div>
                <h4 className="font-semibold">{selectedMember?.name}</h4>
                <p className="text-sm text-gray-500">{selectedMember?.title}</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300">{selectedMember?.bio}</p>
            <div>
              <h5 className="font-semibold mb-2">Skills:</h5>
              <div className="space-y-2">
                {selectedMember?.skills.map(({ skillName, level }) => {
                  const skill = getSkillByName(skillName);
                  if (!skill) return null;
                  return (
                    <div key={skill.id} className="space-y-1">
                      <div className="flex justify-between">
                        <Badge variant="outline">{skill.name}</Badge>
                        <span className="text-sm text-gray-500">{level}%</span>
                      </div>
                      <Progress value={level} className="w-full" />
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center">
              <Star className="h-4 w-4 mr-1 text-yellow-500" />
              <span>{selectedMember?.endorsements} Empfehlungen</span>
            </div>
          </div>
          <DialogFooter className="flex flex-col space-y-2">
            <Button className="w-full" asChild>
              <a href={`mailto:${selectedMember?.contact}`}>
                <Mail className="mr-2 h-4 w-4" /> Kontaktieren
              </a>
            </Button>
            <Button variant="outline" className="w-full" asChild>
              <a href="#" target="_blank" rel="noopener noreferrer">
                Vollständiges Profil <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}