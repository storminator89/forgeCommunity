"use client";

import Link from 'next/link';
import { useState } from 'react';
import { useTheme } from 'next-themes';
import { 
  Home, 
  Users, 
  GraduationCap, 
  Calendar, 
  Info, 
  Search, 
  MessageCircle, 
  Bell, 
  Menu,
  X,
  Settings,
  HelpCircle,
  LogOut
} from 'lucide-react';

const mainNavItems = [
  { name: 'Home', icon: Home, href: '/' },
  { name: 'Community', icon: Users, href: '/community' },
  { name: 'Kurse', icon: GraduationCap, href: '/courses' },
  { name: 'Events', icon: Calendar, href: '/events' },
];

const exploreNavItems = [
  { name: 'Suche', icon: Search, href: '/search' },
  { name: 'Chat', icon: MessageCircle, href: '/chat' },
];

const supportNavItems = [
  { name: 'Über uns', icon: Info, href: '/about' },
  { name: 'Hilfe', icon: HelpCircle, href: '/help' },
];

const userNavItems = [
  { name: 'Einstellungen', icon: Settings, href: '/settings' },
  { name: 'Benachrichtigungen', icon: Bell, href: '/notifications' },
];

export function Sidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const { theme } = useTheme();

  const toggleSidebar = () => {
    setIsOpen(!isOpen);
  };

  return (
    <>
      <button 
        onClick={toggleSidebar} 
        className="lg:hidden fixed top-4 left-4 z-20 p-2 rounded-md bg-white dark:bg-gray-800 shadow-md"
      >
        {isOpen ? <X size={24} /> : <Menu size={24} />}
      </button>
      <div className={`w-80 bg-white dark:bg-gray-800 text-gray-800 dark:text-white h-screen overflow-y-auto fixed lg:static transition-all duration-300 ease-in-out z-30 ${isOpen ? 'left-0' : '-left-80 lg:left-0'}`}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center space-x-3">
              <div className="bg-blue-600 w-10 h-10 rounded-full flex items-center justify-center">
                <span className="text-white font-bold text-xl">FC</span>
              </div>
              <h1 className="text-2xl font-bold">ForgeCommunity</h1>
            </div>
            <button onClick={toggleSidebar} className="lg:hidden">
              <X size={24} />
            </button>
          </div>
          <nav className="space-y-6">
            <div>
              <h2 className="text-xs uppercase text-gray-500 dark:text-gray-400 font-semibold mb-2">Hauptmenü</h2>
              <ul className="space-y-2">
                {mainNavItems.map((item) => (
                  <NavItem key={item.name} item={item} />
                ))}
              </ul>
            </div>
            <div>
              <h2 className="text-xs uppercase text-gray-500 dark:text-gray-400 font-semibold mb-2">Entdecken</h2>
              <ul className="space-y-2">
                {exploreNavItems.map((item) => (
                  <NavItem key={item.name} item={item} />
                ))}
              </ul>
            </div>
            <div>
              <h2 className="text-xs uppercase text-gray-500 dark:text-gray-400 font-semibold mb-2">Support</h2>
              <ul className="space-y-2">
                {supportNavItems.map((item) => (
                  <NavItem key={item.name} item={item} />
                ))}
              </ul>
            </div>
            <div>
              <h2 className="text-xs uppercase text-gray-500 dark:text-gray-400 font-semibold mb-2">Benutzer</h2>
              <ul className="space-y-2">
                {userNavItems.map((item) => (
                  <NavItem key={item.name} item={item} />
                ))}
              </ul>
            </div>
          </nav>
          <div className="mt-8 pt-4 border-t border-gray-200 dark:border-gray-700">
            <Link href="/logout" className="flex items-center space-x-3 p-2 rounded-lg text-red-600 hover:bg-red-100 dark:hover:bg-red-900 transition-colors duration-200">
              <LogOut className="w-5 h-5 flex-shrink-0" />
              <span className="font-medium">Abmelden</span>
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

function NavItem({ item }) {
  return (
    <li>
      <Link href={item.href} className="flex items-center space-x-3 p-2 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200">
        <item.icon className="w-5 h-5 flex-shrink-0" />
        <span className="font-medium">{item.name}</span>
      </Link>
    </li>
  );
}