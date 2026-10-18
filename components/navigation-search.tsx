"use client";

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ArrowUpRight } from 'lucide-react';
import { NavigationArtwork } from '@/components/navigation-artwork';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { navigationItems, adminNavigation, canSeeLearnerJourney } from '@/lib/navigation';
import { canSeeLearnerPathways } from '@/lib/pathway-visibility';

export function NavigationSearch({ collapsed = false, keyboardShortcut = true, onNavigate, hideLearnerPathways = false }: { collapsed?: boolean; keyboardShortcut?: boolean; onNavigate?: () => void; hideLearnerPathways?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const router = useRouter();
  const { data: session, status } = useSession();
  const learnerItems = navigationItems.filter(item =>
    (item.href !== '/courses/pathways' || (!hideLearnerPathways && canSeeLearnerPathways(session?.user?.role))) &&
    (item.href !== '/courses/journey' || (status === 'authenticated' && canSeeLearnerJourney(session?.user?.role))));
  const items = session?.user?.role === 'ADMIN' ? [...learnerItems, ...adminNavigation] : learnerItems;
  const matches = items.filter(item => item.name.toLocaleLowerCase('de').includes(query.toLocaleLowerCase('de')));

  useEffect(() => {
    if (!keyboardShortcut) return;
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (!open) returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setOpen(!open);
      }
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, [keyboardShortcut, open]);

  const navigate = (href: string) => {
    // Navigation owns the next focus target; the old drawer may be closing.
    returnFocusRef.current = null;
    setOpen(false); setQuery(''); onNavigate?.(); router.push(href);
  };
  return <>
    <button type="button" onClick={event => { returnFocusRef.current = event.currentTarget; setOpen(true); }} aria-label="Schnellsuche öffnen"
      className={`mb-5 flex h-11 w-full items-center gap-2 rounded-[10px] border border-input bg-background px-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}>
      <NavigationArtwork href="/search" className="h-4 w-4" />
      <span className={collapsed ? 'lg:hidden' : ''}>Schnellsuche</span>
      <kbd className={`ml-auto rounded-[0.25rem] border px-1.5 py-0.5 text-[11px] ${collapsed ? 'lg:hidden' : ''}`}>⌘/Ctrl K</kbd>
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent aria-describedby={undefined} className="max-w-lg gap-4 border-input p-5 sm:p-7" onCloseAutoFocus={event => {
        // Button and shortcut openers live outside Radix's DialogTrigger tree.
        event.preventDefault();
        const target = returnFocusRef.current;
        returnFocusRef.current = null;
        if (target?.isConnected) target.focus();
      }}>
        <div className="space-y-1">
          <DialogTitle className="text-xl font-semibold tracking-tight">Schnell zum Ziel</DialogTitle>

        </div>
        <form onSubmit={event => { event.preventDefault(); navigate(`/search?q=${encodeURIComponent(query)}`); }}>
          <Input autoFocus aria-label="Bereich oder Inhalt suchen" placeholder="Was suchst du?" value={query} onChange={event => setQuery(event.target.value)} />
        </form>
        <p role="status" className="sr-only">{matches.length} Bereiche gefunden</p>
        <nav aria-label="Suchergebnisse" className="max-h-[50dvh] overflow-y-auto">
          {matches.map(item => <button type="button" key={item.href} onClick={() => navigate(item.href)}
            className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-sm hover:bg-muted">
            <NavigationArtwork href={item.href} className="h-4 w-4" fallback={<item.icon className="h-4 w-4" aria-hidden="true" />} />{item.name}<ArrowUpRight className="ml-auto h-4 w-4 text-muted-foreground" />
          </button>)}
          {query.trim() && <button type="button" onClick={() => navigate(`/search?q=${encodeURIComponent(query)}`)} className="mt-2 min-h-11 w-full rounded-[10px] border border-input bg-background px-3 py-3 text-left text-sm font-medium text-primary hover:bg-accent">Inhalte nach „{query}“ durchsuchen →</button>}
        </nav>
      </DialogContent>
    </Dialog>
  </>;
}
