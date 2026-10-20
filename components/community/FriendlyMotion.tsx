'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { communityMotionSnapshot, setCommunityMotionEnabled, useCommunityMotion } from '@/hooks/useSparkMotion';
import { Pause, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

function subscribeReducedMotion(callback: () => void) {
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  media?.addEventListener('change', callback);
  return () => media?.removeEventListener('change', callback);
}

function reducedMotionSnapshot() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
}

/** Keep the original browser preference shared with every Spark placement. */
export function useFriendlyMotion(): { enabled: boolean; toggle: () => void; systemReduced: boolean } {
  const enabled = useCommunityMotion();
  const systemReduced = useSyncExternalStore(subscribeReducedMotion, reducedMotionSnapshot, () => true);
  const toggle = useCallback(() => {
    if (!systemReduced) setCommunityMotionEnabled(!communityMotionSnapshot());
  }, [systemReduced]);
  return { enabled: enabled && !systemReduced, toggle, systemReduced };
}

export function FriendlyMotionToggle({ className }: { className?: string }) {
  const { enabled, toggle, systemReduced } = useFriendlyMotion();
  const label = systemReduced ? 'Animationen durch Systemeinstellung ausgeschaltet' : enabled ? 'Animationen ausschalten' : 'Animationen einschalten';
  return <Button type="button" variant="ghost" size="icon" className={className} onClick={toggle}
    aria-label={label} title={label} aria-pressed={enabled} disabled={systemReduced}>
    {enabled ? <Sparkles aria-hidden="true" size={18} /> : <Pause aria-hidden="true" size={18} />}
  </Button>;
}
