'use client';

import { SparkCharacter } from '@/components/SparkCharacter';
import { useSparkVisibility } from '@/hooks/useSparkVisibility';
import { useSparkMotion } from '@/hooks/useSparkMotion';
import { SPARK_CLIPS, SPARK_REST } from '@/lib/spark-character-clips';

/** Quiet articulated idle, including genuine eye blinks. */
export function SparkEntryFigure() {
  const { visible } = useSparkVisibility();
  const motionEnabled = useSparkMotion();
  if (!visible) return null;
  return <span aria-hidden="true" className="block size-[64px] shrink-0" data-spark-entry-figure="">
    <SparkCharacter visible={visible} motionEnabled={motionEnabled} clips={SPARK_CLIPS}
      staticSource={SPARK_REST} size="100%" />
  </span>;
}

/** Decorative only. Existing Settings visibility and both motion choices apply. */
export function SparkEntry({ className = '' }: { className?: string }) {
  const { visible } = useSparkVisibility();
  if (!visible) return null;
  return <div className={`flex min-h-[64px] min-w-0 items-center ${className}`} data-spark-entry="">
    <SparkEntryFigure />
  </div>;
}
