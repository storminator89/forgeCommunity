import { chapterIsReleased, isChapterReleaseDate } from '@/lib/course-release'
import { projectJourney, type JourneyProjection } from '../../journey/journey-progress'
import type { CourseContent, CourseProgressSnapshot } from './types'

type ReaderProjection = JourneyProjection & { state: 'ready' | 'complete' | 'empty' | 'locked' | 'unavailable' }

/** Navigation over the current learner DTO, never a second source of completion. */
export function projectReaderProgress(contents: CourseContent[], progress: CourseProgressSnapshot | null, now = Date.now()): ReaderProjection {
  const unavailable = (): ReaderProjection => ({ ...projectJourney([], []), state: 'unavailable' })
  if (!progress?.canTrack || !progress.publicationId) return unavailable()
  const completed = new Set(progress.completedContentIds)
  const seen = new Set<string>()
  let coherent = true
  const validate = (items: CourseContent[]): CourseContent[] => items.map(item => {
    if (seen.has(item.id)) { coherent = false; return { ...item, subContents: undefined } }
    if (item.publicationId !== progress.publicationId || (item.locked === false && !item.contentVersionToken)) coherent = false
    seen.add(item.id)
    // The server remains authoritative. These checks can only close access if
    // separately read snapshots disagree; they can never unlock a server gate.
    const release = item.releaseOn ?? null
    const closed = (release !== null && (!isChapterReleaseDate(release) || !chapterIsReleased(release, now))) ||
      Boolean(item.prerequisiteIds?.some(id => !completed.has(id)))
    return { ...item, locked: item.locked !== false || closed,
      subContents: item.subContents ? validate(item.subContents) : undefined }
  })
  const tree = validate(contents)
  if (!coherent) return unavailable()
  const projection = projectJourney(tree, progress.completedContentIds)
  const leafIds = new Set(projection.leaves.map(leaf => leaf.id))
  if (progress.completedContentIds.some(id => !leafIds.has(id)) ||
      progress.complete !== (projection.leaves.length > 0 && projection.completedCount === projection.leaves.length)) return unavailable()
  return { ...projection, state: !projection.leaves.length ? 'empty' : projection.next ? 'ready' :
    projection.completedCount === projection.leaves.length ? 'complete' : 'locked' }
}
