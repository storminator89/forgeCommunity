import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { CourseContentsEditor } from '@/app/courses/[courseId]/contents/CourseContentsEditor'
import type { CourseContent, CourseProgressSnapshot } from '@/app/courses/[courseId]/contents/types'

const mockRouter = { push: jest.fn(), replace: jest.fn() }
let mockViewer = { status: 'authenticated', data: { user: { id: 'learner', role: 'USER' } } }
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }))
jest.mock('next-auth/react', () => ({ useSession: () => mockViewer }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/app/courses/[courseId]/practice/learn/PracticeEntryLink', () => ({ PracticeEntryLink: () => null }))
jest.mock('@/app/courses/[courseId]/contents/CourseContentsSidebar', () => ({ CourseContentsSidebar: ({ contents, onContentSelect }: { contents: CourseContent[]; onContentSelect: (id: string) => void }) => <nav>{contents.map(item => <button key={item.id} onClick={() => onContentSelect(item.id)}>{item.title}</button>)}</nav> }))
jest.mock('@/app/courses/[courseId]/contents/EditContentForm', () => ({ EditContentForm: () => null }))
jest.mock('@/app/courses/[courseId]/contents/ContentRenderer', () => ({ ContentRenderer: () => <p>Lesson content</p> }))
const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response
let contents: CourseContent[]
let progress: CourseProgressSnapshot
let canEdit: boolean
beforeEach(() => {
  history.replaceState({}, '', '/courses/course/contents?content=leaf')
  mockViewer = { status: 'authenticated', data: { user: { id: 'learner', role: 'USER' } } }
  mockRouter.push.mockReset()
  contents = [{ id: 'leaf', courseId: 'course', title: 'Current lesson', order: 1, parentId: null, type: 'TEXT', content: '<p>Actual authored text stays out of question</p>', publicationId: 'publication', contentVersionToken: 'token', locked: false }]
  progress = { publicationId: 'publication', canTrack: true, complete: false, completedContentIds: [], hasCertificate: false, completedAt: null }
  canEdit = false
  global.fetch = jest.fn(async input => response(String(input).endsWith('/contents') ? contents : String(input).endsWith('/progress') ? progress : { id: 'course', name: 'Course', canEdit, activePublicationId: 'publication' }))
})

it.each(['TEXT', 'VIDEO', 'AUDIO', 'H5P', 'QUIZ', 'ASSIGNMENT'] as CourseContent['type'][])('offers the explicit current readable %s leaf entry with only pair and UI hint', async type => {
  contents[0].type = type
  render(<CourseContentsEditor courseId="course" />)
  const action = await screen.findByRole('button', { name: 'Zu dieser Lektion fragen' })
  action.focus(); fireEvent.click(action); fireEvent.click(action)
  expect(mockRouter.push).toHaveBeenCalledTimes(2)
  expect(mockRouter.push).toHaveBeenLastCalledWith('/courses/course/qa?publicationId=publication&contentId=leaf&ask=1')
  fireEvent.click(screen.getByRole('button', { name: /^Fragen/ }))
  expect(mockRouter.push).toHaveBeenLastCalledWith('/courses/course/qa')
  expect((global.fetch as jest.Mock).mock.calls.every(call => !call[1]?.method)).toBe(true)
})

it.each(['locked', 'parent', 'mismatch', 'unknown-lock', 'unenrolled', 'author', 'preview'])("omits the selected entry for %s readers", async state => {
  if (state === 'locked') contents[0].locked = true
  if (state === 'parent') contents[0].subContents = [{ ...contents[0], id: 'child', parentId: 'leaf' }]
  if (state === 'mismatch') progress.publicationId = 'different-publication'
  if (state === 'unknown-lock') delete contents[0].locked
  if (state === 'unenrolled') progress.canTrack = false
  if (state === 'author') canEdit = true
  await act(async () => { render(<CourseContentsEditor courseId="course" forceLearner={state === 'preview'} />) })
  await screen.findByRole('heading', { name: 'Current lesson' })
  expect(screen.queryByRole('button', { name: 'Zu dieser Lektion fragen' })).not.toBeInTheDocument()
})

it.each(['INSTRUCTOR', 'ADMIN'])('uses live learner proof for an enrolled non-owner with session role %s', async role => {
  mockViewer.data.user.role = role
  render(<CourseContentsEditor courseId="course" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Zu dieser Lektion fragen' }))
  expect(mockRouter.push).toHaveBeenCalledWith('/courses/course/qa?publicationId=publication&contentId=leaf&ask=1')
})
