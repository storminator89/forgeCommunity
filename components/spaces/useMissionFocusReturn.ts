'use client';

import { useCallback, useEffect, useRef } from 'react';

/** Reloads may replace a control. Return focus only while its original owner still has it. */
export function useMissionFocusReturn() {
  const lease = useRef<{ owner: Element; allowed: boolean } | null>(null);
  useEffect(() => {
    const moved = (event: FocusEvent) => {
      if (lease.current && event.target !== lease.current.owner && event.target !== document.body) lease.current.allowed = false;
    };
    const left = () => { if (lease.current) lease.current.allowed = false; };
    document.addEventListener('focusin', moved);
    window.addEventListener('blur', left);
    return () => { lease.current = null; document.removeEventListener('focusin', moved); window.removeEventListener('blur', left); };
  }, []);
  const capture = useCallback((owner: HTMLElement | null) => {
    lease.current = owner && document.activeElement === owner ? { owner, allowed: true } : null;
  }, []);
  const restore = useCallback((replacement: HTMLElement | null, preventScroll = true) => {
    const current = lease.current;
    lease.current = null;
    if (replacement && current?.allowed && (document.activeElement === current.owner || document.activeElement === document.body)) replacement.focus({ preventScroll });
  }, []);
  return { capture, restore };
}
