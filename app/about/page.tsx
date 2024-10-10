"use client";

import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Users, Award, Rocket } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface TeamMember {
  name: string;
  role: string;
  image: string;
}

const teamMembers: TeamMember[] = [
  { name: "Max Mustermann", role: "Gründer & CEO", image: "https://i.pravatar.cc/150?img=1" },
  { name: "Anna Schmidt", role: "CTO", image: "https://i.pravatar.cc/150?img=2" },
  { name: "Lukas Weber", role: "Head of Design", image: "https://i.pravatar.cc/150?img=3" },
  { name: "Sophie Becker", role: "Community Manager", image: "https://i.pravatar.cc/150?img=4" },
];

export default function About() {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-100 dark:bg-gray-900">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-sm z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white ml-12 lg:ml-0">Über uns</h2>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="max-w-4xl mx-auto space-y-12">
            <Card>
              <CardHeader>
                <CardTitle>Unsere Mission</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg text-gray-700 dark:text-gray-300">
                  Bei ForgeCommunity streben wir danach, eine dynamische und inklusive Plattform zu schaffen, 
                  die Menschen zusammenbringt, Wissen teilt und Innovationen fördert. Unser Ziel ist es, 
                  eine Gemeinschaft aufzubauen, in der jeder die Möglichkeit hat, zu lernen, zu wachsen und 
                  sich mit Gleichgesinnten zu vernetzen.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Unser Team</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  {teamMembers.map((member, index) => (
                    <div key={index} className="text-center">
                      <Avatar className="w-32 h-32 mx-auto mb-4">
                        <AvatarImage src={member.image} alt={member.name} />
                        <AvatarFallback>{member.name.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{member.name}</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">{member.role}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Unsere Werte</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                    <Users className="h-12 w-12 text-blue-500 mb-4" />
                    <h3 className="text-xl font-semibold mb-2">Gemeinschaft</h3>
                    <p className="text-gray-600 dark:text-gray-300">Wir fördern eine unterstützende und inklusive Umgebung für alle Mitglieder.</p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                    <Award className="h-12 w-12 text-green-500 mb-4" />
                    <h3 className="text-xl font-semibold mb-2">Exzellenz</h3>
                    <p className="text-gray-600 dark:text-gray-300">Wir streben danach, in allem, was wir tun, Qualität und Innovation zu liefern.</p>
                  </div>
                  <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                    <Rocket className="h-12 w-12 text-purple-500 mb-4" />
                    <h3 className="text-xl font-semibold mb-2">Wachstum</h3>
                    <p className="text-gray-600 dark:text-gray-300">Wir glauben an kontinuierliches Lernen und persönliche Entwicklung.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}