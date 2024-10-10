"use client";

import { useState } from 'react';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Menu, Search, Mail, Phone, MapPin } from 'lucide-react';

interface Member {
  id: number;
  name: string;
  email: string;
  phone: string;
  location: string;
  role: string;
  avatar: string;
}

const membersData: Member[] = [
  { id: 1, name: "Max Mustermann", email: "max@example.com", phone: "+49 123 4567890", location: "Berlin", role: "Entwickler", avatar: "https://i.pravatar.cc/150?img=1" },
  { id: 2, name: "Anna Schmidt", email: "anna@example.com", phone: "+49 234 5678901", location: "München", role: "Designer", avatar: "https://i.pravatar.cc/150?img=2" },
  { id: 3, name: "Lukas Weber", email: "lukas@example.com", phone: "+49 345 6789012", location: "Hamburg", role: "Projektmanager", avatar: "https://i.pravatar.cc/150?img=3" },
  // Fügen Sie hier weitere Mitglieder hinzu
];

export default function Members() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const filteredMembers = membersData.filter(member =>
    member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    member.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
    member.location.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
              <h2 className="text-xl font-bold text-gray-800 dark:text-white">Mitglieder</h2>
            </div>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="max-w-6xl mx-auto">
            <div className="mb-6">
              <Input
                type="text"
                placeholder="Suche nach Mitgliedern, Rollen oder Orten"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full max-w-md"
                icon={<Search className="h-5 w-5 text-gray-400" />}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredMembers.map((member) => (
                <div
                  key={member.id}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 cursor-pointer hover:shadow-lg transition-shadow duration-200"
                  onClick={() => setSelectedMember(member)}
                >
                  <div className="flex items-center space-x-4">
                    <img src={member.avatar} alt={member.name} className="w-16 h-16 rounded-full" />
                    <div>
                      <h3 className="text-lg font-semibold text-gray-800 dark:text-white">{member.name}</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-300">{member.role}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{member.location}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
      <Dialog open={!!selectedMember} onOpenChange={() => setSelectedMember(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedMember?.name}</DialogTitle>
            <DialogDescription>{selectedMember?.role}</DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-3">
            <div className="flex items-center">
              <Mail className="h-5 w-5 mr-2 text-gray-400" />
              <span>{selectedMember?.email}</span>
            </div>
            <div className="flex items-center">
              <Phone className="h-5 w-5 mr-2 text-gray-400" />
              <span>{selectedMember?.phone}</span>
            </div>
            <div className="flex items-center">
              <MapPin className="h-5 w-5 mr-2 text-gray-400" />
              <span>{selectedMember?.location}</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}