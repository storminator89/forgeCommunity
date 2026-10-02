"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Search, ArrowUpRight } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { navigationItems, adminNavigation } from '@/lib/navigation';

export function NavigationSearch({ collapsed = false, keyboardShortcut = true, onNavigate }: { collapsed?: boolean; keyboardShortcut?: boolean; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const router = useRouter();
  const { data: session } = useSession();
  const items = session?.user?.role === 'ADMIN' ? [...navigationItems, ...adminNavigation] : navigationItems;
  const matches = items.filter(item => item.name.toLocaleLowerCase('de').includes(query.toLocaleLowerCase('de')));

  useEffect(() => {
    if (!keyboardShortcut) return;
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setOpen(value => !value);
      }
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, [keyboardShortcut]);

  const navigate = (href: string) => { setOpen(false); setQuery(''); onNavigate?.(); router.push(href); };
  return <>
    <button type="button" onClick={() => setOpen(true)} aria-label="Schnellsuche öffnen"
      className={`mb-6 flex h-10 w-full items-center gap-2 rounded-xl border bg-background px-3 text-sm text-muted-foreground hover:border-primary/40 ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}>
      <Search className="h-4 w-4 shrink-0" />
      <span className={collapsed ? 'lg:hidden' : ''}>Schnellsuche</span>
      <kbd className={`ml-auto rounded border px-1.5 py-0.5 text-[10px] ${collapsed ? 'lg:hidden' : ''}`}>⌘/Ctrl K</kbd>
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg gap-4 p-6">
        <DialogTitle>Schnell zum Ziel</DialogTitle>
        <DialogDescription>Springe zu einem Bereich oder suche nach Inhalten.</DialogDescription>
        <form onSubmit={event => { event.preventDefault(); navigate(`/search?q=${encodeURIComponent(query)}`); }}>
          <Input autoFocus aria-label="Bereich oder Inhalt suchen" placeholder="Was suchst du?" value={query} onChange={event => setQuery(event.target.value)} />
        </form>
        <nav aria-label="Suchergebnisse" className="max-h-[50dvh] overflow-y-auto">
          {matches.map(item => <button key={item.href} onClick={() => navigate(item.href)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-accent">
            <item.icon className="h-4 w-4 text-muted-foreground" />{item.name}<ArrowUpRight className="ml-auto h-4 w-4 text-muted-foreground" />
          </button>)}
          {query.trim() && <button onClick={() => navigate(`/search?q=${encodeURIComponent(query)}`)} className="mt-2 w-full rounded-xl bg-accent px-3 py-3 text-left text-sm font-medium text-primary">Inhalte nach „{query}“ durchsuchen →</button>}
        </nav>
      </DialogContent>
    </Dialog>
  </>;
}
