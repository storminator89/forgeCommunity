"use client";

import Link from 'next/link';
import { Users, GraduationCap, Calendar, Info, Search, MessageCircle, Bell, Home, Menu } from 'lucide-react';
import { useState } from 'react';
import { useTheme } from 'next-themes';

const navItems = [
  { name: 'Home', icon: Home, href: '/' },
  { name: 'Community', icon: Users, href: '/community' },
  { name: 'Kurse', icon: GraduationCap, href: '/courses' },
  { name: 'Events', icon: Calendar, href: '/events' },
  { name: 'Mitglieder', icon: Users, href: '/members' },
  { name: 'Über uns', icon: Info, href: '/about' },
  { name: 'Suche', icon: Search, href: '/search' },
  { name: 'Chat', icon: MessageCircle, href: '/chat' },
  { name: 'Benachrichtigungen', icon: Bell, href: '/notifications' },
];

export function Sidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const { theme } = useTheme();

  return (
    <>
      <div className="lg:hidden fixed top-0 left-0 z-20 p-4">
        <button onClick={() => setIsOpen(!isOpen)} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          <Menu size={24} />
        </button>
      </div>
      <div className={`w-72 bg-gray-900 dark:bg-gray-800 text-white h-screen overflow-y-auto fixed lg:static transition-all duration-300 ease-in-out z-10 ${isOpen ? 'left-0' : '-left-72 lg:left-0'}`}>
        <div className="p-6">
          <div className="flex items-center space-x-3 mb-8">
            <div className="bg-blue-600 w-10 h-10 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-xl">FC</span>
            </div>
            <h1 className="text-2xl font-bold">ForgeCommunity</h1>
          </div>
          <nav>
            {navItems.map((item) => (
              <Link key={item.name} href={item.href} className="flex items-center space-x-3 p-3 rounded-lg text-gray-300 hover:bg-gray-800 dark:hover:bg-gray-700 hover:text-white transition-colors duration-200">
                <item.icon className="w-5 h-5 flex-shrink-0" />
                <span className="font-medium">{item.name}</span>
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </>
  );
}