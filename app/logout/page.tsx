'use client';

import { useEffect } from 'react';

export default function LogoutPage() {
  useEffect(() => {
    fetch('/api/auth/logout', { method: 'POST' }).finally(() => window.location.replace('/'));
  }, []);
  return <main className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">Du wirst abgemeldet …</main>;
}
