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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

    if (searchTerm) {
      result = result.filter(member =>
        member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.location?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.skills.some(skill => skill.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }

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
  }, [members, searchTerm, sortBy, sortOrder]);

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
          <div className="max-w-7xl mx-auto space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[
                { label: 'Alle Mitglieder', value: members.length },
                { label: 'Aktive Mitglieder', value: members.filter(m => m.followers > 0).length },
                { label: 'Durchschn. Skills', value: Math.round(members.reduce((acc, m) => acc + m.skills.length, 0) / members.length) },
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

            <div className="flex flex-col sm:flex-row items-center gap-4 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm p-4 rounded-lg">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Suche nach Namen, Rollen, Skills oder Orten"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-[180px]">
                    <SlidersHorizontal className="w-4 h-4 mr-2" />
                    Sortieren nach: {sortBy}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[180px]">
                  <DropdownMenuItem onClick={() => handleSort('name')}>
                    Name {sortBy === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleSort('joinedAt')}>
                    Datum {sortBy === 'joinedAt' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleSort('followers')}>
                    Follower {sortBy === 'followers' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setViewMode('grid')}
                  className={viewMode === 'grid' ? 'bg-primary/10' : ''}
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setViewMode('list')}
                  className={viewMode === 'list' ? 'bg-primary/10' : ''}
                >
                  <List className="h-4 w-4" />
                </Button>
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
                      transition={{ duration: 0.3, delay: Math.min(index * 0.1, 1) }} // Cap the delay
                    >
                      <Card
                        className="cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-[1.02]"
                        onClick={() => navigateToProfile(member.id)}
                      >
                        <CardContent className="p-6">
                          <div className="flex space-x-4">
                            <Avatar className="h-16 w-16">
                              <AvatarImage src={member.image} alt={member.name} />
                              <AvatarFallback>
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
                                  <span className="flex items-center">
                                    <MapPin className="h-4 w-4 mr-1" />
                                    {member.location}
                                  </span>
                                )}
                                <span className="flex items-center">
                                  <Calendar className="h-4 w-4 mr-1" />
                                  {format(new Date(member.joinedAt), 'MMM yyyy', { locale: de })}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="mt-4">
                            <div className="flex items-center gap-4 text-sm">
                              <span className="flex items-center">
                                <Users className="h-4 w-4 mr-1" />
                                {member.followers} Follower
                              </span>
                              <span className="flex items-center">
                                <Briefcase className="h-4 w-4 mr-1" />
                                {member.skills.length} Skills
                              </span>
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
        </main>
      </div>
    </div>
  );
}