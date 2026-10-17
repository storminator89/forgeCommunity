'use client';

import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useSession } from '@/lib/sites-auth/react';
import { PageState } from '@/components/page-state';
import { SpaceShell } from '@/components/spaces/SpaceShell';
import { useInvitationAccount } from '@/components/spaces/mission-invitation-ui';
import { SpaceMissionDetail } from '@/components/spaces/SpaceMissionDetail';

export default function SpaceMissionPage() {
  return <Suspense fallback={<SpaceShell><PageState kind="loading" title="Mission wird geladen" /></SpaceShell>}><MissionSession /></Suspense>;
}

function MissionSession() {
  const search = useSearchParams();
  const selector = search.get('invitation');
  const invitationId = selector && /^[a-zA-Z0-9_-]{1,80}$/.test(selector) ? selector : undefined;
  const params = useParams();
  const { data, status } = useSession();
  useInvitationAccount(status === 'authenticated' ? data?.user?.id ?? null : status === 'unauthenticated' ? null : undefined);
  const spaceId = typeof params.spaceId === 'string' ? params.spaceId : '';
  const missionId = typeof params.missionId === 'string' ? params.missionId : '';
  if (status === 'loading') return <SpaceShell><h1 className="sr-only">Mission</h1><PageState kind="loading" title="Mission wird geladen" /></SpaceShell>;
  if (!data?.user?.id) return <SpaceShell><h1 className="sr-only">Mission</h1><PageState kind="error" title="Anmeldung erforderlich" /></SpaceShell>;
  return <SpaceMissionDetail key={`${data.user.id}:${data.user.role ?? ''}:${spaceId}:${missionId}`} spaceId={spaceId} missionId={missionId} viewerId={data.user.id} invitationId={invitationId} />;
}
