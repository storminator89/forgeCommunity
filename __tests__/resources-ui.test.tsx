import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axios from 'axios'
import Resources from '@/app/resources/page'
import ResourcePage from '@/app/resources/[id]/page'

let mockSession: { user: { id: string } } | null = null

jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/ResourcePreview', () => ({ ResourcePreview: () => <div>Ressourcenvorschau</div> }))
jest.mock('react-intersection-observer', () => ({ useInView: () => ({ ref: jest.fn() }) }))
jest.mock('next/navigation', () => ({ useParams: () => ({ id: 'resource-1' }) }))
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: mockSession }) }))
jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }))

const resource = {
  id: 'resource-1', title: 'Gute Quelle', type: 'ARTICLE', category: 'Design', url: 'https://example.com/quelle',
  author: { id: 'author', name: 'Ada' }, createdAt: '2026-05-01T10:00:00.000Z', updatedAt: '2026-05-02T10:00:00.000Z',
}

beforeEach(() => {
  mockSession = null
  jest.mocked(axios.get).mockReset()
  jest.mocked(axios.get).mockImplementation(async (url: string) => {
    if (url === '/api/resources/resource-1') return { data: resource }
    return { data: { resources: [resource], hasMore: false } }
  })
})

it('shows an internal detail link, safe source link, and visible result count', async () => {
  render(<Resources />)
  expect(await screen.findByRole('link', { name: 'Gute Quelle' })).toHaveAttribute('href', '/resources/resource-1')
  expect(screen.getByRole('link', { name: 'Quelle öffnen' })).toHaveAttribute('href', 'https://example.com/quelle')
  expect(screen.getByText('1 angezeigt')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Zum Inhalt springen' })).toHaveAttribute('href', '#page-content')
  expect(screen.getByLabelText('Ressourcen suchen')).toBeInTheDocument()
})

it('shows a retryable loading error instead of a false empty result', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.mocked(axios.get).mockRejectedValueOnce(new Error('offline'))
  render(<Resources />)
  expect(await screen.findByText('Ressourcen konnten nicht geladen werden')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
  expect(await screen.findByRole('link', { name: 'Gute Quelle' })).toBeInTheDocument()
  errorSpy.mockRestore()
})

it('lets an authenticated member create a resource from the empty state', async () => {
  mockSession = { user: { id: 'author' } }
  jest.mocked(axios.get).mockImplementation(async (url: string) => url.endsWith('/role')
    ? { data: { role: 'USER' } }
    : { data: { resources: [], hasMore: false } })
  const user = userEvent.setup()
  render(<Resources />)
  expect(await screen.findByText('Noch keine Ressourcen')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Erste Ressource hinzufügen' }))
  expect(await screen.findByRole('dialog', { name: 'Neue Ressource hinzufügen' })).toBeInTheDocument()
  expect(screen.getByLabelText('Titel')).toBeInTheDocument()
  expect(screen.getByLabelText('URL')).toBeInTheDocument()
})

it('confirms a resource deletion before sending the request', async () => {
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.scrollIntoView = jest.fn()
  const user = userEvent.setup()
  mockSession = { user: { id: 'author' } }
  jest.mocked(axios.get).mockImplementation(async (url: string) => url.endsWith('/role')
    ? { data: { role: 'USER' } }
    : { data: { resources: [resource], hasMore: false } })
  render(<Resources />)
  await screen.findByRole('link', { name: 'Gute Quelle' })
  await user.click(screen.getByRole('button', { name: 'Aktionen für Gute Quelle' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Löschen' }))
  expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
  expect(axios.delete).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
  expect(axios.delete).not.toHaveBeenCalled()
})

it('keeps resource detail, loading, and preview inside the main landmark', async () => {
  render(<ResourcePage />)
  expect(await screen.findByRole('heading', { name: 'Gute Quelle', level: 1 })).toBeInTheDocument()
  expect(screen.getByRole('main')).toHaveAttribute('id', 'page-content')
  expect(screen.getByRole('link', { name: 'Zur Ressourcenübersicht' })).toHaveAttribute('href', '/resources')
  expect(screen.getByRole('link', { name: 'Ressource öffnen' })).toHaveAttribute('href', 'https://example.com/quelle')
  expect(screen.getByText('Ressourcenvorschau')).toBeInTheDocument()
})

it('offers a retry after resource detail fails', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.mocked(axios.get).mockRejectedValueOnce(new Error('offline'))
  render(<ResourcePage />)
  expect(await screen.findByText('Ressource nicht verfügbar')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
  expect(await screen.findByRole('heading', { name: 'Gute Quelle', level: 1 })).toBeInTheDocument()
  await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(2))
  errorSpy.mockRestore()
})
