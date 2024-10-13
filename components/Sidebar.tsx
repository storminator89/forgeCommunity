"use client";

import Link from 'next/link';
import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { signOut } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
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
  LogOut,
  BookOpen,
  Briefcase,
  Award,
  Library,
  LayoutDashboard
} from 'lucide-react';

const navItems = {
  main: [
    { name: 'Home', icon: Home, href: '/' },
    { name: 'Community', icon: Users, href: '/community' },
  ],
  learn: [
    { name: 'Kurse', icon: GraduationCap, href: '/courses' },
    { name: 'Events', icon: Calendar, href: '/events' },
    { name: 'Ressourcen', icon: BookOpen, href: '/resources' },
    { name: 'Wissensdatenbank', icon: Library, href: '/knowledgebase' },
  ],
  showcase: [
    { name: 'Projekte', icon: Briefcase, href: '/showcases' },
    { name: 'Skills', icon: Award, href: '/skills' },
  ],
  explore: [
    { name: 'Suche', icon: Search, href: '/search' },
    { name: 'Chat', icon: MessageCircle, href: '/chat' },
  ],
  support: [
    { name: 'Über uns', icon: Info, href: '/about' },
    { name: 'Hilfe', icon: HelpCircle, href: '/help' },
  ],
  user: [
    { name: 'Einstellungen', icon: Settings, href: '/settings' },
    { name: 'Benachrichtigungen', icon: Bell, href: '/notifications' },
  ],
  admin: [
    { name: 'Dashboard', icon: LayoutDashboard, href: '/admin/dashboard' },
    { name: 'Benutzerverwaltung', icon: Users, href: '/admin/users' },
  ],
};

export function Sidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const { theme } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();

  const toggleSidebar = () => {
    setIsOpen(!isOpen);
  };

  const handleLogout = async () => {
    await signOut({ redirect: false });
    router.push('/');
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
            <NavSection title="Hauptmenü" items={navItems.main} pathname={pathname} />
            <NavSection title="Lernen" items={navItems.learn} pathname={pathname} />
            <NavSection title="Showcase" items={navItems.showcase} pathname={pathname} />
            <NavSection title="Entdecken" items={navItems.explore} pathname={pathname} />
            <NavSection title="Support" items={navItems.support} pathname={pathname} />
            <NavSection title="Benutzer" items={navItems.user} pathname={pathname} />
            {session?.user?.role === 'ADMIN' && (
              <NavSection title="Administration" items={navItems.admin} pathname={pathname} />
            )}
          </nav>
          <div className="mt-8 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button 
              onClick={handleLogout}
              className="flex items-center space-x-3 p-2 rounded-lg text-red-600 hover:bg-red-100 dark:hover:bg-red-900 transition-colors duration-200 w-full"
            >
              <LogOut className="w-5 h-5 flex-shrink-0" />
              <span className="font-medium">Abmelden</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function NavSection({ title, items, pathname }) {
  return (
    <div>
      <h2 className="text-xs uppercase text-gray-500 dark:text-gray-400 font-semibold mb-2">{title}</h2>
      <ul className="space-y-2">
        {items.map((item) => (
          <NavItem key={item.name} item={item} isActive={pathname === item.href} />
        ))}
      </ul>
    </div>
  );
}

function NavItem({ item, isActive }) {
  return (
    <li>
      <Link 
        href={item.href} 
        className={`flex items-center space-x-3 p-2 rounded-lg transition-colors duration-200
          ${isActive 
            ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-200' 
            : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
      >
        <item.icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-blue-600 dark:text-blue-400' : ''}`} />
        <span className="font-medium">{item.name}</span>
      </Link>
    </li>
  );
}