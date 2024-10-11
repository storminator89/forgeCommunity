"use client";

import { useState } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Briefcase, ThumbsUp, MessageSquare, ExternalLink, Filter, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface Project {
  id: number;
  title: string;
  description: string;
  author: string;
  authorAvatar: string;
  category: string;
  tags: string[];
  likes: number;
  comments: number;
  gradientFrom: string;
  gradientTo: string;
  link: string;
}

const initialProjectsData: Project[] = [
  {
    id: 1,
    title: "KI-gesteuerte Wettervorhersage",
    description: "Ein Projekt, das maschinelles Lernen nutzt, um präzise lokale Wettervorhersagen zu erstellen.",
    author: "Anna Schmidt",
    authorAvatar: "https://i.pravatar.cc/150?img=1",
    category: "Data Science",
    tags: ["Machine Learning", "Meteorologie", "Python"],
    likes: 156,
    comments: 23,
    gradientFrom: "#4facfe",
    gradientTo: "#00f2fe",
    link: "https://github.com/example/weather-ai"
  },
  {
    id: 2,
    title: "Eco-Track: Nachhaltigkeits-App",
    description: "Eine mobile App, die Benutzer dabei unterstützt, ihren ökologischen Fußabdruck zu verfolgen und zu reduzieren.",
    author: "Max Mustermann",
    authorAvatar: "https://i.pravatar.cc/150?img=2",
    category: "Mobile Development",
    tags: ["React Native", "Nachhaltigkeit", "UX Design"],
    likes: 89,
    comments: 12,
    gradientFrom: "#43e97b",
    gradientTo: "#38f9d7",
    link: "https://github.com/example/eco-track"
  },
  {
    id: 3,
    title: "Virtual Reality Lernplattform",
    description: "Eine VR-Plattform für immersives Lernen in verschiedenen Fachbereichen.",
    author: "Lena Weber",
    authorAvatar: "https://i.pravatar.cc/150?img=3",
    category: "Virtual Reality",
    tags: ["Unity", "C#", "Bildung"],
    likes: 210,
    comments: 34,
    gradientFrom: "#fa709a",
    gradientTo: "#fee140",
    link: "https://github.com/example/vr-learning"
  },
];

export default function ProjectShowcase() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [projects, setProjects] = useState(initialProjectsData);
  const [isSubmitDialogOpen, setIsSubmitDialogOpen] = useState(false);
  const [newProject, setNewProject] = useState<Partial<Project>>({
    title: '',
    description: '',
    category: '',
    tags: [],
    link: '',
  });

  const filteredProjects = projects.filter(project =>
    (activeTab === 'all' || project.category.toLowerCase() === activeTab.toLowerCase()) &&
    (project.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase())))
  ).sort((a, b) => {
    if (sortBy === 'mostLiked') return b.likes - a.likes;
    if (sortBy === 'mostCommented') return b.comments - a.comments;
    return b.id - a.id; // 'newest' as default
  });

  const categories = ['all', ...new Set(projects.map(project => project.category))];

  const handleSubmitNewProject = () => {
    const projectToAdd: Project = {
      ...newProject as Project,
      id: projects.length + 1,
      author: 'Current User', // This should be replaced with the actual logged-in user
      authorAvatar: 'https://i.pravatar.cc/150?img=4', // This should be replaced with the actual user avatar
      likes: 0,
      comments: 0,
      gradientFrom: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
      gradientTo: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
    };
    setProjects([projectToAdd, ...projects]);
    setIsSubmitDialogOpen(false);
    setNewProject({
      title: '',
      description: '',
      category: '',
      tags: [],
      link: '',
    });
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-md z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white ml-12 lg:ml-0 flex items-center">
              <Briefcase className="mr-2 h-6 w-6" />
              Projekte-Showcase
            </h2>
            <div className="flex items-center space-x-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Suche nach Projekten..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 w-64 rounded-full"
                />
              </div>
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="flex justify-between items-center mb-6">
            <Tabs defaultValue="all" className="w-full" onValueChange={setActiveTab}>
              <TabsList>
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
                  <SelectItem value="newest">Neueste</SelectItem>
                  <SelectItem value="mostLiked">Meist geliked</SelectItem>
                  <SelectItem value="mostCommented">Meist kommentiert</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={() => setIsSubmitDialogOpen(true)} className="mb-6">
            <Plus className="mr-2 h-4 w-4" /> Neues Projekt einreichen
          </Button>
          <AnimatePresence>
            <motion.div
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {filteredProjects.map((project) => (
                <motion.div key={project.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <Card className="h-full flex flex-col hover:shadow-lg transition-shadow duration-300">
                    <CardHeader className="relative p-0">
                      <div
                        className="w-full h-48 rounded-t-lg"
                        style={{
                          background: `linear-gradient(135deg, ${project.gradientFrom}, ${project.gradientTo})`,
                        }}
                      />
                      <Badge className="absolute top-2 right-2" variant="secondary">
                        {project.category}
                      </Badge>
                    </CardHeader>
                    <CardContent className="flex-grow flex flex-col justify-between p-4">
                      <div>
                        <CardTitle className="text-xl mb-2">{project.title}</CardTitle>
                        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">{project.description}</p>
                        <div className="flex flex-wrap gap-2 mb-4">
                          {project.tags.map((tag, index) => (
                            <Badge key={index} variant="outline">{tag}</Badge>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-4">
                        <div className="flex items-center space-x-2">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={project.authorAvatar} />
                            <AvatarFallback>{project.author[0]}</AvatarFallback>
                          </Avatar>
                          <span className="text-sm font-medium">{project.author}</span>
                        </div>
                        <div className="flex items-center space-x-4">
                          <span className="flex items-center text-sm text-gray-500">
                            <ThumbsUp className="h-4 w-4 mr-1" />
                            {project.likes}
                          </span>
                          <span className="flex items-center text-sm text-gray-500">
                            <MessageSquare className="h-4 w-4 mr-1" />
                            {project.comments}
                          </span>
                        </div>
                      </div>
                      <Button className="mt-4" onClick={() => setSelectedProject(project)}>
                        Details anzeigen
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <Dialog open={!!selectedProject} onOpenChange={() => setSelectedProject(null)}>
        <DialogContent className="sm:max-w-[625px]">
          <DialogHeader>
            <DialogTitle>{selectedProject?.title}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div
              className="w-full h-64 rounded-lg"
              style={{
                background: selectedProject ? `linear-gradient(135deg, ${selectedProject.gradientFrom}, ${selectedProject.gradientTo})` : '',
              }}
            />
            <DialogDescription>
              {selectedProject?.description}
            </DialogDescription>
            <div className="flex flex-wrap gap-2">
              {selectedProject?.tags.map((tag, index) => (
                <Badge key={index} variant="secondary">{tag}</Badge>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={selectedProject?.authorAvatar} />
                  <AvatarFallback>{selectedProject?.author[0]}</AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium">{selectedProject?.author}</span>
              </div>
              <div className="flex items-center space-x-4">
                <span className="flex items-center text-sm text-gray-500">
                  <ThumbsUp className="h-4 w-4 mr-1" />
                  {selectedProject?.likes}
                </span>
                <span className="flex items-center text-sm text-gray-500">
                  <MessageSquare className="h-4 w-4 mr-1" />
                  {selectedProject?.comments}
                </span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button asChild>
              <a href={selectedProject?.link} target="_blank" rel="noopener noreferrer">
                Projekt ansehen <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={isSubmitDialogOpen} onOpenChange={setIsSubmitDialogOpen}>
        <DialogContent className="sm:max-w-[625px]">
          <DialogHeader>
            <DialogTitle>Neues Projekt einreichen</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="title" className="text-right">
                Titel
              </Label>
              <Input
                id="title"
                value={newProject.title}
                onChange={(e) => setNewProject({ ...newProject, title: e.target.value })}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="description" className="text-right">
                Beschreibung
              </Label>
              <Textarea
                id="description"
                value={newProject.description}
                onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="category" className="text-right">
                Kategorie
              </Label>
              <Input
                id="category"
                value={newProject.category}
                onChange={(e) => setNewProject({ ...newProject, category: e.target.value })}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="tags" className="text-right">
                Tags
              </Label>
              <Input
                id="tags"
                value={newProject.tags?.join(', ')}
                onChange={(e) => setNewProject({ ...newProject, tags: e.target.value.split(',').map(tag => tag.trim()) })}
                className="col-span-3"
                placeholder="Trennen Sie Tags mit Kommas"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="link" className="text-right">
                Projekt-Link
              </Label>
              <Input
                id="link"
                value={newProject.link}
                onChange={(e) => setNewProject({ ...newProject, link: e.target.value })}
                className="col-span-3"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" onClick={handleSubmitNewProject}>Projekt einreichen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}