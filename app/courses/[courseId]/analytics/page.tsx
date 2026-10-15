'use client';

/* Hallmark · pre-emit critique: P4 H4 E4 S5 R5 V4. Extends Forge's existing course workbench and tokens. */
import { use } from 'react';
import { useSession } from 'next-auth/react';
import { CourseAnalytics } from './CourseAnalytics';

export default function CourseAnalyticsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params);
  const { data: session, status: sessionStatus } = useSession();
  const accountId = sessionStatus === 'authenticated' ? session?.user?.id ?? null : null;
  return <CourseAnalytics key={JSON.stringify([courseId, accountId])} courseId={courseId} accountId={accountId} sessionStatus={sessionStatus} />;
}
