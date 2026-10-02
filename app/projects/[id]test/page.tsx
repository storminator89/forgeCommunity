"use client";

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LegacyProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  useEffect(() => {
    router.replace(`/projects/${encodeURIComponent(id)}`);
  }, [id, router]);

  return <main id="page-content" tabIndex={-1} className="flex min-h-screen items-center justify-center" role="status">Projekt wird geöffnet…</main>;
}
