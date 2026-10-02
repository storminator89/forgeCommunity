"use client";

import { AppShell } from '@/components/app-shell';
import { useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';

export default function AdminShell({
  children,
}: {
  children: React.ReactNode
}) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <AppShell>
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AdminHeader onMenuClick={() => setIsSidebarOpen(true)} />
        <main id="page-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="max-w-[1600px] mx-auto space-y-6">
            {children}
          </div>
        </main>
      </div>
    </AppShell>
  );
}
