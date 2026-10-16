'use client';

import { forwardRef } from 'react';
import styles from './friendly-missions.module.css';

/** A folded paper marker, drawn for missions. The text and pressed state carry meaning. */
export const MissionBookmarkButton = forwardRef<HTMLButtonElement, {
  title: string;
  saved: boolean;
  pending?: boolean;
  disabled?: boolean;
  describedBy?: string;
  onClick: () => void;
}>(function MissionBookmarkButton({ title, saved, pending = false, disabled = false, describedBy, onClick }, ref) {
  return <button ref={ref} type="button" className={styles.bookmarkButton} aria-label={`${saved ? 'Nicht mehr merken' : 'Für später merken'}: ${title}`} aria-pressed={saved} aria-busy={pending} aria-describedby={describedBy} disabled={disabled || pending} onClick={onClick}>
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={styles.bookmarkMark}>
      <path d="M7 3.5h8.5L19 7v13.5l-7-4-7 4v-15a2 2 0 0 1 2-2Z" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M15 3.5V8h4" stroke={saved ? 'hsl(var(--primary-foreground))' : 'currentColor'} strokeWidth="1.4" strokeLinejoin="round" />
      {saved && <path d="m8.5 11 2 2 4-4" stroke="hsl(var(--primary-foreground))" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
    <span>{pending ? 'Wird gespeichert…' : saved ? 'Gemerkt' : 'Merken'}</span>
  </button>;
});
