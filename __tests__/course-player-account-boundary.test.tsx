import { Suspense } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { useSession } from 'next-auth/react'
import CourseContentsPage from '@/app/courses/[courseId]/contents/page'

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }))
jest.mock('@/app/courses/[courseId]/contents/CourseContentsEditor', () => ({
  CourseContentsEditor: ({ courseId }: { courseId: string }) => <div>
    <span>{courseId}</span>
    <input aria-label="Private draft" defaultValue="" />
  </div>,
}))

it('remounts the course player before a different viewer sees an unsaved draft', async () => {
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
  expect(screen.getByRole('textbox', { name: 'Private draft' })).toHaveValue('')

  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'bob' }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>)
  view.rerender(<Suspense fallback={<p>Loading</p>}><CourseContentsPage params={params} /></Suspense>)
  expect(screen.getByRole('textbox', { name: 'Private draft' })).toHaveValue('')
})
