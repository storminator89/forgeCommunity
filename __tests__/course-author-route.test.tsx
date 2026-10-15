import { render, screen } from '@testing-library/react'
import { CourseWorkspaceRoute } from '@/app/courses/[courseId]/contents/CourseWorkspaceRoute'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/app/courses/[courseId]/contents/CourseDraftWorkspace', () => ({ CourseDraftWorkspace: () => <p>Privater Autorenarbeitsplatz</p> }))
jest.mock('@/app/courses/[courseId]/contents/CourseContentsEditor', () => ({ CourseContentsEditor: ({ forceLearner }: { forceLearner?: boolean }) => <p>{forceLearner ? 'Veröffentlichte Lernansicht' : 'Unsichere Bearbeitung'}</p> }))

const state = { draft: { revision: 1, digest: 'draft', payload: { schemaVersion: 1, title: 'Kurs', description: '', startDate: null, endDate: null, imageUrl: null, contents: [] } }, activePublication: null }
const response = (body: unknown, status: number) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response

test('an authorized author enters only the private draft workspace', async () => {
  global.fetch = jest.fn().mockResolvedValue(response(state, 200))
  render(<CourseWorkspaceRoute courseId="course" status="authenticated" />)
  expect(await screen.findByText('Privater Autorenarbeitsplatz')).toBeInTheDocument()
  expect(screen.queryByText('Unsichere Bearbeitung')).not.toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith('/api/courses/course/authoring', expect.objectContaining({ cache: 'no-store' }))
})

test('a 403 may show published learning but cannot fall through to legacy author writes', async () => {
  global.fetch = jest.fn().mockResolvedValue(response({ error: 'Forbidden' }, 403))
  render(<CourseWorkspaceRoute courseId="course" status="authenticated" />)
  expect(await screen.findByText('Veröffentlichte Lernansicht')).toBeInTheDocument()
  expect(screen.queryByText('Unsichere Bearbeitung')).not.toBeInTheDocument()
})

test('an authoring outage is an error, never a live editor fallback', async () => {
  global.fetch = jest.fn().mockResolvedValue(response({ error: 'Unavailable' }, 500))
  render(<CourseWorkspaceRoute courseId="course" status="authenticated" />)
  expect(await screen.findByText('Kurs konnte nicht geladen werden')).toBeInTheDocument()
  expect(screen.queryByText('Unsichere Bearbeitung')).not.toBeInTheDocument()
})
