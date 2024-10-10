"use client";

import { useState } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Menu, Users, Award, Rocket } from 'lucide-react';

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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  return (
    <div className="flex min-h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar isOpen={isSidebarOpen} toggleSidebar={toggleSidebar} />
      <div className="flex-1 flex flex-col">
        <header className="bg-white dark:bg-gray-800 shadow-sm z-40 sticky top-0">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <div className="flex items-center">
              <Button variant="ghost" size="icon" className="lg:hidden mr-2" onClick={toggleSidebar}>
                <Menu className="h-6 w-6" />
              </Button>
              <h2 className="text-xl font-bold text-gray-800 dark:text-white">Über uns</h2>
            </div>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="max-w-4xl mx-auto space-y-12">
            <section>
              <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">Unsere Mission</h2>
              <p className="text-lg text-gray-700 dark:text-gray-300">
                Bei ForgeCommunity streben wir danach, eine dynamische und inklusive Plattform zu schaffen, 
                die Menschen zusammenbringt, Wissen teilt und Innovationen fördert. Unser Ziel ist es, 
                eine Gemeinschaft aufzubauen, in der jeder die Möglichkeit hat, zu lernen, zu wachsen und 
                sich mit Gleichgesinnten zu vernetzen.
              </p>
            </section>

            <section>
              <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">Unser Team</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {teamMembers.map((member, index) => (
                  <div key={index} className="text-center">
                    <img src={member.image} alt={member.name} className="w-32 h-32 rounded-full mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{member.name}</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{member.role}</p>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">Unsere Werte</h2>
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
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}