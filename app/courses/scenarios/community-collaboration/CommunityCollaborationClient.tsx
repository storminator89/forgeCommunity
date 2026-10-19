'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { AppHeader, AppShell } from '@/components/app-shell';
import { Sidebar } from '@/components/Sidebar';
import { UserNav } from '@/components/user-nav';
import { ThemeToggle } from '@/components/theme-toggle';
import { LoadingScreen } from '@/components/page-state';
import { CommunityCollaborationMission } from './CommunityCollaborationMission';

export default function CommunityCollaborationClient() {
  const { data: session, status } = useSession();
  const router = useRouter();
  // This standalone voluntary case uses the existing course-catalog sign-in
  // boundary. It does not read, grant, or alter access to any actual course.
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/');
  }, [status, router]);
  if (status === 'loading') return <LoadingScreen />;
  if (status !== 'authenticated' || !session?.user?.id) return null;

  return <AppShell data-page-family="learning">
    <Sidebar />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <AppHeader><div className="app-header-row">
        <h1 className="app-header-title">Sicher zusammenarbeiten</h1>
        <div className="app-header-actions"><ThemeToggle /><UserNav /></div>
      </div></AppHeader>
      <main id="page-content" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto">
        {/* Authentication loss or account/role changes unmount all answers. */}
        <CommunityCollaborationMission key={JSON.stringify([session.user.id, session.user.role])} />
      </main>
    </div>
  </AppShell>;
}
