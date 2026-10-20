'use client';

import { SparkCharacter } from '@/components/SparkCharacter';
import { useSparkVisibility } from '@/hooks/useSparkVisibility';
import { useSparkMotion } from '@/hooks/useSparkMotion';
import { SPARK_CLIPS, SPARK_REST } from '@/lib/spark-character-clips';
import styles from './JourneyMascot.module.css';

/** Only JourneyClient's verified false-to-true completion can request success.
 * Historical completion still idles, never generates or replays a reaction.
 */
export function JourneyMascot({ complete, celebrationId, ambientMotion }: {
  complete: boolean; celebrationId: number | null; ambientMotion: boolean;
}) {
  const { visible } = useSparkVisibility();
  const motionEnabled = useSparkMotion();
  return <span className={styles.mascot} aria-hidden="true" data-journey-mascot="">
    <SparkCharacter visible={visible} motionEnabled={ambientMotion && motionEnabled}
      clips={SPARK_CLIPS} staticSource={SPARK_REST} size="100%"
      reaction={complete && celebrationId !== null ? { id: `journey:${celebrationId}`, kind: 'positive' } : null} />
  </span>;
}
