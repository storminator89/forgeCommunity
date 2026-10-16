import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import styles from './JourneyMascot.module.css';

const celebrationDuration = 2000;
const celebrationLoadTimeout = 8000;

/** A one-shot Blender render, mounted only for an eligible new completion.
 * The static pose stays underneath while loading or if the request fails.
 */
function CelebrationClip() {
  const [phase, setPhase] = useState<'loading' | 'playing' | 'finished'>('loading');
  const active = useRef(true);
  const finished = useRef(false);
  const startedAt = useRef<number | null>(null);
  const loadDeadline = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = useCallback(() => {
    if (!active.current) return;
    finished.current = true;
    if (timer.current) clearTimeout(timer.current);
    setPhase('finished');
  }, []);

  const schedule = useCallback((deadline: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(finish, Math.max(0, deadline - performance.now()));
  }, [finish]);

  useEffect(() => {
    active.current = true;
    // A lost/late response must not leave a dormant animation waiting to start
    // long after the completion. Its callbacks cannot revive a finished clip.
    // A cached Next image can load before this effect. Keep absolute deadlines
    // so StrictMode cleanup/setup resumes the remaining window, not a new one.
    if (!finished.current) {
      loadDeadline.current ??= performance.now() + celebrationLoadTimeout;
      schedule(startedAt.current === null ? loadDeadline.current : startedAt.current + celebrationDuration);
    }
    return () => {
      active.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [schedule]);

  const start = () => {
    if (!active.current || finished.current || startedAt.current !== null) return;
    startedAt.current = performance.now();
    setPhase('playing');
    // Count from the image's load event, so a slow connection cannot consume
    // the two-second playback window before the clip is available.
    schedule(startedAt.current + celebrationDuration);
  };

  return <>
    <span className={phase === 'playing' ? 'invisible' : ''} data-spark-static=""><MascotPose complete /></span>
    {phase !== 'finished' && <Image
      src="/images/forge-spark-celebrate-once.webp" width={112} height={112} alt=""
      unoptimized loading="eager" onLoad={start} onError={finish}
      data-spark-celebration={phase}
      className={`absolute inset-0 size-28 object-contain ${phase === 'loading' ? 'invisible' : ''}`}
    />}
  </>;
}

function MascotPose({ complete }: { complete: boolean }) {
  return <Image
    src={complete ? '/images/forge-spark-celebrate-final.webp' : '/images/forge-spark-preview.webp'}
    width={112} height={112} alt="" className="size-28 object-contain"
  />;
}

/** Decorative, replaceable slot; provenance lives with the Blender source. */
export function JourneyMascot({ complete, celebrationId, ambientMotion }: { complete: boolean; celebrationId: number | null; ambientMotion: boolean }) {
  return <span className="relative block size-28 shrink-0" aria-hidden="true" data-journey-mascot="">
    {complete && ambientMotion && celebrationId !== null
      ? <CelebrationClip key={celebrationId} />
      : <MascotPose complete={complete} />}
    {!complete && ambientMotion && <Image
      src="/images/forge-spark-blink.webp" width={112} height={112} alt=""
      className={`absolute inset-0 size-28 object-contain ${styles.blink}`}
    />}
  </span>;
}
