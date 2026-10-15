import { render, screen } from '@testing-library/react'
import { CourseContentsSidebar } from '@/app/courses/[courseId]/contents/CourseContentsSidebar'
import type { CourseContent } from '@/app/courses/[courseId]/contents/types'

const chapter: CourseContent = {
  id: 'chapter',
  courseId: 'course',
  title: 'Ein sehr langes Kapitel',
  type: 'TEXT',
  content: '',
  order: 0,
  parentId: null,
}

it('labels the course contents navigation and keeps topic controls reachable by touch', () => {
  render(<CourseContentsSidebar
    contents={[chapter]}
    selectedContentId="chapter"
    onContentSelect={jest.fn()}
    onEditClick={jest.fn()}
    onDeleteClick={jest.fn()}
    isInlineEditing={null}
    inlineEditTitle=""
    onInlineEditSubmit={jest.fn()}
    setIsInlineEditing={jest.fn()}
    setInlineEditTitle={jest.fn()}
    onMoveUp={jest.fn()}
    onMoveDown={jest.fn()}
    onMoveMainUp={jest.fn()}
    onMoveMainDown={jest.fn()}
    mainContentId={null}
    mainTopicIndex={0}
    courseId="course"
    courseName="Testkurs"
    isLoading={false}
    onSubContentSubmit={jest.fn()}
  />)

  const navigation = screen.getByRole('navigation', { name: 'Kursinhalte' })
  expect(navigation).toContainElement(screen.getByRole('button', { name: 'Ein sehr langes Kapitel' }))
  expect(screen.getByRole('button', { name: 'Ein sehr langes Kapitel' })).toHaveClass('min-h-11')
  expect(screen.getByRole('button', { name: 'Ein sehr langes Kapitel umbenennen' })).toHaveClass('h-11')
  expect(screen.getByRole('button', { name: 'Ein sehr langes Kapitel löschen' })).toHaveClass('h-11')
})
