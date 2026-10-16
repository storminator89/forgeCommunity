import { BookOpen, Check, Lightbulb, MessageCircle, Users } from 'lucide-react';
import type { SpaceMission } from './mission-api';
import styles from './friendly-missions.module.css';

/** Original, lightweight paper-conversation illustration. Decorative, never a progress claim. */
export function MissionIllustration({ compact = false }: { compact?: boolean }) {
  return <svg viewBox="0 0 180 132" fill="none" aria-hidden="true" className={compact ? styles.illustrationCompact : styles.illustration}>
    <ellipse cx="91" cy="114" rx="63" ry="8" fill="currentColor" opacity=".06" />
    <path d="M30 36a13 13 0 0 1 13-13h60a13 13 0 0 1 13 13v38a13 13 0 0 1-13 13H65L45 99V87h-2a13 13 0 0 1-13-13Z" className={styles.paperBack} stroke="currentColor" strokeWidth="2" />
    <path d="M78 52a12 12 0 0 1 12-12h48a12 12 0 0 1 12 12v32a12 12 0 0 1-12 12h-2v13l-19-13H90a12 12 0 0 1-12-12Z" className={styles.paperFront} stroke="currentColor" strokeWidth="2" />
    <path d="M47 44h32M47 55h22" stroke="hsl(var(--coral-highlight-foreground))" strokeWidth="3" strokeLinecap="round" opacity=".5" />
    <path d="M96 60h34M96 71h24" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".5" />
    <path d="m124 21 4-8 4 8 8 4-8 4-4 8-4-8-8-4Z" className={styles.spark} />
    <path d="m31 103-4 5m131-76 5-2M71 12l-1-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".45" />
    <circle cx="61" cy="75" r="3" fill="hsl(var(--coral-highlight-foreground))" opacity=".4" />
    <circle cx="72" cy="75" r="3" fill="hsl(var(--coral-highlight-foreground))" opacity=".4" />
  </svg>;
}

export function MissionPeople({ count, limit }: { count: number; limit: number }) {
  return <span className={styles.people} aria-label={`${count} von ${limit} Personen dabei`}>
    <span className={styles.peopleDots} aria-hidden="true">{Array.from({ length: limit }, (_, i) => <span key={i} data-filled={i < count}><Users size={12} /></span>)}</span>
    <span>{count}/{limit} dabei</span>
  </span>;
}

export function MissionGoalTrail({ progress }: { progress: SpaceMission['progress'] }) {
  return <ol className={styles.goalTrail}>
    <li data-done={progress.insightAuthors >= 2}>
      <span className={styles.goalIcon} aria-hidden="true">{progress.insightAuthors >= 2 ? <Check size={22} /> : <Lightbulb size={22} />}</span>
      <h3 aria-label="1. In eigenen Worten erklären">Erklären</h3>
      <span className={styles.goalCount}>{Math.min(progress.insightAuthors, 2)}/2</span>
    </li>
    <li>
      <span className={styles.goalIcon} aria-hidden="true"><BookOpen size={22} /></span>
      <h3 aria-label="2. Eine andere Erklärung lesen">Lesen</h3>
      <span className={styles.untracked}>Wird nicht erfasst</span>
    </li>
    <li data-done={progress.hasCrossPersonBuildOn}>
      <span className={styles.goalIcon} aria-hidden="true">{progress.hasCrossPersonBuildOn ? <Check size={22} /> : <MessageCircle size={22} />}</span>
      <h3 aria-label="3. Darauf aufbauen">Weiterdenken</h3>
      <span className={styles.goalCount}>{progress.hasCrossPersonBuildOn ? '1/1' : '0/1'}</span>
    </li>
  </ol>;
}
