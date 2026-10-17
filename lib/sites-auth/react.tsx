'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { SiteSession } from './server';

type Status = 'loading' | 'authenticated' | 'unauthenticated';
type SessionContextValue = { data: SiteSession | null; status: Status; update: () => Promise<SiteSession | null> };
const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<SiteSession | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const update = useCallback(async () => {
    setStatus('loading');
    try {
      const response = await fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' });
      const session = response.ok ? await response.json() as SiteSession | null : null;
      setData(session);
      setStatus(session?.user?.id ? 'authenticated' : 'unauthenticated');
      return session;
    } catch {
      setData(null);
      setStatus('unauthenticated');
      return null;
    }
  }, []);
  useEffect(() => { void update(); }, [update]);
  const value = useMemo(() => ({ data, status, update }), [data, status, update]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider.');
  return context;
}
