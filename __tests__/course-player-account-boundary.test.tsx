import { Suspense } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { useSession } from '@/lib/sites-auth/react'
import CourseContentsPage from '@/app/courses/[courseId]/contents/page'

const mockRouter = { push: jest.fn(), replace: jest.fn() }
jest.mock('next-auth/react', () => ({ useSession: jest.fn() }))
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/app/courses/[courseId]/contents/CourseDraftWorkspace', () => ({
  CourseDraftWorkspace: ({ courseId }: { courseId: string }) => <div>
    <span>{courseId}</span>
    <input aria-label="Private draft" defaultValue="" />
  </div>,
}))

const authorState = { draft: { revision: 1, digest: 'draft', payload: { schemaVersion: 1, title: 'Course', description: '', startDate: null, endDate: null, imageUrl: null, contents: [] } }, activePublication: null }

it('re-authorizes and remounts the private workspace before a different viewer sees an unsaved draft', async () => {
  let finishBob!: (response: Response) => void
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => authorState }).mockImplementationOnce(() => new Promise<Response>(resolve => { finishBob = resolve }))
  const params = Object.assign(Promise.resolve({ courseId: 'course-1' }), {
    status: 'fulfilled', value: { courseId: 'course-1' },
  })
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'alice' }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>)

  const view = render(<Suspense fallback={<p>Loading</p>}><CourseContentsPage params={params} /></Suspense>)
  const draft = await screen.findByRole('textbox', { name: 'Private draft' })
  expect(screen.getByText('course-1')).toBeInTheDocument()
  fireEvent.change(draft, { target: { value: 'Alice unsaved lesson' } })
  expect(draft).toHaveValue('Alice unsaved lesson')

  jest.mocked(useSession).mockReturnValue({
    data: null, status: 'loading', update: jest.fn(),
  } as ReturnType<typeof useSession>)
  view.rerender(<Suspense fallback={<p>Loading</p>}><CourseContentsPage params={params} /></Suspense>)
  expect(screen.queryByRole('textbox', { name: 'Private draft' })).not.toBeInTheDocument()

  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'bob' }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>)
  view.rerender(<Suspense fallback={<p>Loading</p>}><CourseContentsPage params={params} /></Suspense>)
  expect(screen.queryByRole('textbox', { name: 'Private draft' })).not.toBeInTheDocument()
  finishBob({ ok: true, status: 200, json: async () => authorState } as Response)
  expect(await screen.findByRole('textbox', { name: 'Private draft' })).toHaveValue('')
  expect(fetch).toHaveBeenCalledTimes(2)
})
