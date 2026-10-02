import { isPageVisited, markPageAsVisited, unmarkPageAsVisited } from '@/app/courses/[courseId]/contents/utils/visitedPages'

beforeEach(() => window.localStorage.clear())

it('announces the changed course even when another course was visited first', () => {
  markPageAsVisited('first-course', 'first-topic')
  const listener = jest.fn()
  window.addEventListener('visitedPagesChanged', listener)
  try {
    markPageAsVisited('second-course', 'second-topic')
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { courseId: 'second-course' } }))
    expect(isPageVisited('second-course', 'second-topic')).toBe(true)
    unmarkPageAsVisited('second-course', 'second-topic')
    expect(isPageVisited('second-course', 'second-topic')).toBe(false)
    expect(isPageVisited('first-course', 'first-topic')).toBe(true)
    expect(listener).toHaveBeenCalledTimes(2)
  } finally {
    window.removeEventListener('visitedPagesChanged', listener)
  }
})
