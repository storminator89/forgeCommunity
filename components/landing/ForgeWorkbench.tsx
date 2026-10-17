'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import { RotateCw } from 'lucide-react';
import styles from '@/app/home.module.css';

const motionQuery = '(prefers-reduced-motion: reduce)';
function subscribeToMotion(onChange: () => void) {
  const query = window.matchMedia(motionQuery);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
function getReducedMotion() {
  return window.matchMedia(motionQuery).matches;
}

/** Original Image Tool artwork, static by default; only its frame can move. */
export function ForgeWorkbench() {
  const [replay, setReplay] = useState(0);
  const subscribe = useCallback((onChange: () => void) => subscribeToMotion(() => {
    // A live preference change cancels a requested animation rather than
    // replaying it when the preference changes back.
    setReplay(0);
    onChange();
  }), []);
  const reducedMotion = useSyncExternalStore(subscribe, getReducedMotion, () => true);

  return (
    <div className={styles.workbench}>
      <div key={replay} data-motion="forge-workbench" className={replay > 0 ? `${styles.artFrame} ${styles.illustrationPlaying}` : styles.artFrame} onAnimationEnd={() => setReplay(0)}>
        {/* Keep React's picture SSR scope; CSS alone sizes the one fixed image. */}
        <picture className={styles.illustration}>
          <img
            className={styles.illustration}
            alt="Illustration: Zwei Erwachsene teilen einen goldenen Ideenfunken über einem offenen Buch, umgeben von farbigen Bausteinen."
            width={1440}
            height={960}
            loading="eager"
            fetchPriority="high"
            decoding="async"
            src="/images/home/forge-workbench-1440.webp"
          />
        </picture>
      </div>
      <button type="button" className={styles.motionButton} disabled={reducedMotion} onClick={() => setReplay(value => value + 1)} aria-label={reducedMotion ? 'Illustration bewegen (reduzierte Bewegung aktiv)' : 'Illustration bewegen'}>
        <RotateCw size={15} aria-hidden="true" />
        <span>{reducedMotion ? 'Bewegung reduziert' : 'Illustration bewegen'}</span>
      </button>
    </div>
  );
}
