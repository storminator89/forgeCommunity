"use client";

import { createContext, useContext, useState } from 'react';
import type { HTMLAttributes } from 'react';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const NavigationContext = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
} | null>(null);

export const useAppNavigation = () => useContext(NavigationContext);

/** Shared viewport and navigation ownership for every authenticated screen. */
export function AppShell({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const [open, setOpen] = useState(false);
  return (
    <NavigationContext.Provider value={{ open, setOpen }}>
      <div className={cn('app-shell', className)} {...props}>
        <a href="#page-content" className="skip-link">Zum Inhalt springen</a>
        {children}
      </div>
    </NavigationContext.Provider>
  );
}

/** Keeps page-specific actions while giving every header the same mobile menu. */
export function AppHeader({ children, className, ...props }: HTMLAttributes<HTMLElement>) {
  const navigation = useAppNavigation();
  return (
    <header className={cn('app-header', className)} {...props}>
      <Button variant="ghost" size="icon" className="app-menu lg:hidden"
        aria-label="Navigation öffnen" aria-controls="app-navigation"
        aria-expanded={navigation?.open ?? false} onClick={() => navigation?.setOpen(true)}>
        <Menu className="h-5 w-5" />
      </Button>
      {children}
    </header>
  );
}
