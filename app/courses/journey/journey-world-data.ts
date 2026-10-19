import type { JourneyTrailGroup, JourneyTrailStation } from './journey-trail-data';

export type JourneyWorldSection = {
  id: string;
  title: string;
  isChapter: boolean;
  label: string;
  rangeLabel: string;
  stations: JourneyTrailStation[];
  confirmedCount: number;
  stationCount: number;
};

const STATIONS_PER_SCENE = 8;

function stationRange(stations: JourneyTrailStation[]) {
  const first = stations[0].position;
  const last = stations[stations.length - 1].position;
  return first === last ? `Station ${first}` : `Stationen ${first}–${last}`;
}

/** Presentation windows only. Keep groupJourneyTrail's exact order and facts;
 * a window is neither a new chapter nor an unlock/completion boundary. */
export function partitionJourneyWorld(groups: JourneyTrailGroup[]): JourneyWorldSection[] {
  const sections: JourneyWorldSection[] = [];
  let rootStations: JourneyTrailStation[] = [];
  const flushRoots = () => {
    for (let start = 0; start < rootStations.length; start += STATIONS_PER_SCENE) {
      const stations = rootStations.slice(start, start + STATIONS_PER_SCENE);
      const title = stationRange(stations);
      sections.push({
        id: JSON.stringify(['stations', stations[0].leaf.id, stations[stations.length - 1].leaf.id]),
        title, isChapter: false, label: title, rangeLabel: title, stations,
        confirmedCount: stations.filter(station => station.leaf.completed).length,
        stationCount: stations.length,
      });
    }
    rootStations = [];
  };

  for (const group of groups) {
    if (!group.isChapter) {
      rootStations.push(...group.stations);
      continue;
    }
    flushRoots();
    const sectionCount = Math.ceil(group.stations.length / STATIONS_PER_SCENE);
    for (let start = 0; start < group.stations.length; start += STATIONS_PER_SCENE) {
      const stations = group.stations.slice(start, start + STATIONS_PER_SCENE);
      const windowLabel = sectionCount > 1 ? `Abschnitt ${Math.floor(start / STATIONS_PER_SCENE) + 1} von ${sectionCount}` : '';
      sections.push({
        id: JSON.stringify(['chapter', group.id, stations[0].leaf.id, stations[stations.length - 1].leaf.id]),
        title: group.title, isChapter: true,
        label: `Kapitel: ${group.title}${windowLabel ? ` · ${windowLabel}` : ''}`,
        rangeLabel: [windowLabel, stationRange(stations)].filter(Boolean).join(' · '),
        stations, confirmedCount: group.completedCount, stationCount: group.stations.length,
      });
    }
  }
  flushRoots();
  return sections;
}

// Presentation offsets only. The route clamps these to the actual available
// half-width, leaving room for the native focus ring at narrow sizes/zoom.
export const journeyWorldOffsets = [0, 2.8125, 4.25, 2.8125, 0, -2.8125, -4.25, -2.8125] as const;
