// This component belongs to JourneyClient's existing client boundary.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, Check, CircleHelp, ClipboardPen, Clock3, FileText, Flag, Headphones, List, LockKeyhole, Map, Navigation, Play, Puzzle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { JourneyLeaf, JourneyProjection } from './journey-progress';
import { JourneyTrail } from './JourneyTrail';
import type { JourneyTrailGroup } from './journey-trail-data';
import { journeyWorldOffsets, partitionJourneyWorld } from './journey-world-data';
import styles from './JourneyWorld.module.css';

type JourneyWorldProps = {
  courseTitle: string;
  projection: JourneyProjection;
  groups: JourneyTrailGroup[];
  complete: boolean;
  readerHref: string;
  mascot: ReactNode;
  motionEnabled: boolean;
  openChapters: Record<string, boolean>;
  onChapterToggle: (id: string, open: boolean) => void;
};

type SparkPosition = { layoutKey: string; nextId: string; left: number; top: number; size: number };

const contentLabels: Record<JourneyLeaf['type'], string> = {
  TEXT: 'Inhalt', VIDEO: 'Video', AUDIO: 'Audio', H5P: 'Übung', QUIZ: 'Quiz', ASSIGNMENT: 'Aufgabe',
};
const contentIcons = { TEXT: FileText, VIDEO: Play, AUDIO: Headphones, H5P: Puzzle, QUIZ: CircleHelp, ASSIGNMENT: ClipboardPen };

function statusLabels(leaf: JourneyLeaf, nextId: string | null) {
  return [
    leaf.completed ? 'Bestätigt' : '',
    leaf.awaitingGrade ? 'Bewertung offen' : '',
    leaf.locked ? (leaf.completed ? 'Derzeit gesperrt' : 'Gesperrt') : '',
    leaf.id === nextId ? 'Als Nächstes möglich' : '',
    !leaf.locked && !leaf.completed && !leaf.awaitingGrade && leaf.id !== nextId ? 'Verfügbar' : '',
  ].filter(Boolean).join(', ');
}

function StationStatuses({ leaf, nextId }: { leaf: JourneyLeaf; nextId: string | null }) {
  return <div className={styles.statuses}>
    {leaf.completed && <span><Check aria-hidden="true" />Bestätigt</span>}
    {leaf.awaitingGrade && <span><Clock3 aria-hidden="true" />Bewertung offen</span>}
    {leaf.locked && <span><LockKeyhole aria-hidden="true" />{leaf.completed ? 'Derzeit gesperrt' : 'Gesperrt'}</span>}
    {leaf.id === nextId && <span><ArrowRight aria-hidden="true" />Als Nächstes möglich</span>}
    {!leaf.locked && !leaf.completed && !leaf.awaitingGrade && leaf.id !== nextId && <span>Verfügbar</span>}
  </div>;
}

/** Keyed by the existing actor/course/publication boundary. View choices stay
 * local; the one mascot owner stays outside every keyed station and view. */
export function JourneyWorld({ courseTitle, projection, groups, complete, readerHref, mascot, motionEnabled, openChapters, onChapterToggle }: JourneyWorldProps) {
  const [view, setView] = useState<'world' | 'list'>('world');
  const [choice, setChoice] = useState<{ sectionId: string; nodeId: string } | null>(null);
  const [sparkPosition, setSparkPosition] = useState<SparkPosition | null>(null);
  const routeRef = useRef<HTMLDivElement>(null);
  const nextNodeRef = useRef<HTMLDivElement>(null);
  const sections = partitionJourneyWorld(groups);
  const nextId = projection.next?.id ?? null;
  const nextSection = sections.find(section => section.stations.some(station => station.leaf.id === nextId));
  const initialLeaf = projection.next ?? projection.leaves.find(leaf => leaf.awaitingGrade) ?? projection.firstLocked ?? projection.leaves[0];
  const initialSection = sections.find(item => item.stations.some(station => station.leaf.id === initialLeaf?.id));
  const section = sections.find(item => item.id === choice?.sectionId) ?? initialSection ?? sections[0];
  const selected = section?.stations.find(station => station.leaf.id === choice?.nodeId) ??
    section?.stations.find(station => station.leaf.id === initialLeaf?.id) ?? section?.stations[0];
  const nextInSection = Boolean(nextId && section?.stations.some(station => station.leaf.id === nextId));
  const layoutKey = JSON.stringify([section?.id ?? '', selected?.leaf.id ?? '']);

  useEffect(() => {
    const route = routeRef.current;
    const node = nextNodeRef.current;
    if (view !== 'world' || !route || !node || !nextId || !nextInSection) return;
    let frame: number | null = null;
    let active = true;
    const measure = () => {
      frame = null;
      if (!active) return;
      const routeBox = route.getBoundingClientRect();
      const nodeBox = node.getBoundingClientRect();
      if (routeBox.width <= 0 || nodeBox.width <= 0) return;
      const leftSpace = Math.max(0, nodeBox.left - routeBox.left);
      const rightSpace = Math.max(0, routeBox.right - nodeBox.right);
      const onRight = rightSpace >= leftSpace;
      const size = Math.max(0, Math.min(80, (onRight ? rightSpace : leftSpace) - 12));
      const left = onRight ? nodeBox.right - routeBox.left + 12 : nodeBox.left - routeBox.left - 12 - size;
      const top = nodeBox.top - routeBox.top + (nodeBox.height - size) / 2;
      const position = { layoutKey, nextId, left, top, size };
      setSparkPosition(current => current?.layoutKey === layoutKey && current.nextId === nextId &&
        current.left === left && current.top === top && current.size === size ? current : position);
    };
    const schedule = () => { if (frame === null) frame = window.requestAnimationFrame(measure); };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(route);
    observer?.observe(node);
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [view, nextId, nextInSection, layoutKey, choice]);

  const anchoredSpark = nextInSection && sparkPosition?.layoutKey === layoutKey && sparkPosition.nextId === nextId ? sparkPosition : null;
  const mascotStyle: CSSProperties | undefined = anchoredSpark ? {
    left: anchoredSpark.left, top: anchoredSpark.top, width: anchoredSpark.size, height: anchoredSpark.size,
  } : undefined;
  const selectNext = () => {
    if (nextSection && nextId) {
      setSparkPosition(null);
      setChoice({ sectionId: nextSection.id, nodeId: nextId });
      setView('world');
    }
  };

  return <section className={styles.world} aria-labelledby="journey-progress-title" data-motion={motionEnabled}>
    <div className={styles.toolbar}>
      <div className={styles.viewChoices} role="group" aria-label="Lernwegansicht">
        <button type="button" aria-pressed={view === 'world'} onClick={() => setView('world')}><Map aria-hidden="true" />Welt</button>
        <button type="button" aria-pressed={view === 'list'} onClick={() => { setView('list'); setSparkPosition(null); }}><List aria-hidden="true" />Liste</button>
      </div>
      {nextId && <Button type="button" variant="outline" className={styles.nextButton} onClick={selectNext}><Navigation aria-hidden="true" />Zu meinem Schritt</Button>}
    </div>
    <header className={styles.courseHeader}>
      <div className={styles.courseHud}>
        <h2 id="journey-progress-title">{courseTitle}</h2>
        <p className={styles.courseCount}><strong>{projection.completedCount}/{projection.leaves.length}</strong> bestätigt</p>
      </div>
      {projection.leaves.length > 0 && <progress className={styles.progress} value={projection.completedCount} max={projection.leaves.length} aria-label={`${projection.completedCount} von ${projection.leaves.length} Stationen bestätigt`}>{projection.completedCount} von {projection.leaves.length}</progress>}
      {(!projection.next || complete) && <p className={styles.nextSummary}>{complete ? <><Check aria-hidden="true" /><span>Kursabschluss aktuell bestätigt.</span></>
        : projection.leaves.some(leaf => leaf.awaitingGrade) ? <><Clock3 aria-hidden="true" /><span>Bewertung offen. Gerade ist kein weiterer Lernschritt verfügbar.</span></>
          : projection.firstLocked ? <><LockKeyhole aria-hidden="true" /><span>Gerade ist kein weiterer Lernschritt freigegeben.</span></>
            : <><BookOpen aria-hidden="true" /><span>Im Kurs findest du den aktuellen Stand.</span></>}</p>}
    </header>

    <div className={styles.worldPane} hidden={view !== 'world'}>
      {section && <>
        <header className={styles.unitBar}>
          <p>{section.isChapter ? 'Kapitel' : 'Stationen'} <span aria-hidden="true">·</span> {section.confirmedCount}/{section.stationCount} bestätigt</p>
          <h3>{section.title}</h3>
        </header>
        {sections.length > 1 && <div className={styles.sectionSelect}>
          <label htmlFor="journey-world-section">Abschnitt</label>
          <select id="journey-world-section" value={section.id} onChange={event => {
            const target = sections.find(item => item.id === event.target.value);
            const station = target?.stations.find(item => item.leaf.id === nextId) ?? target?.stations[0];
            if (target && station) {
              setSparkPosition(null);
              setChoice({ sectionId: target.id, nodeId: station.leaf.id });
            }
          }}>{sections.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </div>}
      </>}
      <p className={styles.visuallyHidden}>Der Pfad zeigt die Reihenfolge. Wähle eine Station, um ihre Details und die bewusste Öffnen-Aktion direkt darunter zu sehen. Freigegebene Stationen kannst du auch direkt wählen.</p>
      <p className={styles.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">{selected ? `Ausgewählt: Station ${selected.position}, ${selected.leaf.title}. ${statusLabels(selected.leaf, nextId)}.` : ''}</p>
      <div className={styles.routeStage} ref={routeRef}>
        {section && <ol className={styles.stations} role="list" aria-label={`${section.title}: ${section.rangeLabel}`}>
          {section.stations.map((station, index) => {
            const { leaf, position } = station;
            const isNext = leaf.id === nextId;
            const isSelected = selected?.leaf.id === leaf.id;
            const ContentIcon = contentIcons[leaf.type];
            return <li key={leaf.id} style={{ '--node-offset': `${journeyWorldOffsets[index]}rem` } as CSSProperties}>
              <div className={styles.nodeRow}>
                <div className={styles.nodeSeat} ref={isNext ? nextNodeRef : undefined}>
                  <button type="button" className={styles.stationButton}
                    data-confirmed={leaf.completed} data-locked={leaf.locked} data-next={isNext}
                    aria-pressed={isSelected} aria-current={isNext ? 'step' : undefined}
                    aria-label={`Station ${position}: ${leaf.title}. ${contentLabels[leaf.type]}. ${statusLabels(leaf, nextId)}`}
                    aria-controls="journey-world-detail"
                    onClick={() => { setSparkPosition(null); setChoice({ sectionId: section.id, nodeId: leaf.id }); }}>
                    <ContentIcon className={styles.contentIcon} aria-hidden="true" />
                    <span className={styles.stationBadges} aria-hidden="true">
                      {leaf.completed && <Check />}{leaf.awaitingGrade && <Clock3 />}{leaf.locked && <LockKeyhole />}{isNext && <ArrowRight />}
                    </span>
                  </button>
                  {isNext && !isSelected && <span className={styles.nextTag} aria-hidden="true">Dein Schritt</span>}
                </div>
              </div>
              {isSelected && <div id="journey-world-detail" className={styles.bubble}>
                <p className={styles.detailMeta}>Station {position} <span aria-hidden="true">·</span> {contentLabels[leaf.type]}</p>
                <h4>{leaf.title}</h4>
                <StationStatuses leaf={leaf} nextId={nextId} />
                {leaf.locked && <div className={styles.lockReasons}>
                  {leaf.releaseLocked && <p>Noch nicht freigegeben.</p>}
                  {Boolean(leaf.missingPrerequisites?.length) && <p>Zuerst abschließen: {leaf.missingPrerequisites!.map(item => item.title).join(', ')}.</p>}
                  {!leaf.releaseLocked && !leaf.missingPrerequisites?.length && <p>Im Kurs derzeit gesperrt. Prüfe dort die Freigabe und Voraussetzungen.</p>}
                </div>}
                <Button asChild className={styles.openButton}><Link prefetch={false} href={leaf.locked ? readerHref : `${readerHref}?content=${encodeURIComponent(leaf.id)}`}>
                  {leaf.locked ? 'Kurs ansehen' : leaf.awaitingGrade ? 'Abgabe ansehen' : leaf.completed ? 'Noch einmal ansehen' : 'Lernschritt öffnen'}<ArrowRight aria-hidden="true" />
                </Link></Button>
              </div>}
            </li>;
          })}
        </ol>}
        {/* One stable owner, never inside a station or a conditional view.
            Only its decorative coordinates/size change after real DOM layout. */}
        <div className={styles.mascotSlot} data-anchored={Boolean(anchoredSpark)} data-pending={nextInSection && !anchoredSpark} style={mascotStyle}>{mascot}</div>
      </div>
      {projection.leaves.length > 0 && <p className={styles.finish}><Flag aria-hidden="true" /><span>Kursabschluss: {complete ? 'aktuell bestätigt' : 'noch nicht bestätigt'}</span></p>}
    </div>
    {projection.leaves.length === 0 && <p className={styles.empty}>Noch keine Stationen verfügbar. <Link prefetch={false} href={readerHref}>Kurs ansehen</Link></p>}
    {view === 'list' && projection.leaves.length > 0 && <JourneyTrail groups={groups} nextId={nextId} complete={complete} readerHref={readerHref} openChapters={openChapters} onChapterToggle={onChapterToggle} />}
  </section>;
}
