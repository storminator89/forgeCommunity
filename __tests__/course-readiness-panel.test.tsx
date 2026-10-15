import { fireEvent, render, screen } from '@testing-library/react'
import { CourseReadinessPanel } from '@/app/courses/[courseId]/contents/CourseReadinessPanel'
import type { CourseContent } from '@/app/courses/[courseId]/contents/types'

const empty: CourseContent = { id: 'empty', courseId: 'course', title: 'Offenes Thema', type: 'TEXT', content: '', order: 1, parentId: null }

it('shows advisory live-save truth and routes findings through the parent callback', () => {
  const select = jest.fn()
  render(<CourseReadinessPanel contents={[empty]} onSelectContent={select} hasUnsavedChanges />)
  expect(screen.getByText(/Gespeicherte Änderungen sind sofort/)).toHaveTextContent('veröffentlicht nichts')
  expect(screen.getByText(/Die Prüfung zeigt den gespeicherten Stand/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /veröffentlichen/i })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Thema öffnen: Offenes Thema' }))
  expect(select).toHaveBeenCalledWith('empty')
  expect(fetch).not.toHaveBeenCalled()
})

it('disables finding navigation while the shell is saving without losing the finding', () => {
  render(<CourseReadinessPanel contents={[empty]} onSelectContent={jest.fn()} disabled />)
  expect(screen.getByRole('region', { name: 'Kurs prüfen' })).toHaveAttribute('aria-busy', 'true')
  expect(screen.getByRole('button', { name: 'Thema öffnen: Offenes Thema' })).toBeDisabled()
})

it('keeps ready and empty states informative and renders no inert action without a callback', () => {
  const view = render(<CourseReadinessPanel contents={[{ ...empty, content: '<p>Fertig</p>' }]} />)
  expect(screen.getByText(/Keine offenen Hinweise/)).toHaveTextContent('zusätzlich in der Vorschau')
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  view.rerender(<CourseReadinessPanel contents={[]} />)
  expect(screen.getByText('Noch keine Kursinhalte')).toBeInTheDocument()
  expect(screen.getByText(/Lege das erste Kapitel/)).toBeInTheDocument()
})
