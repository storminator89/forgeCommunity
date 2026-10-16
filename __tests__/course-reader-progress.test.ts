import { projectReaderProgress } from '@/app/courses/[courseId]/contents/reader-progress'
import type { CourseContent, CourseProgressSnapshot } from '@/app/courses/[courseId]/contents/types'

const leaf = (id: string, order = 1, extra: Partial<CourseContent> = {}): CourseContent => ({
  id, courseId: 'course', title: id, order, parentId: null, type: 'TEXT', content: '<p>Lesson</p>',
  publicationId: 'pub', contentVersionToken: `token-${id}`, locked: false, ...extra,
})
const progress = (ids: string[] = [], extra: Partial<CourseProgressSnapshot> = {}): CourseProgressSnapshot => ({
  publicationId: 'pub', completedContentIds: ids, complete: false, canTrack: true, hasCertificate: false, completedAt: null, ...extra,
})

describe('current reader navigation projection', () => {
  it('uses the Journey nested sibling order and first current incomplete leaf', () => {
    const tree = [leaf('later chapter', 2, { subContents: [leaf('third', 2), leaf('second', 1)] }),
      leaf('first chapter', 1, { subContents: [leaf('first')] })]
    const view = projectReaderProgress(tree, progress(['first']))
    expect(view.leaves.map(row => row.id)).toEqual(['first', 'second', 'third'])
    expect(view.completedCount).toBe(1)
    expect(view.next?.id).toBe('second')
    expect(view.state).toBe('ready')
  })

  it('preserves completed revisits without turning them into the next incomplete lesson', () => {
    const view = projectReaderProgress([leaf('done'), leaf('next', 2)], progress(['done']))
    expect(view.leaves[0]).toMatchObject({ id: 'done', completed: true })
    expect(view.next?.id).toBe('next')
  })

  it.each([
    { locked: undefined }, { locked: true }, { releaseLocked: true },
    { missingPrerequisites: [{ id: 'prerequisite', title: 'Prerequisite' }] },
    { prerequisiteIds: ['prerequisite'] },
  ])('never opens unknown, server or contradictory gates: %j', extra => {
    const view = projectReaderProgress([leaf('closed', 1, extra), leaf('open', 2)], progress())
    expect(view.next?.id).toBe('open')
    expect(view.firstLocked?.id).toBe('closed')
  })

  it('inherits chapter locks and requires prerequisite completion from the same progress read', () => {
    const nested = leaf('chapter', 1, { locked: true, subContents: [leaf('nested')] })
    expect(projectReaderProgress([nested], progress()).state).toBe('locked')
    const tree = [leaf('first'), leaf('next', 2, { prerequisiteIds: ['first'] })]
    expect(projectReaderProgress(tree, progress(['first'])).next?.id).toBe('next')
    expect(projectReaderProgress(tree, progress()).leaves[1].locked).toBe(true)
  })

  it('honors UTC midnight and never reopens a server release lock on the client', () => {
    const tree = [leaf('release', 1, { releaseOn: '2026-10-17' })]
    expect(projectReaderProgress(tree, progress(), Date.parse('2026-10-16T23:59:59.999Z')).state).toBe('locked')
    expect(projectReaderProgress(tree, progress(), Date.parse('2026-10-17T00:00:00.000Z')).next?.id).toBe('release')
    expect(projectReaderProgress([leaf('release', 1, { releaseOn: '2026-10-17', releaseLocked: true })], progress(), Date.parse('2026-10-18T00:00:00Z')).state).toBe('locked')
    expect(projectReaderProgress([leaf('invalid', 1, { releaseOn: '2026-02-30' })], progress()).state).toBe('locked')
  })

  it.each([
    { publicationId: 'old' }, { publicationId: undefined }, { contentVersionToken: null },
  ])('fails closed for unavailable or mismatched publication/version fields: %j', extra => {
    expect(projectReaderProgress([leaf('first', 1, extra)], progress()).state).toBe('unavailable')
  })

  it('checks container publication metadata without demanding an invented revision field', () => {
    expect(projectReaderProgress([leaf('chapter', 1, { publicationId: 'old', subContents: [leaf('child')] })], progress()).state).toBe('unavailable')
    expect(projectReaderProgress([leaf('chapter', 1, { subContents: [leaf('child')] })], progress()).state).toBe('ready')
  })

  it('does not carry completion into a republished changed revision', () => {
    const changed = leaf('same', 1, { publicationId: 'new', contentVersionToken: 'new-version' })
    expect(projectReaderProgress([changed], progress(['same'], { complete: true })).state).toBe('unavailable')
    expect(projectReaderProgress([changed], progress([], { publicationId: 'new' })).next?.id).toBe('same')
  })

  it('requires real current quiz or assignment completion and responds to its removal', () => {
    const tree = [leaf('quiz', 1, { type: 'QUIZ' }), leaf('assignment', 2, { type: 'ASSIGNMENT', prerequisiteIds: ['quiz'] }), leaf('after', 3, { prerequisiteIds: ['assignment'] })]
    expect(projectReaderProgress(tree, progress()).next?.id).toBe('quiz')
    expect(projectReaderProgress(tree, progress(['quiz'])).next?.id).toBe('assignment')
    expect(projectReaderProgress(tree, progress(['quiz', 'assignment'])).next?.id).toBe('after')
    expect(projectReaderProgress(tree, progress(['quiz'])).leaves[2].locked).toBe(true)
  })

  it('distinguishes empty, complete and all remaining locked without treating a historical certificate as completion', () => {
    expect(projectReaderProgress([], progress()).state).toBe('empty')
    expect(projectReaderProgress([leaf('done')], progress(['done'], { complete: true })).state).toBe('complete')
    expect(projectReaderProgress([leaf('locked', 1, { locked: true })], progress([], { hasCertificate: true })).state).toBe('locked')
    expect(projectReaderProgress([leaf('done', 1, { locked: true, releaseLocked: true })], progress(['done'], { complete: true, canIssueCertificate: false, hasCertificate: true })).state).toBe('complete')
  })

  it('rejects unknown completed IDs, contradictory completion totals and nontracking snapshots', () => {
    expect(projectReaderProgress([leaf('first')], progress(['old'])).state).toBe('unavailable')
    expect(projectReaderProgress([leaf('first')], progress(['first'])).state).toBe('unavailable')
    expect(projectReaderProgress([leaf('first')], progress([], { canTrack: false })).state).toBe('unavailable')
  })

  it('fails closed for repeated IDs and malformed cycles', () => {
    const repeated = leaf('same')
    repeated.subContents = [repeated]
    expect(projectReaderProgress([repeated], progress()).state).toBe('unavailable')
    expect(projectReaderProgress([leaf('same'), leaf('same')], progress()).state).toBe('unavailable')
  })
})
