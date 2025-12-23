// components/Sidebar.tsx
"use client";

import Link from 'next/link';
import { useState, createContext, useContext } from 'react';
import { useSession } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { signOut } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import { useNotifications } from "@/contexts/NotificationContext";
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

    { name: 'Über uns', icon: Info, href: '/about' },
  ],
  admin: [
    { name: 'Dashboard', icon: LayoutDashboard, href: '/admin/dashboard' },
    { name: 'Benutzerverwaltung', icon: Users, href: '/admin/users' },
  ],
};

interface SidebarProps {
  className?: string;
  isOpen?: boolean;
  onClose?: () => void;
}

const SidebarContext = createContext({ isCollapsed: false });

export function Sidebar({ className, isOpen: externalIsOpen, onClose }: SidebarProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { theme } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();

  const isControlled = externalIsOpen !== undefined;
  const isOpen = isControlled ? externalIsOpen : internalIsOpen;

  const toggleSidebar = () => {
    if (isControlled) {
      onClose?.();
    } else {
      setInternalIsOpen(!internalIsOpen);
    }
  };

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  const handleLogout = async () => {
    await signOut({ redirect: false });
    router.push('/');
  };

  return (
    <SidebarContext.Provider value={{ isCollapsed }}>
      {!isControlled && (
        <button
          onClick={toggleSidebar}
          className="lg:hidden fixed top-4 left-4 z-20 p-2 rounded-md bg-white dark:bg-gray-800 shadow-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      )}

      {/* Overlay for mobile when sidebar is open */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={toggleSidebar}
        />
      )}

      <div className={`
        w-72 bg-white dark:bg-gray-800 text-gray-800 dark:text-white h-screen overflow-y-auto 
        fixed lg:static transition-all duration-300 ease-in-out z-30 border-r border-gray-200 dark:border-gray-700
        ${isOpen ? 'left-0' : '-left-72 lg:left-0'} 
        ${isCollapsed ? 'lg:w-20' : 'lg:w-72'}
      `}>
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
            <NavSection title="Community" items={navItems.main} pathname={pathname} />
            <NavSection title="Inhalte" items={navItems.content} pathname={pathname} />
            <NavSection title="Persönlich" items={navItems.personal} pathname={pathname} />
            <NavSection title="Interaktion" items={navItems.interact} pathname={pathname} />
            <NavSection title="Einstellungen" items={navItems.settings} pathname={pathname} />
            {session?.user?.role === 'ADMIN' && (
              <NavSection title="Administration" items={navItems.admin} pathname={pathname} />
            )}
          </nav>
          <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={handleLogout}
              className="flex items-center space-x-3 p-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-200 w-full group"
            >
              <LogOut className="w-5 h-5 flex-shrink-0 group-hover:scale-110 transition-transform" />
              <span className="font-medium">Abmelden</span>
            </button>
          </div>
        </div>
      </div>
    </SidebarContext.Provider>
  );
}

interface NavItemProps {
  name: string;
  icon: any; // Using any for Lucide icon component type as it's complex to type precisely without importing from lucide-react
  href: string;
}

interface NavSectionProps {
  title: string;
  items: NavItemProps[];
  pathname: string;
}

function NavSection({ title, items, pathname }: NavSectionProps) {
  const { isCollapsed } = useContext(SidebarContext);

  return (
    <div>
      {!isCollapsed && (
        <h2 className="text-xs uppercase text-gray-500 dark:text-gray-400 font-semibold mb-2">{title}</h2>
      )}
      <ul className="space-y-2">
        {items.map((item) => (
          <NavItem key={item.name} item={item} isActive={pathname === item.href} />
        ))}
      </ul>
    </div>
  );
}

function NavItem({ item, isActive }: { item: NavItemProps; isActive: boolean }) {
  const { unreadCount } = useNotifications();
  const { isCollapsed } = useContext(SidebarContext);
  const isNotifications = item.name === 'Benachrichtigungen';

  const content = (
    <Link
      href={item.href}
      className={`flex items-center space-x-3 p-2 rounded-lg transition-colors duration-200 relative
        ${isActive
          ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-200'
          : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
        } ${isCollapsed ? 'justify-center' : ''}`}
    >
      <item.icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-blue-600 dark:text-blue-400' : ''}`} />
      {!isCollapsed && <span className="font-medium">{item.name}</span>}
      {isNotifications && unreadCount > 0 && (
        <Badge
          className={`absolute ${isCollapsed ? 'top-0 right-0' : '-right-1 -top-1'} min-w-[20px] h-5 flex items-center justify-center bg-red-500 text-white`}
          variant="default"
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </Badge>
      )}
    </Link>
  );

  if (isNotifications && unreadCount > 0) {
    return (
      <li>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              {content}
            </TooltipTrigger>
            <TooltipContent side={isCollapsed ? "right" : "top"}>
              <p>{unreadCount} ungelesene Benachrichtigung{unreadCount !== 1 ? 'en' : ''}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </li>
    );
  }

  if (isCollapsed) {
    return (
      <li>
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
      </li>
    );
  }

  return <li>{content}</li>;
}