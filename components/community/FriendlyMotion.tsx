'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pause, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

const preferenceKey = 'forge-community-motion-off';
const preferenceEvent = 'forge-community-motion-change';
let documentMotionOff = false;
type MotionState = { ready: boolean; off: boolean; systemReduced: boolean };

/** A device-local opt-out. Effects stay off until both preferences are known. */
export function useFriendlyMotion(): { enabled: boolean; toggle: () => void; systemReduced: boolean } {
  const [state, setState] = useState<MotionState>({ ready: false, off: false, systemReduced: false });

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const read = (event?: Event) => {
      let off = documentMotionOff;
      try { off = window.localStorage.getItem(preferenceKey) === 'true'; } catch { /* Retain the document-local choice. */ }
      if (event instanceof CustomEvent && typeof event.detail === 'boolean') off = event.detail;
      documentMotionOff = off;
      setState({ ready: true, off, systemReduced: media?.matches ?? true });
    };
    read();
    media?.addEventListener('change', read);
    window.addEventListener('storage', read);
    window.addEventListener(preferenceEvent, read);
    return () => {
      media?.removeEventListener('change', read);
      window.removeEventListener('storage', read);
      window.removeEventListener(preferenceEvent, read);
    };
  }, []);

  const toggle = useCallback(() => {
    if (!state.ready || state.systemReduced) return;
    const off = !state.off;
    documentMotionOff = off;
    try { window.localStorage.setItem(preferenceKey, String(off)); } catch { /* Same-page sync still works. */ }
    window.dispatchEvent(new CustomEvent(preferenceEvent, { detail: off }));
  }, [state.ready, state.systemReduced, state.off]);

  return { enabled: state.ready && !state.off && !state.systemReduced, toggle, systemReduced: state.systemReduced };
}

export function FriendlyMotionToggle({ className }: { className?: string }) {
  const { enabled, toggle, systemReduced } = useFriendlyMotion();
  const label = systemReduced ? 'Animationen durch Systemeinstellung ausgeschaltet' : enabled ? 'Animationen ausschalten' : 'Animationen einschalten';
  return <Button type="button" variant="ghost" size="icon" className={className} onClick={toggle}
    aria-label={label} title={label} aria-pressed={enabled} disabled={systemReduced}>
    {enabled ? <Sparkles aria-hidden="true" size={18} /> : <Pause aria-hidden="true" size={18} />}
  </Button>;
}
