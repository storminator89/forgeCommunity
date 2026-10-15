import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CourseAuthoringOutline, type CourseAuthoringOutlineProps } from '@/app/courses/[courseId]/contents/CourseAuthoringOutline'
import { NewCourseContentDialog } from '@/app/courses/[courseId]/contents/NewCourseContentDialog'
import { authoringOutline, outlineReadiness } from '@/app/courses/[courseId]/contents/authoring-outline'
import type { CourseContent } from '@/app/courses/[courseId]/contents/types'

const node = (id: string, overrides: Partial<CourseContent> = {}): CourseContent => ({ id, courseId: 'course', title: id, type: 'TEXT', content: '', order: 1, parentId: null, ...overrides })
const nested = [node('Kapitel', { subContents: [node('Thema', { parentId: 'Kapitel', subContents: [node('Tiefes Thema', { parentId: 'Thema', type: 'VIDEO', content: 'https://youtu.be/example' })] })] }), node('Abschluss', { order: 2, type: 'QUIZ', content: JSON.stringify({ questions: [] }) })]
const props = (): CourseAuthoringOutlineProps => ({ contents: nested, selectedContentId: null, onContentSelect: jest.fn(), onAddContent: jest.fn(), onRename: jest.fn().mockResolvedValue(undefined), onMoveContent: jest.fn(), onReorder: jest.fn().mockResolvedValue(undefined), onDelete: jest.fn().mockResolvedValue(undefined) })

beforeAll(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } })

it('derives deterministic arbitrary-depth paths and leaves without changing saved data', () => {
  const original = JSON.stringify(nested)
  const entries = authoringOutline([...nested].reverse())
  expect(entries.map(entry => entry.position)).toEqual(['1', '1.1', '1.1.1', '2'])
  expect(entries[2]).toMatchObject({ depth: 2, path: ['Kapitel', 'Thema', 'Tiefes Thema'], ancestorIds: ['Kapitel', 'Thema'], childCount: 0, leafCount: 1, type: 'VIDEO' })
  expect(entries[0].leafCount).toBe(1)
  expect(entries[3]).toMatchObject({ readiness: 'check', readinessLabel: 'Quiz prüfen' })
  expect(JSON.stringify(nested)).toBe(original)
})

it('handles a repeated legacy node defensively without recursing forever', () => {
  const repeated = node('repeated')
  repeated.subContents = [repeated]
  expect(authoringOutline([repeated])).toHaveLength(1)
})

it('keeps readiness advisory and recognizes logical legacy quizzes and image-only text', () => {
  expect(outlineReadiness(node('empty', { content: '<p><br>&nbsp;</p>' }))).toMatchObject({ readiness: 'empty' })
  expect(outlineReadiness(node('image', { content: '<p><img src="/example.png" alt="Diagramm"></p>' }))).toMatchObject({ readiness: 'present' })
  expect(outlineReadiness(node('bad-video', { type: 'VIDEO', content: 'javascript:alert(1)' }))).toMatchObject({ readiness: 'check', readinessLabel: 'Quelle prüfen' })
  expect(authoringOutline([node('legacy-quiz', { content: JSON.stringify({ questions: [] }) })])[0].type).toBe('QUIZ')
})

it('shows every level with type context and leaves-only course counts', () => {
  render(<CourseAuthoringOutline {...props()} selectedContentId="Tiefes Thema" />)
  expect(screen.getByText('4 Einträge · 2 Lerninhalte')).toBeVisible()
  expect(screen.getByRole('button', { name: /1.1.1 Tiefes Thema Video/ })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByText('Quiz · Quiz prüfen')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Einklappen: Kapitel' }))
  expect(screen.queryByRole('button', { name: /Tiefes Thema Video/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Aufklappen: Kapitel' }))
  expect(screen.getByRole('button', { name: /Tiefes Thema Video/ })).toBeInTheDocument()
})

it('delegates selection and creation intent to the shell dirty guard', () => {
  const callbacks = props()
  const queued: Array<() => void> = []
  render(<CourseAuthoringOutline {...callbacks} requestAction={action => queued.push(action)} />)
  fireEvent.click(screen.getByRole('button', { name: /Tiefes Thema Video/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Inhalt hinzufügen' }))
  expect(callbacks.onContentSelect).not.toHaveBeenCalled()
  expect(callbacks.onAddContent).not.toHaveBeenCalled()
  act(() => { queued.forEach(action => action()) })
  expect(callbacks.onContentSelect).toHaveBeenCalledWith('Tiefes Thema')
  expect(callbacks.onAddContent).toHaveBeenCalledWith(null)
})

it('offers keyboard menu actions and passes the actual parent to reorder', async () => {
  const user = userEvent.setup()
  const callbacks = props()
  const guard = jest.fn((action: () => void) => action())
  render(<CourseAuthoringOutline {...callbacks} requestAction={guard} />)
  screen.getByRole('button', { name: 'Aktionen für Abschluss' }).focus()
  await user.keyboard('{Enter}')
  expect(await screen.findByRole('menuitem', { name: 'Nach unten' })).toHaveAttribute('data-disabled')
  await user.click(screen.getByRole('menuitem', { name: 'Nach oben' }))
  await waitFor(() => expect(callbacks.onReorder).toHaveBeenCalledWith('Abschluss', 'up', null))
  expect(await screen.findByRole('status')).toHaveTextContent('Reihenfolge gespeichert.')
  expect(guard).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: 'Aktionen für Tiefes Thema' }))
  await user.click(screen.getByRole('menuitem', { name: 'Unterinhalt hinzufügen' }))
  expect(callbacks.onAddContent).toHaveBeenCalledWith('Tiefes Thema')
  await user.click(screen.getByRole('button', { name: 'Aktionen für Thema' }))
  await user.click(screen.getByRole('menuitem', { name: 'Verschieben …' }))
  expect(callbacks.onMoveContent).toHaveBeenCalledWith('Thema')
})

it('retains a failed rename and allows one explicit retry with focus return', async () => {
  const user = userEvent.setup()
  const callbacks = props()
  jest.mocked(callbacks.onRename).mockRejectedValueOnce(new Error('Server nicht erreichbar'))
  render(<CourseAuthoringOutline {...callbacks} />)
  await user.click(screen.getByRole('button', { name: 'Aktionen für Thema' }))
  await user.click(screen.getByRole('menuitem', { name: 'Umbenennen' }))
  fireEvent.change(screen.getByLabelText('Titel'), { target: { value: ' Neuer Titel ' } })
  await user.click(screen.getByRole('button', { name: 'Speichern' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Server nicht erreichbar')
  expect(screen.getByLabelText('Titel')).toHaveValue(' Neuer Titel ')
  await user.click(screen.getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(callbacks.onRename).toHaveBeenCalledTimes(2)
  expect(callbacks.onRename).toHaveBeenLastCalledWith('Thema', 'Neuer Titel')
  expect(screen.getByRole('button', { name: 'Aktionen für Thema' })).toHaveFocus()
})

it('requires branch deletion confirmation and retains the dialog on failure', async () => {
  const user = userEvent.setup()
  const callbacks = props()
  jest.mocked(callbacks.onDelete).mockRejectedValueOnce(new Error('Löschen fehlgeschlagen'))
  render(<CourseAuthoringOutline {...callbacks} />)
  await user.click(screen.getByRole('button', { name: 'Aktionen für Kapitel' }))
  await user.click(screen.getByRole('menuitem', { name: 'Löschen …' }))
  expect(callbacks.onDelete).not.toHaveBeenCalled()
  expect(screen.getByRole('alertdialog')).toHaveTextContent('alle zugehörigen Unterinhalte')
  await user.click(screen.getByRole('button', { name: 'Löschen' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Löschen fehlgeschlagen')
  expect(screen.getByRole('alertdialog')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Löschen' }))
  await waitFor(() => expect(callbacks.onDelete).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
})

it('disables all mutation and selection controls while the shell is busy', () => {
  const callbacks = props()
  render(<CourseAuthoringOutline {...callbacks} disabled />)
  fireEvent.click(screen.getByRole('button', { name: 'Inhalt hinzufügen' }))
  fireEvent.click(screen.getByRole('button', { name: /Tiefes Thema Video/ }))
  expect(callbacks.onContentSelect).not.toHaveBeenCalled()
  expect(callbacks.onAddContent).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Aktionen für Thema' })).toBeDisabled()
})

it('creates with title and type together, preserves failure values and resets after confirmed close', async () => {
  const user = userEvent.setup()
  const create = jest.fn().mockRejectedValueOnce(new Error('Anlegen fehlgeschlagen')).mockResolvedValueOnce({ id: 'new' })
  const close = jest.fn()
  const view = render(<NewCourseContentDialog open onOpenChange={close} parentId="Thema" parentTitle="Thema" onCreate={create} />)
  expect(screen.getByRole('button', { name: 'Anlegen' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Titel'), { target: { value: ' Quiz zum Thema ' } })
  await user.click(screen.getByRole('button', { name: 'Quiz' }))
  expect(create).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Anlegen' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Anlegen fehlgeschlagen')
  expect(screen.getByLabelText('Titel')).toHaveValue(' Quiz zum Thema ')
  expect(screen.getByRole('button', { name: 'Quiz' })).toHaveAttribute('aria-pressed', 'true')
  expect(close).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Anlegen' }))
  expect(create).toHaveBeenLastCalledWith({ title: 'Quiz zum Thema', type: 'QUIZ', parentId: 'Thema' })
  await waitFor(() => expect(close).toHaveBeenCalledWith(false))
  view.rerender(<NewCourseContentDialog open={false} onOpenChange={close} parentId={null} onCreate={create} />)
  view.rerender(<NewCourseContentDialog open onOpenChange={close} parentId={null} onCreate={create} />)
  expect(screen.getByLabelText('Titel')).toHaveValue('')
  expect(screen.getByRole('button', { name: 'Text' })).toHaveAttribute('aria-pressed', 'true')
})

it('blocks duplicate creation and close controls until the pending create settles', async () => {
  let resolve!: (value: unknown) => void
  const create = jest.fn(() => new Promise(result => { resolve = result }))
  const close = jest.fn()
  render(<NewCourseContentDialog open onOpenChange={close} parentId={null} onCreate={create} />)
  fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Neuer Inhalt' } })
  const form = screen.getByRole('form', { name: 'Kursinhalt hinzufügen' })
  fireEvent.submit(form)
  fireEvent.submit(form)
  fireEvent.click(screen.getByRole('button', { name: 'Schließen' }))
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(create).toHaveBeenCalledTimes(1)
  expect(close).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeDisabled()
  await act(async () => resolve({ id: 'created' }))
  expect(close).toHaveBeenCalledWith(false)
})
