"use client";

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { ChevronLeft, ChevronRight, Home, LogIn, LogOut, X } from 'lucide-react';
import { useNotifications } from '@/contexts/NotificationContext';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAppNavigation } from '@/components/app-shell';
import { NavigationArtwork } from '@/components/navigation-artwork';
import { NavigationSearch } from '@/components/navigation-search';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ForgeBrandMark } from '@/components/forge-brand-mark';
import { navigationGroups, utilityNavigation, adminNavigation, moderationNavigation, isNavigationActive, canSeeLearnerJourney } from '@/lib/navigation';
import { canSeeLearnerPathways } from '@/lib/pathway-visibility';
import { cn } from '@/lib/utils';
import { useSignInHref } from '@/components/user-nav';

function subscribeCollapse(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener('forge-navigation-change', callback);
  return () => { window.removeEventListener('storage', callback); window.removeEventListener('forge-navigation-change', callback); };
}
function collapsedSnapshot() {
  try { return window.localStorage.getItem('forge-sidebar-collapsed') === 'true'; }
  catch { return false; }
}

interface SidebarProps { className?: string; isOpen?: boolean; onClose?: () => void; hideLearnerPathways?: boolean }

export function Sidebar({ className, isOpen: externalOpen = false, onClose, hideLearnerPathways = false }: SidebarProps) {
  const collapsed = useSyncExternalStore(subscribeCollapse, collapsedSnapshot, () => false);
  const navigation = useAppNavigation();
  const pathname = usePathname();
  const { data, status } = useSession();
  const session = status === 'authenticated' && data?.user?.id ? data : null;
  const signInHref = useSignInHref();
  const { unreadCount } = useNotifications();
  const open = navigation?.open ?? externalOpen;
  const setOpen = (value: boolean) => { navigation?.setOpen(value); if (!value) onClose?.(); };

  const toggleCollapse = () => {
    try { window.localStorage.setItem('forge-sidebar-collapsed', String(!collapsed)); }
    catch { return; }
    window.dispatchEvent(new Event('forge-navigation-change'));
  };

  const renderNavigation = (compact: boolean, mobile = false) => {
    const groups = session ? [...navigationGroups.map(group => ({ ...group, items: group.items.filter(item =>
      (item.href !== '/courses/pathways' || (!hideLearnerPathways && canSeeLearnerPathways(session?.user?.role))) &&
      (item.href !== '/courses/journey' || canSeeLearnerJourney(session?.user?.role))) })), { title: 'Einstellungen', items: utilityNavigation },
      ...(['ADMIN', 'MODERATOR'].includes(session?.user?.role ?? '') ? [{ title: 'Moderation', items: moderationNavigation }] : []),
      ...(session?.user?.role === 'ADMIN' ? [{ title: 'Administration', items: adminNavigation }] : [])]
      : status === 'loading' ? [] : [{ title: 'Entdecken', items: [
        { name: 'Startseite', icon: Home, href: '/' },
        ...navigationGroups.flatMap(group => group.items).filter(item => item.href === '/resources'),
        ...utilityNavigation.filter(item => item.href === '/about'),
      ] }];
    return <div className="flex h-full flex-col">
      <div className={cn("flex h-20 shrink-0 gap-2 px-4", compact ? "h-24 flex-col items-center justify-center gap-1" : "items-center")}>
        <Link href={session ? '/community' : '/'} aria-label="ForgeCommunity Start" className="flex min-h-11 min-w-0 items-center gap-2.5" onClick={() => setOpen(false)}>
          <ForgeBrandMark />
          {!compact && <span className="text-[15px] font-bold tracking-tight">Forge<span className="font-normal text-muted-foreground">Community</span></span>}
        </Link>
        <button type="button" className={cn("hidden h-11 w-11 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-muted hover:text-foreground lg:flex", !compact && "ml-auto")} onClick={toggleCollapse}
          aria-label={compact ? 'Navigation erweitern' : 'Navigation einklappen'} aria-expanded={!compact}>
          {compact ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {session && <NavigationSearch key={JSON.stringify([session.user.id, session.user.role])} collapsed={compact} keyboardShortcut={!mobile} onNavigate={() => setOpen(false)} hideLearnerPathways={hideLearnerPathways} />}
        {status === 'loading' && <p role="status" className={compact ? 'sr-only' : 'px-3 py-3 text-sm text-muted-foreground'}>Anmeldung wird geprüft…</p>}
        <nav aria-label="Hauptnavigation" className="space-y-6">
          {groups.map(group => <div key={group.title}>
            {!compact && <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{group.title}</p>}
            <ul className="space-y-1">
              {group.items.map(item => {
                const aliases = 'aliases' in item && Array.isArray(item.aliases) ? item.aliases as string[] : [];
                const active = isNavigationActive(pathname, item.href, aliases);
                const count = item.href === '/notifications' ? unreadCount : 0;
                const link = <Link href={item.href} aria-current={active ? 'page' : undefined} aria-label={compact ? item.name : undefined}
                  onClick={() => setOpen(false)} className={cn('relative flex min-h-11 items-center gap-3 rounded-[10px] px-3 text-sm transition-colors',
                    compact && 'justify-center px-2', active ? 'bg-accent/70 font-semibold text-foreground before:absolute before:bottom-2 before:left-0 before:top-2 before:w-0.5 before:rounded-full before:bg-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
                  <NavigationArtwork href={item.href} fallback={<item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />} className={active ? 'text-primary' : undefined} />
                  {!compact && <span className="truncate">{item.name}</span>}
                  {count > 0 && <span aria-label={`${count} ungelesene Benachrichtigungen`} className={cn('flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground', compact ? 'absolute right-0 top-0' : 'ml-auto')}>
                    {count > 99 ? '99+' : count}
                  </span>}
                </Link>;
                return <li key={item.href}>{compact ? <Tooltip><TooltipTrigger asChild>{link}</TooltipTrigger><TooltipContent side="right">{item.name}</TooltipContent></Tooltip> : link}</li>;
              })}
            </ul>
          </div>)}
        </nav>
      </div>
      <div className="flex shrink-0 items-center gap-3 border-t px-4 py-4">
        {session ? <>
          <Avatar className="h-10 w-10 shrink-0"><AvatarImage src={session.user.image || ''} alt="" /><AvatarFallback className="bg-primary text-primary-foreground">{session.user.name?.[0] || 'F'}</AvatarFallback></Avatar>
          {!compact && <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{session.user.name || 'Deine Community'}</p><button type="button" onClick={() => { void signOut({ callbackUrl: '/login', redirect: true }); }} className="min-h-7 text-xs text-muted-foreground hover:text-primary">Abmelden</button></div>}
          {compact && <button type="button" onClick={() => { void signOut({ callbackUrl: '/login', redirect: true }); }} aria-label="Abmelden" className="sr-only focus:not-sr-only"><LogOut className="h-4 w-4" /></button>}
        </> : status === 'loading' ? <span className="h-11 w-full rounded-[10px] bg-muted" aria-hidden="true" />
          : <Link prefetch={false} href={signInHref} onClick={() => setOpen(false)} aria-label="Anmelden"
            className={cn('flex min-h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90', compact && 'px-0')}>
            <LogIn className="h-4 w-4 shrink-0" aria-hidden="true" /><span className={compact ? 'sr-only' : undefined}>Anmelden</span>
          </Link>}
      </div>
    </div>;
  };

  return <TooltipProvider delayDuration={700}>
    <aside id="app-navigation-rail" className={cn('app-sidebar hidden shrink-0 border-r bg-card lg:block', collapsed ? 'w-[88px]' : 'w-[264px]', className)}>
      {renderNavigation(collapsed)}
    </aside>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent id="app-navigation" side="left" className="w-[min(300px,90vw)] p-0 [&>button:last-child]:hidden"
        onCloseAutoFocus={event => {
          // The opener lives in AppHeader, outside Radix's SheetTrigger tree.
          const trigger = navigation?.triggerRef.current;
          if (trigger) { event.preventDefault(); trigger.focus(); }
        }}>
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">Bereiche von ForgeCommunity</SheetDescription>
        <button type="button" onClick={() => setOpen(false)} className="absolute right-2 top-[18px] flex h-11 w-11 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Navigation schließen"><X className="h-5 w-5" /></button>
        {open && renderNavigation(false, true)}
      </SheetContent>
    </Sheet>
  </TooltipProvider>;
}
