"use client";

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { ChevronLeft, ChevronRight, Flame, LogOut, X } from 'lucide-react';
import { useNotifications } from '@/contexts/NotificationContext';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAppNavigation } from '@/components/app-shell';
import { NavigationSearch } from '@/components/navigation-search';
import { navigationGroups, utilityNavigation, adminNavigation, isNavigationActive } from '@/lib/navigation';
import { cn } from '@/lib/utils';

function subscribeCollapse(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener('forge-navigation-change', callback);
  return () => { window.removeEventListener('storage', callback); window.removeEventListener('forge-navigation-change', callback); };
}
function collapsedSnapshot() {
  try { return window.localStorage.getItem('forge-sidebar-collapsed') === 'true'; }
  catch { return false; }
}

interface SidebarProps { className?: string; isOpen?: boolean; onClose?: () => void }

export function Sidebar({ className, isOpen: externalOpen = false, onClose }: SidebarProps) {
  const collapsed = useSyncExternalStore(subscribeCollapse, collapsedSnapshot, () => false);
  const navigation = useAppNavigation();
  const pathname = usePathname();
  const { data: session } = useSession();
  const { unreadCount } = useNotifications();
  const open = navigation?.open ?? externalOpen;
  const setOpen = (value: boolean) => { navigation?.setOpen(value); if (!value) onClose?.(); };

  const toggleCollapse = () => {
    try { window.localStorage.setItem('forge-sidebar-collapsed', String(!collapsed)); }
    catch { return; }
    window.dispatchEvent(new Event('forge-navigation-change'));
  };

  const renderNavigation = (compact: boolean, mobile = false) => {
    const groups = [...navigationGroups, { title: 'Einstellungen', items: utilityNavigation },
      ...(session?.user?.role === 'ADMIN' ? [{ title: 'Administration', items: adminNavigation }] : [])];
    return <div className="flex h-full flex-col">
      <div className={cn("flex h-20 shrink-0 gap-2 px-4", compact ? "flex-col items-center justify-center gap-1" : "items-center")}>
        <Link href="/community" aria-label="ForgeCommunity Start" className="flex min-w-0 items-center gap-2.5" onClick={() => setOpen(false)}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Flame className="h-5 w-5" /></span>
          {!compact && <span className="text-[15px] font-bold tracking-tight">Forge<span className="font-normal text-muted-foreground">Community</span></span>}
        </Link>
        <button className={cn("hidden rounded-lg p-1.5 text-muted-foreground hover:bg-accent lg:block", !compact && "ml-auto")} onClick={toggleCollapse}
          aria-label={compact ? 'Navigation erweitern' : 'Navigation einklappen'} aria-expanded={!compact}>
          {compact ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <NavigationSearch collapsed={compact} keyboardShortcut={!mobile} onNavigate={() => setOpen(false)} />
        <nav aria-label="Hauptnavigation" className="space-y-5">
          {groups.map(group => <div key={group.title}>
            {!compact && <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{group.title}</p>}
            <ul className="space-y-1">
              {group.items.map(item => {
                const aliases = 'aliases' in item && Array.isArray(item.aliases) ? item.aliases as string[] : [];
                const active = isNavigationActive(pathname, item.href, aliases);
                const count = item.href === '/notifications' ? unreadCount : 0;
                const link = <Link href={item.href} aria-current={active ? 'page' : undefined} aria-label={compact ? item.name : undefined}
                  onClick={() => setOpen(false)} className={cn('relative flex min-h-10 items-center gap-3 rounded-xl px-3 text-[13px] transition-colors',
                    compact && 'justify-center px-2', active ? 'bg-accent font-semibold text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
                  <item.icon className="h-[18px] w-[18px] shrink-0" />
                  {!compact && <span className="truncate">{item.name}</span>}
                  {count > 0 && <span aria-label={`${count} ungelesene Benachrichtigungen`} className={cn('flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground', compact ? 'absolute right-0 top-0' : 'ml-auto')}>
                    {count > 99 ? '99+' : count}
                  </span>}
                </Link>;
                return <li key={item.href}>{compact ? <Tooltip><TooltipTrigger asChild>{link}</TooltipTrigger><TooltipContent side="right">{item.name}</TooltipContent></Tooltip> : link}</li>;
              })}
            </ul>
          </div>)}
        </nav>
      </div>
      <div className="shrink-0 border-t px-3 py-3">
        {!compact && <p className="mb-2 truncate px-3 text-xs font-medium">{session?.user?.name || 'Deine Community'}</p>}
        <button onClick={() => signOut({ callbackUrl: '/login' })} aria-label="Abmelden" className={cn('flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground', compact && 'justify-center')}>
          <LogOut className="h-[18px] w-[18px]" />{!compact && 'Abmelden'}
        </button>
      </div>
    </div>;
  };

  return <TooltipProvider delayDuration={150}>
    <aside id="app-navigation" className={cn('app-sidebar hidden shrink-0 border-r bg-card lg:block', collapsed ? 'w-[88px]' : 'w-[252px]', className)}>
      {renderNavigation(collapsed)}
    </aside>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="left" className="w-[min(300px,90vw)] p-0 [&>button]:hidden">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">Bereiche von ForgeCommunity</SheetDescription>
        <button onClick={() => setOpen(false)} className="absolute right-3 top-6 rounded-lg p-2 text-muted-foreground" aria-label="Navigation schließen"><X className="h-4 w-4" /></button>
        {open && renderNavigation(false, true)}
      </SheetContent>
    </Sheet>
  </TooltipProvider>;
}
