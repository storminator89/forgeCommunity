"use client";

import { useState, useEffect, useCallback } from 'react';
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

interface Member {
  id: string;
  name: string;
  email: string;
  image: string;
  role: string;
  title?: string;
  location?: string;
  joinedAt: string;
  followers: number;
  following: number;
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

  // Extrahiere einzigartige Skills und Rollen
  const uniqueSkills = [...new Set(members.flatMap(m => m.skills))].sort();
  const uniqueRoles = [...new Set(members.map(m => m.role))].sort();

  useEffect(() => {
    fetchMembers();
  }, []); // Only fetch once on mount

  const fetchMembers = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/admin/users');
      if (!response.ok) throw new Error('Failed to fetch members');
      const data = await response.json();

      const transformedMembers: Member[] = data.map((user: any) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image || '',
        role: user.role,
        title: user.title,
        location: user.contact?.location,
        joinedAt: user.createdAt,
        followers: user.stats?.followersCount || 0,
        following: user.stats?.followingCount || 0,
        skills: user.skills?.map((s: any) => s.name) || []
      }));

      setMembers(transformedMembers);
    } catch (error) {
      console.error('Error fetching members:', error);
    } finally {
      setIsLoading(false);
    }
  };

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

  const handleSort = (key: 'name' | 'joinedAt' | 'followers') => {
    setSortBy(key);
    setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
  };

  const navigateToProfile = (userId: string) => {
    router.push(`/profile/${userId}`);
  };

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 400);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="flex min-h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <header className="bg-white dark:bg-gray-800 shadow-sm z-40 sticky top-0">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <div className="flex items-center">
              <Button variant="ghost" size="icon" className="lg:hidden mr-2" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
                <Menu className="h-6 w-6" />
              </Button>
              <h2 className="text-xl font-bold text-gray-800 dark:text-white">Mitglieder</h2>
            </div>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <TooltipProvider>
            <div className="max-w-7xl mx-auto space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {[
                  { label: 'Alle Mitglieder', value: members.length },
                  { label: 'Aktive Mitglieder', value: members.filter(m => m.followers > 0).length },
                  { label: 'Durchschn. Skills', value: members.length > 0 ? Math.round(members.reduce((acc, m) => acc + m.skills.length, 0) / members.length) : 0 },
                  { label: 'Neue diesen Monat', value: members.filter(m => new Date(m.joinedAt) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)).length }
                ].map((stat, i) => (
                  <Card key={i} className="bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm">
                    <CardContent className="p-4">
                      <p className="text-sm text-gray-500 dark:text-gray-400">{stat.label}</p>
                      <h3 className="text-2xl font-bold mt-1">{stat.value}</h3>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row items-start gap-4 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm p-4 rounded-lg">
                <div className="flex-1 w-full space-y-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <Input
                      type="text"
                      placeholder="Suche nach Namen, Rollen, Skills oder Orten"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 transition-all duration-200 border-2 focus:border-primary/50 hover:border-gray-400 dark:hover:border-gray-600 w-full"
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

                <div className="flex items-center gap-2 sm:gap-4">
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
                            <div
                              key={skill}
                              className="flex items-center hover:bg-accent rounded px-2 py-1 cursor-pointer transition-colors"
                              onClick={() => setSelectedSkills(prev =>
                                prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill]
                              )}
                            >
                              <div className={`w-3 h-3 border rounded-sm mr-2 transition-colors ${selectedSkills.includes(skill) ? 'bg-primary border-primary' : 'border-input'
                                }`} />
                              <span className="text-sm">{skill}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="p-2">
                        <p className="text-sm font-medium mb-2">Rollen</p>
                        <div className="space-y-1">
                          {uniqueRoles.map(role => (
                            <div
                              key={role}
                              className="flex items-center hover:bg-accent rounded px-2 py-1 cursor-pointer transition-colors"
                              onClick={() => setSelectedRoles(prev =>
                                prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
                              )}
                            >
                              <div className={`w-3 h-3 border rounded-sm mr-2 transition-colors ${selectedRoles.includes(role) ? 'bg-primary border-primary' : 'border-input'
                                }`} />
                              <span className="text-sm">{role}</span>
                            </div>
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
                        className="flex items-center justify-between"
                      >
                        Name {sortBy === 'name' && <span className="text-primary">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleSort('joinedAt')}
                        className="flex items-center justify-between"
                      >
                        Datum {sortBy === 'joinedAt' && <span className="text-primary">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleSort('followers')}
                        className="flex items-center justify-between"
                      >
                        Follower {sortBy === 'followers' && <span className="text-primary">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <div className="flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
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
                        <Button
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

              <ScrollArea className="h-[calc(100vh-320px)]">
                {isLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[...Array(6)].map((_, i) => (
                      <Card key={`skeleton-${i}`} className="animate-pulse">
                        <CardContent className="p-6">
                          <div className="flex space-x-4">
                            <div className="h-16 w-16 rounded-full bg-gray-200 dark:bg-gray-700" />
                            <div className="flex-1 space-y-4">
                              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
                              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4" />
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
                    {filteredMembers.map((member, index) => (
                      <motion.div
                        key={member.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: Math.min(index * 0.05, 0.5) }}
                      >
                        <Card
                          className="group cursor-pointer transition-all duration-200 hover:shadow-lg dark:hover:shadow-primary/5 hover:scale-[1.02]"
                          onClick={() => navigateToProfile(member.id)}
                        >
                          <CardContent className="p-6">
                            <div className="flex space-x-4">
                              <Avatar className="h-16 w-16 ring-2 ring-transparent group-hover:ring-primary/20 transition-all duration-200">
                                <AvatarImage src={member.image} alt={member.name} />
                                <AvatarFallback className="bg-primary/10">
                                  {member.name.slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
                                    {member.name}
                                  </h3>
                                  <Badge variant="outline">{member.role}</Badge>
                                </div>
                                {member.title && (
                                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                    {member.title}
                                  </p>
                                )}
                                <div className="flex items-center gap-4 mt-2 text-sm text-gray-500 dark:text-gray-400">
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
                <ScrollBar />
              </ScrollArea>

              {showScrollTop && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed bottom-8 right-8"
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
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
    </div>
  );
}