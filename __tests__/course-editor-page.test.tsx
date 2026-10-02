import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useEffectEvent, useState } from 'react'
import { CourseContentsEditor } from '@/app/courses/[courseId]/contents/CourseContentsEditor'
import type { CourseContent } from '@/app/courses/[courseId]/contents/types'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn() }) }))
jest.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { user: { id: 'author' } } }) }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => <a href="/members">Mitglieder</a> }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => <button>Theme</button> }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => <button>Konto</button> }))
jest.mock('@/app/courses/[courseId]/contents/ContentRenderer', () => ({ ContentRenderer: ({ content }: { content: CourseContent }) => <p>{String(content.content)}</p> }))
jest.mock('@/app/courses/[courseId]/contents/CourseContentsSidebar', () => ({
  CourseContentsSidebar: ({ contents, onContentSelect }: { contents: CourseContent[]; onContentSelect: (id: string) => void }) => {
    const rows = (items: CourseContent[]): React.ReactNode => items.map(item => <div key={item.id}><button onClick={() => onContentSelect(item.id)}>{item.title}</button>{rows(item.subContents || [])}</div>)
    return <nav>{rows(contents)}</nav>
  },
}))
jest.mock('@/app/courses/[courseId]/contents/EditContentForm', () => ({
  EditContentForm: ({ content, onContentChange, onSubmit, onCancel }: { content: CourseContent; onContentChange: (content: Partial<CourseContent>) => void; onSubmit: (content: CourseContent) => Promise<void>; onCancel: () => void }) => {
    const [title, setTitle] = useState(content.title)
    const [error, setError] = useState('')
    const changed = useEffectEvent(onContentChange)
    useEffect(() => { if (content.type === 'TEXT' && content.content === '') changed({ content: '<p></p>' }) }, [content.content, content.type])
    return <form onSubmit={event => { event.preventDefault(); void onSubmit({ ...content, title }).catch(error => setError(error.message)) }}><label>Titel<input value={title} onChange={event => { setTitle(event.target.value); onContentChange({ title: event.target.value }) }} /></label><button type="submit">Speichern</button><button type="button" onClick={onCancel}>Abbrechen</button>{error && <p role="alert">{error}</p>}</form>
  },
}))

const child: CourseContent = { id: 'child', courseId: 'course', title: 'Unterthema', type: 'TEXT', content: '<p>Gespeichert</p>', order: 1, parentId: 'chapter' }
const chapter: CourseContent = { id: 'chapter', courseId: 'course', title: 'Kapitel', type: 'TEXT', content: '<p>Kapitelinhalt</p>', order: 1, parentId: null, subContents: [child] }
let mockFailSave = false
let mockCanEdit = true
let mockEmptyText = false
let mockRequest: jest.Mock

beforeEach(() => {
  history.replaceState({}, '', '/')
  mockFailSave = false; mockCanEdit = true; mockEmptyText = false; mockPush.mockClear()
  mockRequest = jest.fn(async (input: string, options?: RequestInit) => {
    if (options?.method === 'PUT') return { ok: !mockFailSave, status: mockFailSave ? 500 : 200, json: async () => ({ ...chapter, ...JSON.parse(String(options.body)), subContents: undefined }) }
    return { ok: true, status: 200, json: async () => input.endsWith('/contents') ? [JSON.parse(JSON.stringify({ ...chapter, content: mockEmptyText ? '' : chapter.content }))] : { id: 'course', name: 'Testkurs', canEdit: mockCanEdit } }
  })
  global.fetch = mockRequest
})

async function editChapter() {
  render(<CourseContentsEditor courseId="course" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Kapitel' }))
  fireEvent.click(screen.getByRole('button', { name: 'Inhalt bearbeiten' }))
}

it('verwirft einen Entwurf ohne den gespeicherten Baum zu verändern', async () => {
  await editChapter()
  fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Entwurf' } })
  expect(screen.getByRole('button', { name: 'Kapitel' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen verwerfen' }))
  expect(screen.getByRole('heading', { name: 'Kapitel' })).toBeInTheDocument()
  expect(mockRequest.mock.calls.filter(call => call[1]?.method === 'PUT')).toHaveLength(0)
})

it('behält nach dem Speichern eines Kapitels seine Unterthemen', async () => {
  await editChapter()
  fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Neuer Titel' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  expect(await screen.findByRole('heading', { name: 'Neuer Titel' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Unterthema' })).toBeInTheDocument()
})

it('behält einen fehlgeschlagenen Entwurf und erlaubt erneutes Speichern', async () => {
  await editChapter()
  fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Mein Entwurf' } })
  mockFailSave = true
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Dein Entwurf bleibt erhalten')
  expect(screen.getByLabelText('Titel')).toHaveValue('Mein Entwurf')
  mockFailSave = false
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  expect(await screen.findByRole('heading', { name: 'Mein Entwurf' })).toBeInTheDocument()
})

it('verhindert Themenwechsel und interne Navigation ohne Entwurfsentscheidung', async () => {
  await editChapter()
  fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Entwurf' } })
  fireEvent.click(screen.getByRole('button', { name: 'Unterthema' }))
  fireEvent.click(screen.getByRole('button', { name: 'Weiter bearbeiten' }))
  expect(screen.getByLabelText('Titel')).toHaveValue('Entwurf')
  fireEvent.click(screen.getByRole('link', { name: 'Mitglieder' }))
  expect(mockPush).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen verwerfen' }))
  expect(mockPush).toHaveBeenCalledWith('/members')
})

it('zeigt Lernenden keinen Inhalt-bearbeiten-Button', async () => {
  mockCanEdit = false
  render(<CourseContentsEditor courseId="course" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Kapitel' }))
  expect(screen.queryByRole('button', { name: 'Inhalt bearbeiten' })).not.toBeInTheDocument()
})

it('lädt den in der URL ausgewählten Inhalt wieder', async () => {
  history.replaceState({}, '', '/?content=child')
  render(<CourseContentsEditor courseId="course" />)
  expect(await screen.findByRole('heading', { name: 'Unterthema' })).toBeInTheDocument()
  await waitFor(() => expect(location.search).toBe('?content=child'))
})

it('behandelt ein normalisiertes leeres Textfeld als unverändert', async () => {
  mockEmptyText = true
  await editChapter()
  expect(screen.queryByText('Ungespeicherte Änderungen')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Inhalt bearbeiten' })).toBeInTheDocument()
})
