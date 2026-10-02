"use client";

import { AppShell, AppHeader } from '@/components/app-shell';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Users, Award, Rocket, Github, Linkedin, Mail } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

const developer = {
  name: "Patrick Meyhöfer",
  role: "Full Stack Developer",
  image: "https://i.pravatar.cc/150?img=4",
  bio: "Leidenschaftlicher Entwickler mit Fokus auf moderne Webtechnologien und User Experience. Creator von ForgeCommunity.",
  links: {
    github: "https://github.com/patrickmeyhoefer",
    linkedin: "https://linkedin.com/in/patrickmeyhoefer",
    email: "mailto:contact@patrickmeyhoefer.com"
  }
};

export default function About() {
  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <h2 className="text-lg sm:text-2xl font-bold text-foreground">Über ForgeCommunity</h2>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </AppHeader>
        <main id="page-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="max-w-4xl mx-auto space-y-8">
            <Card className="border-0 shadow-lg">
              <CardContent className="pt-6">
                <div className="text-center mb-8">
                  <Avatar className="w-40 h-40 mx-auto mb-6 border-4 border-primary">
                    <AvatarImage src={developer.image} alt={developer.name} />
                    <AvatarFallback>{developer.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <h1 className="text-3xl font-bold text-foreground mb-2">{developer.name}</h1>
                  <p className="text-xl text-muted-foreground mb-4">{developer.role}</p>
                  <p className="text-foreground dark:text-muted-foreground max-w-2xl mx-auto mb-6">{developer.bio}</p>
                  <div className="flex justify-center space-x-4">
                    <Button variant="outline" size="icon" asChild>
                      <a href={developer.links.github} aria-label="GitHub-Profil öffnen" target="_blank" rel="noopener noreferrer">
                        <Github className="h-5 w-5" />
                      </a>
                    </Button>
                    <Button variant="outline" size="icon" asChild>
                      <a href={developer.links.linkedin} aria-label="LinkedIn-Profil öffnen" target="_blank" rel="noopener noreferrer">
                        <Linkedin className="h-5 w-5" />
                      </a>
                    </Button>
                    <Button variant="outline" size="icon" asChild>
                      <a href={developer.links.email} aria-label="E-Mail schreiben">
                        <Mail className="h-5 w-5" />
                      </a>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="border-0 shadow-lg transform transition-all hover:scale-105">
                <CardContent className="pt-6">
                  <Users className="h-12 w-12 text-blue-500 mb-4" />
                  <h3 className="text-xl font-semibold mb-2">Community First</h3>
                  <p className="text-muted-foreground">Entwickelt mit Fokus auf Benutzerfreundlichkeit und Community-Engagement.</p>
                </CardContent>
              </Card>
              <Card className="border-0 shadow-lg transform transition-all hover:scale-105">
                <CardContent className="pt-6">
                  <Award className="h-12 w-12 text-green-500 mb-4" />
                  <h3 className="text-xl font-semibold mb-2">Qualität</h3>
                  <p className="text-muted-foreground">Modernste Technologien und beste Entwicklungspraktiken für optimale Performance.</p>
                </CardContent>
              </Card>
              <Card className="border-0 shadow-lg transform transition-all hover:scale-105">
                <CardContent className="pt-6">
                  <Rocket className="h-12 w-12 text-purple-500 mb-4" />
                  <h3 className="text-xl font-semibold mb-2">Innovation</h3>
                  <p className="text-muted-foreground">Kontinuierliche Weiterentwicklung und Anpassung an Community-Bedürfnisse.</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </main>
      </div>
    </AppShell>
  );
}
