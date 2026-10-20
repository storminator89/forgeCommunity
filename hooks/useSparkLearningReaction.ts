'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SparkReaction } from '@/components/SparkCharacter';
import { sparkMotionSnapshot } from '@/hooks/useSparkMotion';
import { sparkVisibilitySnapshot } from '@/hooks/useSparkVisibility';

// Unique only within this document. No learner, answer, course, or grade data
// belongs in these tokens; they never enter storage, requests, or analytics.
let nextLearningSession = 0;
export type SparkLearningEvent = Readonly<{
  id: string; sessionId: string; preferenceEpoch: number;
}>;

/** Presentation-only fresh-event bridge. Call createEvent at the actual user
 * action, not when historical result data is rendered. Keep the same event
 * across a pending request, so preference changes cancel its later verdict.
 */
export function useSparkLearningReaction() {
  const session = useRef<string | null>(null);
  if (session.current === null) session.current = `spark-learning-${++nextLearningSession}`;
  const sequence = useRef(0);
  const preferenceEpoch = useRef(0);
  const mounted = useRef(false);
  const consumed = useRef(new Set<string>());
  const [current, setCurrent] = useState<{ reaction: SparkReaction; epoch: number } | null>(null);

  const clearReaction = useCallback(() => { setCurrent(null); }, []);
  useEffect(() => {
    mounted.current = true;
    // Consume at the event itself, including rapid off/on pairs React may
    // batch into one render. Returning to a tab never revives an old verdict.
    const consume = () => { preferenceEpoch.current += 1; clearReaction(); };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === null || event.key === 'forge-community-motion-off' ||
        event.key === 'forge-journey-motion-off' || event.key === 'forge-journey-mascot-hidden') consume();
    };
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    window.addEventListener('forge-community-motion-change', consume);
    window.addEventListener('forge-journey-motion-change', consume);
    window.addEventListener('forge-journey-mascot-visibility-change', consume);
    window.addEventListener('storage', storageChanged);
    window.addEventListener('pagehide', consume);
    window.addEventListener('popstate', consume);
    document.addEventListener('visibilitychange', consume);
    media?.addEventListener('change', consume);
    return () => {
      mounted.current = false;
      preferenceEpoch.current += 1;
      window.removeEventListener('forge-community-motion-change', consume);
      window.removeEventListener('forge-journey-motion-change', consume);
      window.removeEventListener('forge-journey-mascot-visibility-change', consume);
      window.removeEventListener('storage', storageChanged);
      window.removeEventListener('pagehide', consume);
      window.removeEventListener('popstate', consume);
      document.removeEventListener('visibilitychange', consume);
      media?.removeEventListener('change', consume);
    };
  }, [clearReaction]);

  const createEvent = useCallback((): SparkLearningEvent => ({
    id: `${session.current}:${++sequence.current}`,
    sessionId: session.current!, preferenceEpoch: preferenceEpoch.current,
  }), []);
  const showReaction = useCallback((kind: SparkReaction['kind'], event: SparkLearningEvent) => {
    const id = `${event.id}:${kind}`;
    if (event.sessionId !== session.current || consumed.current.has(id)) return;
    // Suppressed and interrupted events are consumed as well, never queued.
    consumed.current.add(id);
    if (!mounted.current || event.preferenceEpoch !== preferenceEpoch.current ||
      !sparkVisibilitySnapshot() || !sparkMotionSnapshot() || document.visibilityState !== 'visible' ||
      (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true)) return;
    setCurrent({ reaction: { id, kind }, epoch: event.preferenceEpoch });
  }, []);

  return { reaction: current?.epoch === preferenceEpoch.current ? current.reaction : null,
    createEvent, showReaction, clearReaction };
}
