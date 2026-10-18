// This component belongs to JourneyClient's existing client boundary.
import Link from 'next/link';
import { BookOpen, Check, ChevronDown, Clock3, Flag, LockKeyhole } from 'lucide-react';
import type { JourneyLeaf } from './journey-progress';
import type { JourneyTrailGroup, JourneyTrailStation } from './journey-trail-data';
import styles from './JourneyTrail.module.css';

type JourneyTrailProps = {
  groups: JourneyTrailGroup[];
  nextId: string | null;
  complete: boolean;
  readerHref: string;
  openChapters: Record<string, boolean>;
  onChapterToggle: (id: string, open: boolean) => void;
};

const contentLabels: Record<JourneyLeaf['type'], string> = {
  TEXT: 'Inhalt',
  VIDEO: 'Video',
  AUDIO: 'Audio',
  H5P: 'Übung',
  QUIZ: 'Quiz',
  ASSIGNMENT: 'Aufgabe',
};

function LockReason({ leaf }: { leaf: JourneyLeaf }) {
  const prerequisites = leaf.missingPrerequisites ?? [];
  return <div className={styles.lockReasons}>
    {leaf.releaseLocked && <p>Noch nicht freigegeben.</p>}
    {prerequisites.length > 0 && <p>Zuerst abschließen: {prerequisites.map(item => item.title).join(', ')}.</p>}
    {!leaf.releaseLocked && prerequisites.length === 0 && <p>Im Kurs derzeit gesperrt. Prüfe dort die Freigabe und Voraussetzungen.</p>}
  </div>;
}

function Station({ station, nextId, readerHref, inChapter = false }: {
  station: JourneyTrailStation;
  nextId: string | null;
  readerHref: string;
  inChapter?: boolean;
}) {
  const { leaf, position } = station;
  const Title = inChapter ? 'h4' : 'h3';
  const recommended = leaf.id === nextId && !leaf.locked && !leaf.completed && !leaf.awaitingGrade;
  const rowClass = [styles.stationRow, recommended ? styles.recommended : '', leaf.completed ? styles.confirmed : ''].filter(Boolean).join(' ');
  const contents = <>
    <span className={styles.stationMarker} aria-hidden="true">
      {leaf.completed ? <Check /> : leaf.locked ? <LockKeyhole /> : leaf.awaitingGrade ? <Clock3 /> : position}
    </span>
    <div className={styles.stationCopy}>
      <p className={styles.stationMeta}><span>Station {position}</span><span>{contentLabels[leaf.type]}</span></p>
      <Title className={styles.stationTitle}>{leaf.title}</Title>
      <div className={styles.stationStatuses}>
        {leaf.completed && <span className={styles.confirmedStatus}><Check aria-hidden="true" />Bestätigt</span>}
        {leaf.awaitingGrade && <span className={styles.waitingStatus}><Clock3 aria-hidden="true" />Bewertung offen</span>}
        {leaf.locked && <span className={styles.lockedStatus}><LockKeyhole aria-hidden="true" />{leaf.completed ? 'Derzeit gesperrt' : 'Gesperrt'}</span>}
        {recommended && <span className={styles.nextStatus}>Als Nächstes möglich</span>}
        {!leaf.locked && !leaf.completed && !leaf.awaitingGrade && !recommended && <span className={styles.availableStatus}>Verfügbar</span>}
      </div>
      {leaf.locked ? <LockReason leaf={leaf} /> : <p className={styles.stationAction}>{leaf.awaitingGrade ? 'Abgabe ansehen' : leaf.completed ? 'Noch einmal ansehen' : 'Lernschritt öffnen'}</p>}
    </div>
  </>;

  return <li className={styles.station}>
    {leaf.locked ? <div className={rowClass}>{contents}</div> : <Link
      className={rowClass}
      href={`${readerHref}?content=${encodeURIComponent(leaf.id)}`}
      aria-current={recommended ? 'step' : undefined}
    >{contents}</Link>}
  </li>;
}

/** Current publication only: stations and checkpoint states come from the parent. */
export function JourneyTrail({ groups, nextId, complete, readerHref, openChapters, onChapterToggle }: JourneyTrailProps) {
  return <section aria-labelledby="journey-trail-title" className={styles.section}>
    <h2 id="journey-trail-title" className={styles.heading}>Deine Stationen</h2>
    <ol className={styles.trail} role="list">
      {groups.map(group => {
        if (!group.isChapter) return group.stations.map(station => <Station key={station.leaf.id} station={station} nextId={nextId} readerHref={readerHref} />);
        const confirmed = group.stations.length > 0 && group.completedCount === group.stations.length;
        return <li key={group.id} className={styles.chapter}>
          <details
            className={styles.chapterDetails}
            open={openChapters[group.id] ?? group.stations.some(station => station.leaf.id === nextId)}
            onToggle={event => onChapterToggle(group.id, event.currentTarget.open)}
          >
            <summary className={styles.chapterSummary}>
              <h3 className={styles.chapterHeading}>
                <span className={`${styles.chapterMarker} ${confirmed ? styles.chapterConfirmed : ''}`} aria-hidden="true">{confirmed ? <Check /> : <BookOpen />}</span>
                <span className={styles.chapterCopy}>
                  <span className={styles.chapterLabel}>Kapitel</span>
                  <span className={styles.chapterTitle}>{group.title}</span>
                  <span className={styles.chapterCount}>{confirmed && <Check aria-hidden="true" />}{group.completedCount}/{group.stations.length} bestätigt</span>
                </span>
                <ChevronDown className={styles.chapterChevron} aria-hidden="true" />
              </h3>
            </summary>
            <ol className={styles.chapterStations} role="list">
              {group.stations.map(station => <Station key={station.leaf.id} station={station} nextId={nextId} readerHref={readerHref} inChapter />)}
            </ol>
          </details>
        </li>;
      })}
      <li className={`${styles.finish} ${complete ? styles.finishConfirmed : ''}`}>
        <span className={styles.finishMarker} aria-hidden="true">{complete ? <Check /> : <Flag />}</span>
        <div className={styles.finishCopy}>
          <h3 className={styles.finishTitle}>Kursabschluss</h3>
          <p>{complete ? 'Aktuell bestätigt' : 'Noch nicht bestätigt'}</p>
        </div>
      </li>
    </ol>
  </section>;
}
