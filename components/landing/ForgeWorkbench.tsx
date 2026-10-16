'use client';

import { useCallback, useId, useState, useSyncExternalStore } from 'react';
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

/** An original, static-first illustration. Motion happens only on request. */
export function ForgeWorkbench() {
  const titleId = useId();
  const descriptionId = useId();
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
      <svg className={styles.illustration} viewBox="0 0 680 540" width="680" height="540" role="img" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <title id={titleId}>Aus Lernen wird gemeinsames Machen</title>
        <desc id={descriptionId}>Ein offenes Buch verbindet zwei Menschen im Gespräch mit einem Projekt aus Bausteinen. Über den Buchseiten leuchtet ein kleiner Funke.</desc>
        {/* One shared work surface connects the three real activities. */}
        <path className={styles.artSurface} d="M54 309C24 228 82 138 170 119c79-17 115 20 191 0 83-22 201-20 249 66 49 88-1 220-88 260-97 44-157 5-230 13C190 471 91 408 54 309Z" />
        <path className={styles.artFine} d="M84 355c90 93 376 102 512-13M103 342l-23 14 6 25M597 318l5 25-24 8" fill="none" />

        {/* Conversation: faces and an open speech shape, no invented messages. */}
        <g className={styles.artOutline} strokeLinejoin="round" strokeLinecap="round">
          <path className={styles.artCoral} d="M105 239c-7-46 10-78 46-78 38 0 59 31 56 71l-10 40-92-7Z" />
          <path className={styles.artPaper} d="m126 219-9 70 37 24 23-41-5-45Z" />
          <path className={styles.artCoral} d="M113 200c-7-22 2-51 23-60 24-11 46 0 54 20l-22 17-25-13 1 25Z" />
          <path className={styles.artPaper} d="M142 164c-8 14-9 39 3 47 12 8 27-3 31-18l5-19-18-15Z" />
          <path d="m155 180 1 3m13 0 1 3m-18 11c4 3 8 3 11 0" fill="none" />
          <path className={styles.artCoral} d="M130 235c17 2 30 11 48 30l47 20-12 27-59-23-43-29" />
          <path className={styles.artPaper} d="m213 285 18 1c8 1 14 6 12 12-2 8-18 13-30 14" />

          <path className={styles.artPetrol} d="M431 147c5-35 26-48 52-41 27 7 36 29 26 59l-19 21-48-4Z" />
          <path className={styles.artPaper} d="m461 159-10 38 25 17 26-20-13-30Z" />
          <path className={styles.artPaper} d="M451 128c-8 11-10 36 0 47s27 9 34-7l8-21-20-12Z" />
          <path className={styles.artPetrol} d="M445 134c9 4 30-3 32-14 20 3 22 20 24 30l7-3c6-24-9-39-25-42-17-4-33 6-38 29Z" />
          <path d="m456 147-1 3m13-1-1 3m-12 11c4 3 8 3 11 0" fill="none" />
          <path className={styles.artCoral} d="M440 190c14 12 43 16 60 2 29 12 42 38 40 69l-81 19-40-44Z" />
          <path className={styles.artPaper} d="m432 209-28 38-50 13 7 24 68-14 31-36" />
          <path className={styles.artPaper} d="m361 260-16-3c-10-1-20 4-18 11 2 8 18 14 34 16" />

          {/* The project is physical, unfinished and shared, not a fake UI. */}
          <path className={styles.artPetrol} d="m445 356 76-40 85 45-77 42Z" />
          <path className={styles.artPetrol} d="m445 356 84 47v47l-84-49Z" />
          <path className={styles.artAccent} d="m529 403 77-42v45l-77 44Z" />
          <path className={styles.artPaper} d="m462 298 56-30 61 34-56 31Z" />
          <path className={styles.artAccent} d="m462 298 61 35v57l-61-35Z" />
          <path className={styles.artCoral} d="m523 333 56-31v56l-56 32Z" />
          <path className={styles.artPetrol} d="m491 252 26-14 29 16-27 15Z" />
          <path className={styles.artPaper} d="m491 252 28 17v30l-28-16Z" />
          <path className={styles.artAccent} d="m519 269 27-15v29l-27 16Z" />

          {/* The rising split book and diamond echo the custom favicon. */}
          <path className={styles.artPetrol} d="m153 355 123 17 143-34 4 92-139 51-134-33Z" />
          <path className={styles.artPaper} d="M160 317c50-6 86 7 118 36 39-36 84-55 138-52l-5 115c-47 0-91 16-131 51-34-30-77-45-125-44Z" />
          <path className={styles.artCoral} d="M279 353c39-36 83-55 137-52l-5 115c-47 0-91 16-131 51Z" />
          <path d="m279 354 1 113M179 348c27 1 52 10 76 26m-78-2c27 2 52 12 76 27m-77-2c27 3 49 11 68 24m57-46c26-20 53-32 84-37m-83 63c25-19 52-31 81-37m-81 62c22-17 45-28 69-34" fill="none" />
          <path className={styles.artAccent} d="m196 321 1 48 13-5 12 12-1-48Z" />
          <path className={styles.artPaper} d="M232 113h113c12 0 21 9 21 21v52c0 12-9 21-21 21h-51l-33 24 4-24h-33c-12 0-21-9-21-21v-52c0-12 9-21 21-21Z" />
          <path d="M237 144h102m-102 22h65" fill="none" />
        </g>

        <g key={replay} data-motion="forge-spark" className={replay > 0 ? styles.sparkPlaying : undefined} onAnimationEnd={() => setReplay(0)}>
          <path className={styles.artSpark} d="m315 240 15 27-15 27-15-27Z" />
          <path className={styles.artSparkRays} d="m286 248-10-10m68 10 10-10m-39-14v-12" fill="none" strokeLinecap="round" />
        </g>
      </svg>
      <button type="button" className={styles.motionButton} disabled={reducedMotion} onClick={() => setReplay(value => value + 1)} aria-label={reducedMotion ? 'Illustration bewegen (reduzierte Bewegung aktiv)' : 'Illustration bewegen'}>
        <RotateCw size={15} aria-hidden="true" />
        <span>{reducedMotion ? 'Bewegung reduziert' : 'Illustration bewegen'}</span>
      </button>
    </div>
  );
}
