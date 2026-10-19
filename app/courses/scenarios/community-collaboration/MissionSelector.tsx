'use client';

import Link from 'next/link';
import { ArrowLeft, ArrowRight, FileText, Laptop, Unplug } from 'lucide-react';
import { useFriendlyMotion } from '@/components/community/FriendlyMotion';
import { availableMissions } from './mission-catalog';
import styles from './CommunityCollaboration.module.css';

export function MissionSelector() {
  const { enabled: friendlyMotionEnabled } = useFriendlyMotion();
  return <div className={styles.mission} data-friendly-motion={friendlyMotionEnabled}>
    <div className={styles.utilities}><Link href="/courses" prefetch={false}><ArrowLeft aria-hidden="true" />Zu den Kursen</Link></div>
    <section className={styles.selector} aria-labelledby="mission-selector-title">
      <h2 id="mission-selector-title">Fall wählen</h2>
      <p className={styles.selectorLead}>Entscheide. Sieh die Folge.</p>
      <div className={styles.missionChoices}>
        {availableMissions.map(mission => <Link href={mission.href} prefetch={false} key={mission.key} className={styles.missionCard}>
          <div className={styles.missionCardVisual} aria-hidden="true">
            {mission.visual === 'collaboration'
              ? <><FileText /><span className={styles.cardBridge} /><FileText /></>
              : <><Laptop /><span className={styles.cardDisconnected} /><Unplug /></>}
          </div>
          <p className={styles.eyebrow}>{mission.category}</p>
          <h3>{mission.cardTitle}</h3>
          <p className={styles.missionCardSummary}>{mission.summary}</p>
          <span className={styles.missionCardMeta}>4 Etappen</span>
          <span className={styles.missionCardAction}>Starten<ArrowRight aria-hidden="true" /></span>
        </Link>)}
      </div>
      <p className={styles.selectorNote}>Freiwillige Simulationen. Dein Durchlauf wird nicht gespeichert.</p>
    </section>
  </div>;
}
