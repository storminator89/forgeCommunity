'use client';

import { Flag } from 'lucide-react';
import { SparkCharacter, type SparkReaction } from '@/components/SparkCharacter';
import { useSparkVisibility } from '@/hooks/useSparkVisibility';
import { useSparkMotion } from '@/hooks/useSparkMotion';
import { SPARK_CLIPS, SPARK_REST } from '@/lib/spark-character-clips';

/** Historical reached state is only styling. A reaction needs a fresh event. */
export function ProgressSpark({ state, reaction = null }: {
  state: 'neutral' | 'target' | 'reached'; reaction?: SparkReaction | null;
}) {
  const { visible } = useSparkVisibility();
  const motionEnabled = useSparkMotion();
  if (!visible) return null;
  return <span aria-hidden="true" data-progress-spark={state}
    className={`relative flex size-20 shrink-0 items-center justify-center rounded-full ${state === 'reached' ? 'bg-reward/15 ring-1 ring-inset ring-reward-ink/20' : state === 'target' ? 'bg-accent ring-1 ring-inset ring-primary/20' : 'bg-muted'}`}>
    <SparkCharacter visible={visible} motionEnabled={motionEnabled} clips={SPARK_CLIPS}
      staticSource={SPARK_REST} reaction={reaction} size={80} />
    {state === 'target' && <span className="absolute bottom-0 right-0 flex size-6 items-center justify-center rounded-full border border-border bg-card text-primary"><Flag className="size-3" /></span>}
  </span>;
}
