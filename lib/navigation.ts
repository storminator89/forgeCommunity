import { Users, GraduationCap, Calendar, Library, BookOpen, Briefcase, Award, Bookmark,
  MessageCircle, Bell, Settings, Info, LayoutDashboard, Search } from 'lucide-react';

export const navigationGroups = [
  { title: 'Entdecken', items: [
    { name: 'Community', icon: Users, href: '/community' },
    { name: 'Mitglieder', icon: Users, href: '/members' },
    { name: 'Projekte', icon: Briefcase, href: '/showcases', aliases: ['/projects'] },
    { name: 'Events', icon: Calendar, href: '/events' },
  ] },
  { title: 'Wissen & Lernen', items: [
    { name: 'Kurse', icon: GraduationCap, href: '/courses' },
    { name: 'Wissensdatenbank', icon: Library, href: '/knowledgebase' },
    { name: 'Ressourcen', icon: BookOpen, href: '/resources' },
    { name: 'Skills', icon: Award, href: '/skills' },
  ] },
  { title: 'Dein Bereich', items: [
    { name: 'Meine Entwürfe', icon: Bookmark, href: '/knowledgebase/drafts' },
    { name: 'Chat', icon: MessageCircle, href: '/chat' },
    { name: 'Benachrichtigungen', icon: Bell, href: '/notifications' },
    { name: 'Suche', icon: Search, href: '/search' },
  ] },
];
export const utilityNavigation = [
  { name: 'Einstellungen', icon: Settings, href: '/settings' },
  { name: 'Über uns', icon: Info, href: '/about' },
];
export const adminNavigation = [
  { name: 'Dashboard', icon: LayoutDashboard, href: '/admin/dashboard' },
  { name: 'Benutzerverwaltung', icon: Users, href: '/admin/users' },
];
export const navigationItems = [...navigationGroups.flatMap(group => group.items), ...utilityNavigation];
export function isNavigationActive(pathname: string, href: string, aliases: string[] = []) {
  // Drafts have their own menu item, so only one knowledge section is active.
  if (href === '/knowledgebase' && pathname.startsWith('/knowledgebase/drafts')) return false;
  return [href, ...aliases].some(path => pathname === path || pathname.startsWith(`${path}/`));
}
