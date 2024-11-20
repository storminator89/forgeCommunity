"use client";

import Link from 'next/link';
import { useState, createContext, useContext, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { signOut } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import { useNotifications } from "@/contexts/NotificationContext";
import type { Locale } from "@/i18n/settings";
import { getDictionary } from "@/i18n/getDictionary";
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
  LayoutDashboard,
  BookmarkIcon,
  ChevronRight,
  ChevronLeft
} from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SidebarProps {
  className?: string;
}

const SidebarContext = createContext({ isCollapsed: false });

const navItems = {
  main: [
    { name: 'Community', icon: Users, href: '/community' },
    { name: 'Mitglieder', icon: Users, href: '/members' },
  ],
  content: [
    { name: 'Kurse', icon: GraduationCap, href: '/courses' },
    { name: 'Events', icon: Calendar, href: '/events' },
    { name: 'Wissensdatenbank', icon: Library, href: '/knowledgebase' },
    { name: 'Ressourcen', icon: BookOpen, href: '/resources' },
  ],
  personal: [
    { name: 'Meine Entwürfe', icon: BookmarkIcon, href: '/knowledgebase/drafts' },
    { name: 'Projekte', icon: Briefcase, href: '/showcases' },
    { name: 'Skills', icon: Award, href: '/skills' },
  ],
  interact: [
    { name: 'Suche', icon: Search, href: '/search' },
    { name: 'Chat', icon: MessageCircle, href: '/chat' },
    { name: 'Benachrichtigungen', icon: Bell, href: '/notifications' },
  ],
  settings: [
    { name: 'Einstellungen', icon: Settings, href: '/settings' },
    { name: 'Hilfe', icon: HelpCircle, href: '/help' },
    { name: 'Über uns', icon: Info, href: '/about' },
  ],
  admin: [
    { name: 'Dashboard', icon: LayoutDashboard, href: '/admin/dashboard' },
    { name: 'Benutzerverwaltung', icon: Users, href: '/admin/users' },
  ],
};

export function Sidebar({ className }: SidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [dict, setDict] = useState<any>(null);
  const { theme } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();

  // Extrahiere die Sprache aus dem Pathname
  const lang = pathname?.split('/')[1] as Locale || 'de';

  useEffect(() => {
    const loadDictionary = async () => {
      const dictionary = await getDictionary(lang);
      setDict(dictionary);
      
      // Aktualisiere die navItems mit den Übersetzungen
      navItems.main = [
        { name: dictionary.navigation.community, icon: Users, href: `/${lang}/community` },
        { name: dictionary.navigation.members, icon: Users, href: `/${lang}/members` },
      ];
      navItems.content = [
        { name: dictionary.navigation.courses, icon: GraduationCap, href: `/${lang}/courses` },
        { name: dictionary.navigation.events, icon: Calendar, href: `/${lang}/events` },
        { name: dictionary.navigation.knowledgebase, icon: Library, href: `/${lang}/knowledgebase` },
        { name: dictionary.navigation.resources, icon: BookOpen, href: `/${lang}/resources` },
      ];
      navItems.personal = [
        { name: dictionary.navigation.drafts, icon: BookmarkIcon, href: `/${lang}/knowledgebase/drafts` },
        { name: dictionary.navigation.projects, icon: Briefcase, href: `/${lang}/showcases` },
        { name: dictionary.navigation.skills, icon: Award, href: `/${lang}/skills` },
      ];
      navItems.interact = [
        { name: dictionary.navigation.search, icon: Search, href: `/${lang}/search` },
        { name: dictionary.navigation.chat, icon: MessageCircle, href: `/${lang}/chat` },
        { name: dictionary.navigation.notifications, icon: Bell, href: `/${lang}/notifications` },
      ];
      navItems.settings = [
        { name: dictionary.navigation.settings, icon: Settings, href: `/${lang}/settings` },
        { name: dictionary.navigation.help, icon: HelpCircle, href: `/${lang}/help` },
        { name: dictionary.navigation.about, icon: Info, href: `/${lang}/about` },
      ];
      navItems.admin = [
        { name: dictionary.navigation.dashboard, icon: LayoutDashboard, href: `/${lang}/admin/dashboard` },
        { name: dictionary.navigation.userManagement, icon: Users, href: `/${lang}/admin/users` },
      ];
    };
    loadDictionary();
  }, [lang]); // Reagiere auf Änderungen der Sprache

  const toggleSidebar = () => {
    setIsOpen(!isOpen);
  };

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  const handleLogout = async () => {
    await signOut({ redirect: false });
    router.push(`/${lang}`);
  };

  if (!dict) return null;

  return (
    <SidebarContext.Provider value={{ isCollapsed }}>
      <button 
        onClick={toggleSidebar} 
        className="lg:hidden fixed top-4 left-4 z-20 p-2 rounded-md bg-white dark:bg-gray-800 shadow-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        {isOpen ? <X size={24} /> : <Menu size={24} />}
      </button>
      <div className={`w-72 bg-white dark:bg-gray-800 text-gray-800 dark:text-white h-screen overflow-y-auto fixed lg:static transition-all duration-300 ease-in-out z-30 border-r border-gray-200 dark:border-gray-700 ${isOpen ? 'left-0' : '-left-72 lg:left-0'} ${isCollapsed ? 'lg:w-20' : 'lg:w-72'}`}>
        <div className="p-4">
          <div className="flex items-center justify-between mb-6">
            <div className={`flex items-center space-x-3 ${isCollapsed ? 'lg:justify-center' : ''}`}>
              <div className="bg-blue-600 w-8 h-8 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-lg">FC</span>
              </div>
              {!isCollapsed && <h1 className="text-xl font-bold hidden lg:block">ForgeCommunity</h1>}
            </div>
            <div className="flex items-center">
              <button onClick={toggleSidebar} className="lg:hidden hover:bg-gray-100 dark:hover:bg-gray-700 p-1 rounded-lg transition-colors">
                <X size={20} />
              </button>
              <button 
                onClick={toggleCollapse} 
                className="hidden lg:flex hover:bg-gray-100 dark:hover:bg-gray-700 p-1 rounded-lg transition-colors ml-2"
              >
                {isCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
              </button>
            </div>
          </div>
          <nav className="space-y-4">
            <NavSection title={dict.navigation.sections.main} items={navItems.main} pathname={pathname} />
            <NavSection title={dict.navigation.sections.content} items={navItems.content} pathname={pathname} />
            <NavSection title={dict.navigation.sections.personal} items={navItems.personal} pathname={pathname} />
            <NavSection title={dict.navigation.sections.interact} items={navItems.interact} pathname={pathname} />
            <NavSection title={dict.navigation.sections.settings} items={navItems.settings} pathname={pathname} />
            {session?.user?.role === 'ADMIN' && (
              <NavSection title={dict.navigation.sections.admin} items={navItems.admin} pathname={pathname} />
            )}
          </nav>
          <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button 
              onClick={handleLogout}
              className="flex items-center space-x-3 p-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-200 w-full group"
            >
              <LogOut className="w-5 h-5 flex-shrink-0 group-hover:scale-110 transition-transform" />
              <span className="font-medium">{dict.navigation.logout}</span>
            </button>
          </div>
        </div>
      </div>
    </SidebarContext.Provider>
  );
}

function NavSection({ title, items, pathname }: { title: string, items: any[], pathname: string }) {
  const { isCollapsed } = useContext(SidebarContext);

  if (!items?.length) return null;

  return (
    <div>
      {!isCollapsed && (
        <h2 className="px-2 mb-2 text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {title}
        </h2>
      )}
      <div className="space-y-1">
        {items.map((item) => (
          <NavItem key={item.href} item={item} isActive={pathname === item.href} />
        ))}
      </div>
    </div>
  );
}

function NavItem({ item, isActive }: { item: any, isActive: boolean }) {
  const { isCollapsed } = useContext(SidebarContext);
  const Icon = item.icon;

  const content = (
    <Link
      href={item.href}
      className={`flex items-center space-x-3 p-2 rounded-lg transition-all duration-200 group ${
        isActive
          ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
          : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
      }`}
    >
      <Icon className={`w-5 h-5 flex-shrink-0 ${
        isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'
      } group-hover:scale-110 transition-transform`} />
      {!isCollapsed && <span className="font-medium">{item.name}</span>}
    </Link>
  );

  return isCollapsed ? (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {content}
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>{item.name}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : content;
}