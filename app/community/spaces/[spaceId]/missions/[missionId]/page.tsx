'use client';

import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { PageState } from '@/components/page-state';
import { SpaceShell } from '@/components/spaces/SpaceShell';
import { SpaceMissionDetail } from '@/components/spaces/SpaceMissionDetail';

export default function SpaceMissionPage() {
  const params = useParams();
  const { data, status } = useSession();
  const spaceId = typeof params.spaceId === 'string' ? params.spaceId : '';
  const missionId = typeof params.missionId === 'string' ? params.missionId : '';
  if (status === 'loading') return <SpaceShell><h1 className="sr-only">Mission</h1><PageState kind="loading" title="Mission wird geladen" /></SpaceShell>;
  if (!data?.user?.id) return <SpaceShell><h1 className="sr-only">Mission</h1><PageState kind="error" title="Anmeldung erforderlich" /></SpaceShell>;
  return <SpaceMissionDetail key={`${data.user.id}:${data.user.role ?? ''}:${spaceId}:${missionId}`} spaceId={spaceId} missionId={missionId} viewerId={data.user.id} />;
}
