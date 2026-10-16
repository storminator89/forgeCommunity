"use client";

import { createContext, useContext, useRef, useState } from 'react';
import type { HTMLAttributes, RefObject } from 'react';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const NavigationContext = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
} | null>(null);

export const useAppNavigation = () => useContext(NavigationContext);

/** Shared viewport and navigation ownership for every authenticated screen. */
export function AppShell({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <NavigationContext.Provider value={{ open, setOpen, triggerRef }}>
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
      <div className="app-header-layout">
        <Button ref={navigation?.triggerRef} type="button" variant="ghost" size="icon" className="app-menu lg:hidden"
          aria-label="Navigation öffnen" aria-controls={navigation?.open ? 'app-navigation' : undefined}
          aria-expanded={navigation?.open ?? false} onClick={() => navigation?.setOpen(true)}>
          <Menu className="h-5 w-5" />
        </Button>
        {children}
      </div>
    </header>
  );
}
