'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { AppHeader, AppShell } from '@/components/app-shell';
import { Sidebar } from '@/components/Sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserNav } from '@/components/user-nav';

export function SpaceShell({ children }: { children: ReactNode }) {
  return <AppShell>
    <Sidebar />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <AppHeader>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <Link href="/community/spaces" className="min-w-0 truncate text-base font-semibold text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Spaces</Link>
          <div className="flex shrink-0 items-center gap-2"><ThemeToggle /><UserNav /></div>
        </div>
      </AppHeader>
      <main id="page-content" tabIndex={-1} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">{children}</div>
      </main>
    </div>
  </AppShell>;
}
