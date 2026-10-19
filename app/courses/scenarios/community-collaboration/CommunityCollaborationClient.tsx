'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { AppHeader, AppShell } from '@/components/app-shell';
import { Sidebar } from '@/components/Sidebar';
import { UserNav } from '@/components/user-nav';
import { ThemeToggle } from '@/components/theme-toggle';
import { LoadingScreen } from '@/components/page-state';
import { CommunityCollaborationMission, IncidentResponseMission } from './CommunityCollaborationMission';
import { MissionSelector } from './MissionSelector';
import { getMission } from './mission-catalog';
import type { MissionId } from './mission-definition';

// The only route choices are authored constants. No route/query content is
// interpreted as a definition, answer, completion state or resume token.
const missionViews = {
  'community-collaboration': CommunityCollaborationMission,
  'incident-response': IncidentResponseMission,
} as const;

export function ScenarioClient({ missionId }: { missionId?: MissionId }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  // Existing course-catalog sign-in boundary; no actual course access changes.
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/');
  }, [status, router]);
  if (status === 'loading') return <LoadingScreen />;
  if (status !== 'authenticated' || !session?.user?.id) return null;
  const mission = missionId ? getMission(missionId) : null;
  const Mission = missionId ? missionViews[missionId] : null;

  return <AppShell data-page-family="learning">
    <Sidebar />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <AppHeader><div className="app-header-row">
        <h1 className="app-header-title">{mission?.title ?? 'Fall wählen'}</h1>
        <div className="app-header-actions"><ThemeToggle /><UserNav /></div>
      </div></AppHeader>
      <main id="page-content" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto">
        {/* Account, role, mission or authored-version changes unmount the entire
            run, recap, alternative draft/result and open restart dialog. */}
        <div key={JSON.stringify([session.user.id, session.user.role, mission?.key ?? 'selector@1'])}>
          {Mission ? <Mission /> : <MissionSelector />}
        </div>
      </main>
    </div>
  </AppShell>;
}

export default function CommunityCollaborationClient() {
  return <ScenarioClient missionId="community-collaboration" />;
}
