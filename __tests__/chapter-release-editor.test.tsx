import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { CourseChapterReleaseEditor } from '@/app/courses/[courseId]/contents/CourseChapterReleaseEditor'
import type { CourseContent } from '@/app/courses/[courseId]/contents/types'

const root: CourseContent = { id: 'chapter', courseId: 'course', parentId: null, title: 'Kapitel', type: 'TEXT', content: '', order: 1, releaseOn: '2026-11-01' }
const child: CourseContent = { ...root, id: 'child', title: 'Lektion', parentId: root.id, releaseOn: undefined }

test('a child shows its inherited UTC date and a real action to its root setting', () => {
  const selectRoot = jest.fn()
  render(<CourseChapterReleaseEditor root={root} selected={child} value="" busy={false} onChange={jest.fn()} onSave={jest.fn()} onRootSelect={selectRoot} />)
  expect(screen.getByText('Ab 01.11.2026 · 00:00 UTC · gilt für alle Unterthemen.')).toBeInTheDocument()
  expect(screen.queryByLabelText('Freigabedatum · 00:00 UTC')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Im Kapitel „Kapitel“ ändern' }))
  expect(selectRoot).toHaveBeenCalledTimes(1)
})

test('clearing the root date stages immediate availability and saves only explicitly', () => {
  const save = jest.fn()
  function Editor() {
    const [value, setValue] = useState(root.releaseOn ?? '')
    return <CourseChapterReleaseEditor root={root} selected={root} value={value} busy={false} onChange={setValue} onSave={() => save(value || null)} onRootSelect={jest.fn()} />
  }
  render(<Editor />)
  expect(screen.getByRole('button', { name: 'Freigabe speichern' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Freigabedatum · 00:00 UTC'), { target: { value: '' } })
  expect(save).not.toHaveBeenCalled()
  fireEvent.submit(screen.getByRole('form', { name: 'Kapitelfreigabe bearbeiten' }))
  expect(save).toHaveBeenCalledWith(null)
})

test('a busy scheduler keeps inherited navigation and date changes disabled', () => {
  const { rerender } = render(<CourseChapterReleaseEditor root={root} selected={root} value="2026-11-02" busy onChange={jest.fn()} onSave={jest.fn()} onRootSelect={jest.fn()} />)
  expect(screen.getByLabelText('Freigabedatum · 00:00 UTC')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Freigabe speichern' })).toBeDisabled()
  rerender(<CourseChapterReleaseEditor root={root} selected={child} value="" busy onChange={jest.fn()} onSave={jest.fn()} onRootSelect={jest.fn()} />)
  expect(screen.getByRole('button', { name: 'Im Kapitel „Kapitel“ ändern' })).toBeDisabled()
})
