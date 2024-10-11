"use client";

import { useState } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Award, Star, Mail, ExternalLink, Filter } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";

interface Skill {
  id: number;
  name: string;
  category: string;
}

interface Member {
  id: number;
  name: string;
  avatar: string;
  title: string;
  skills: { skill: Skill; level: number }[];
  endorsements: number;
  bio: string;
  contact: string;
}

const skillsData: Skill[] = [
  { id: 1, name: "JavaScript", category: "Programming" },
  { id: 2, name: "React", category: "Frontend" },
  { id: 3, name: "Node.js", category: "Backend" },
  { id: 4, name: "Python", category: "Programming" },
  { id: 5, name: "UI Design", category: "Design" },
  { id: 6, name: "Data Analysis", category: "Data Science" },
];

const membersData: Member[] = [
  {
    id: 1,
    name: "Alice Johnson",
    avatar: "https://i.pravatar.cc/150?img=1",
    title: "Frontend Developer",
    skills: [
      { skill: skillsData[0], level: 90 },
      { skill: skillsData[1], level: 85 }
    ],
    endorsements: 15,
    bio: "Passionate frontend developer with 5 years of experience in creating responsive and user-friendly web applications.",
    contact: "alice@example.com"
  },
  {
    id: 2,
    name: "Bob Smith",
    avatar: "https://i.pravatar.cc/150?img=2",
    title: "Full Stack Developer",
    skills: [
      { skill: skillsData[0], level: 80 },
      { skill: skillsData[1], level: 75 },
      { skill: skillsData[2], level: 85 }
    ],
    endorsements: 22,
    bio: "Full stack developer with expertise in both frontend and backend technologies. Love to build scalable web applications.",
    contact: "bob@example.com"
  },
  {
    id: 3,
    name: "Carol Williams",
    avatar: "https://i.pravatar.cc/150?img=3",
    title: "UX Designer",
    skills: [
      { skill: skillsData[4], level: 95 }
    ],
    endorsements: 18,
    bio: "UX designer focused on creating intuitive and beautiful user interfaces. Advocate for user-centered design principles.",
    contact: "carol@example.com"
  },
  {
    id: 4,
    name: "David Brown",
    avatar: "https://i.pravatar.cc/150?img=4",
    title: "Data Scientist",
    skills: [
      { skill: skillsData[3], level: 88 },
      { skill: skillsData[5], level: 92 }
    ],
    endorsements: 30,
    bio: "Data scientist with a strong background in machine learning and statistical analysis. Passionate about extracting insights from complex datasets.",
    contact: "david@example.com"
  },
];

export default function SkillDirectory() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [sortBy, setSortBy] = useState('endorsements');

  const categories = ['All', ...new Set(skillsData.map(skill => skill.category))];

  const filteredMembers = membersData.filter(member =>
    (selectedCategory === 'All' || member.skills.some(s => s.skill.category === selectedCategory)) &&
    (member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
     member.skills.some(s => s.skill.name.toLowerCase().includes(searchTerm.toLowerCase())))
  ).sort((a, b) => {
    if (sortBy === 'endorsements') return b.endorsements - a.endorsements;
    return a.name.localeCompare(b.name);
  });

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
            <Tabs defaultValue="All" className="w-full sm:w-auto" onValueChange={setSelectedCategory}>
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
                  <SelectItem value="endorsements">Meiste Empfehlungen</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                </SelectContent>
              </Select>
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
                    </CardHeader>
                    <CardContent className="flex-grow">
                      <div className="space-y-4 mb-4">
                        {member.skills.slice(0, 3).map(({ skill, level }) => (
                          <div key={skill.id} className="space-y-1">
                            <div className="flex justify-between">
                              <Badge variant="outline">{skill.name}</Badge>
                              <span className="text-sm text-gray-500">{level}%</span>
                            </div>
                            <Progress value={level} className="w-full" />
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center justify-between mt-4">
                        <span className="flex items-center text-sm text-gray-500">
                          <Star className="h-4 w-4 mr-1 text-yellow-500" />
                          {member.endorsements} Empfehlungen
                        </span>
                        <Button onClick={() => setSelectedMember(member)}>
                          Profil ansehen
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
                {selectedMember?.skills.map(({ skill, level }) => (
                  <div key={skill.id} className="space-y-1">
                    <div className="flex justify-between">
                      <Badge variant="outline">{skill.name}</Badge>
                      <span className="text-sm text-gray-500">{level}%</span>
                    </div>
                    <Progress value={level} className="w-full" />
                  </div>
                ))}
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