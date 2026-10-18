import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import { ContributionMilestonesCard } from '@/components/community/ContributionMilestonesCard'
import { PersonalProgressCard } from '@/components/community/PersonalProgressCard'
import { PostCard } from '@/components/community/PostCard'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import type { CommunityPost } from '@/lib/community-feed'

jest.mock('@/hooks/useSparkVisibility', () => ({ useSparkVisibility: () => ({ visible: false }) }))
jest.mock('framer-motion', () => jest.requireActual('@/lib/motion'))
jest.mock('@/components/community/ReportControl', () => ({ ReportControl: () => null }))

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
const rewardProps = { loading: false, error: false, isSignedIn: true, onRefresh: jest.fn() }

it('distinguishes earned rewards from zero and revoked points on the private progress surface', () => {
  const view = render(<PersonalProgressCard {...rewardProps} summary={{
    points: 50, completedCourses: 1, firstCourseCompleted: true,
    history: [
      { type: 'AWARDED', reason: null, pointsDelta: 50, at: '2026-10-01', courseTitle: 'Erworbener Abschluss' },
      { type: 'REVOKED', reason: 'APPROVAL_WITHDRAWN', pointsDelta: -50, at: '2026-10-02', courseTitle: 'Geänderte Freigabe' },
    ],
  }} />)
  expect(screen.getByText('Aktive Kurspunkte:')).toHaveClass('text-reward-ink')
  expect(screen.getByText('1 Kurs abgeschlossen')).toHaveClass('text-reward-ink')
  expect(screen.getByText('+50 Punkte')).toHaveClass('text-reward-ink')
  expect(screen.getByText('-50 Punkte')).toHaveClass('text-muted-foreground')
  expect(screen.getByRole('progressbar', { name: '1 von 3 Kursen bis zum nächsten Meilenstein' })).toHaveClass('accent-progress')
  view.rerender(<PersonalProgressCard {...rewardProps} summary={{ points: 0, completedCourses: 0, firstCourseCompleted: false }} />)
  expect(screen.getByText('Aktive Kurspunkte:')).not.toHaveClass('text-reward-ink')
  expect(screen.getByText('Noch kein Kurs abgeschlossen')).toHaveClass('text-foreground')
  expect(view.container.querySelector('.text-reward-ink, .bg-reward')).toBeNull()
})

it('keeps private discussion milestones social, labelled and separate from course rewards', () => {
  render(<ContributionMilestonesCard summary={{ eligible: true, selectedByAuthors: 1, saturated: false }} loading={false} error={false} isSignedIn onRefresh={jest.fn()} />)
  const card = screen.getByRole('region', { name: 'Meine Diskussionsmeilensteine' })
  expect(within(card).getByText('Aktuell erreicht')).toHaveClass('text-coral')
  expect(within(card).getAllByText('Noch nicht erreicht')).toHaveLength(2)
  const progress = within(card).getByRole('progressbar', { name: 'Diskussionsmeilenstein: 1 von 3 unterschiedlichen Diskussionsautoren' })
  expect(progress).toHaveClass('accent-progress')
  expect(progress).toHaveAttribute('value', '1')
  expect(progress).toHaveAttribute('max', '3')
  expect(card).toHaveTextContent('Sie vergibt keine Punkte')
  expect(card.querySelector('.text-reward-ink, .bg-reward')).toBeNull()
})

it('keeps social likes distinguishable by their filled icon and native disabled state', () => {
  const post: CommunityPost = {
    id: 'social-color', title: 'Gemeinsam weiterdenken', content: '<p>Ein Gedanke</p>',
    authorId: 'member', author: { id: 'member', name: 'Mitglied', image: null },
    createdAt: '2026-10-01T10:00:00.000Z', votes: 3, isLiked: true, comments: [], commentCount: 0,
    acceptedSolution: null, acceptedSolutionCount: 0, solutionRevision: null,
  }
  const view = render(<PostCard post={post} currentUserId="viewer" onLike={jest.fn()} isLoading />)
  const like = screen.getByRole('button', { name: '3' })
  expect(like).toHaveClass('text-coral', 'bg-coral/10', 'hover:text-coral')
  expect(like).not.toHaveClass('text-destructive')
  expect(like).toBeDisabled()
  expect(like.querySelector('svg')).toHaveClass('fill-current')
  expect(screen.getByText('M', { selector: 'span' })).toHaveClass('bg-coral-highlight', 'text-coral-highlight-foreground')

  view.rerender(<PostCard post={{ ...post, isLiked: false }} currentUserId="viewer" onLike={jest.fn()} />)
  expect(screen.getByRole('button', { name: '3' })).toHaveClass('text-muted-foreground', 'hover:text-coral')
  expect(screen.getByRole('button', { name: '3' }).querySelector('svg')).not.toHaveClass('fill-current')
})

it('names actual progress independently of the social secondary surface', () => {
  const { container } = render(<Progress value={35} aria-label="Bestätigter Kursfortschritt" />)
  expect(screen.getByRole('progressbar', { name: 'Bestätigter Kursfortschritt' })).toHaveClass('bg-progress/15')
  expect(container.querySelector('[style]')).toHaveClass('bg-progress')
  expect(container.querySelector('[style]')).toHaveStyle({ transform: 'translateX(-65%)' })
})

it('uses readable foregrounds for bright social artwork and a bounded real earned badge', () => {
  const missions = source('components/spaces/friendly-missions.module.css')
  expect(missions).toContain('.peopleDots [data-filled=true] { background: hsl(var(--coral-highlight)); color: hsl(var(--coral-highlight-foreground)); }')
  expect(missions).toContain('.contribution[data-kind=BUILD_ON] { border-left: 3px solid hsl(var(--coral)); }')
  const poll = source('components/spaces/SpacePolls.tsx')
  expect(poll).toContain('fill="hsl(var(--coral-highlight))"')
  expect(poll).toContain('stroke="hsl(var(--coral-highlight-foreground))"')
  const pathways = source('app/courses/pathways/PathwaysClient.tsx')
  expect(pathways).toContain('joined && selected.participation?.badgeActive && <div className="mt-5 border-l-2 border-reward-foreground bg-reward px-4 py-3 text-reward-foreground"')
  expect(pathways).toContain('Diese Anerkennung ist nur in deinem Lernpfad sichtbar. Sie ist kein Zertifikat.')
  expect(source('app/profile/[id]/page.tsx')).toContain('<Award aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-reward-ink" />')
})

it('preserves Recharts compatibility selectors and authored or persisted color boundaries', () => {
  const chart = source('components/ui/chart.tsx')
  expect(chart).toContain("[stroke='#ccc']")
  expect(chart).toContain("[stroke='#fff']")
  expect(source('app/resources/page.tsx')).toContain("color: 'bg-blue-500'")
  expect(source('app/api/users/[id]/projects/route.ts')).toContain("data.gradientFrom == null ? '#4F46E5'")
  expect(source('app/h5p/embed/[id]/route.ts')).toContain('color:#18243b')
})

it('keeps destructive text off the generic accent highlight in menus and text actions', () => {
  for (const path of [
    'components/user-nav.tsx',
    'components/admin/UserManagement.tsx',
    'app/resources/page.tsx',
    'app/courses/[courseId]/contents/CourseAuthoringOutline.tsx',
  ]) {
    expect(source(path)).toContain('focus:bg-destructive/10')
    expect(source(path)).toContain('focus:text-destructive')
  }
  expect(source('app/courses/[courseId]/practice/learn/PracticeLearnerView.tsx')).toContain('text-destructive hover:text-destructive hover:bg-destructive/10')
  expect(source('app/courses/[courseId]/qa/CourseQaWorkspace.tsx')).toContain('text-destructive hover:text-destructive hover:bg-destructive/10')
  expect(source('app/notifications/page.tsx')).toContain('text-muted-foreground hover:text-destructive hover:bg-destructive/10')
})

it('pairs primary loading spinners with the button foreground in both themes', () => {
  for (const path of ['components/admin/AddUserDialog.tsx', 'components/admin/EditUserDialog.tsx']) {
    expect(source(path)).toContain('animate-spin -ml-1 mr-3 h-5 w-5 text-primary-foreground')
    expect(source(path)).not.toContain('text-white')
  }
})

it.each(['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'] as const)('keeps %s disabled buttons legible without changing their native state', variant => {
  render(<Button variant={variant} disabled>Aktion nicht verfügbar</Button>)
  const button = screen.getByRole('button', { name: 'Aktion nicht verfügbar' })
  expect(button).toBeDisabled()
  expect(button).toHaveClass('disabled:opacity-100', 'disabled:bg-muted', 'disabled:text-muted-foreground', 'disabled:border-input')
  expect(button).toHaveClass('disabled:pointer-events-none', 'disabled:cursor-not-allowed', 'disabled:active:translate-y-0')
  expect(button).not.toHaveClass('disabled:opacity-50')
})

it('retains a named loading state at the full paired contrast', () => {
  render(<Button data-state="loading" aria-busy="true">Wird gespeichert …</Button>)
  const button = screen.getByRole('button', { name: 'Wird gespeichert …' })
  expect(button).toHaveAttribute('aria-busy', 'true')
  expect(button).toHaveClass('data-[state=loading]:opacity-100', 'data-[state=loading]:cursor-progress')
  expect(button).not.toHaveClass('data-[state=loading]:opacity-75')
})
