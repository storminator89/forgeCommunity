import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import VerifyCertificate from '@/app/verify-certificate/[certificateId]/page'

let mockCertificateId = 'certificate-123'
jest.mock('next/navigation', () => ({ useParams: () => ({ certificateId: mockCertificateId }) }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => <button>Design wechseln</button> }))

beforeEach(() => { jest.clearAllMocks(); mockCertificateId = 'certificate-123' })

it('distinguishes temporary verification failure from an unknown certificate and permits retry', async () => {
  jest.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500 } as Response).mockResolvedValueOnce({ ok: false, status: 404 } as Response)
  render(<VerifyCertificate />)
  expect(await screen.findByText('Prüfung nicht abgeschlossen')).toBeInTheDocument()
  expect(screen.queryByText('Zertifikat nicht gefunden')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Erneut prüfen' }))
  expect(await screen.findByText('Zertifikat nicht gefunden')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('encodes the certificate path and renders localized certificate details', async () => {
  mockCertificateId = 'id/with?separator'
  jest.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({ valid: true, certificate: { id: mockCertificateId, userName: 'Ada', courseName: 'Sicherheit', issuedAt: '2026-10-02T10:00:00Z' } }) } as Response)
  render(<VerifyCertificate />)
  expect(await screen.findByText('Zertifikat bestätigt')).toBeInTheDocument()
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/verify-certificate/id%2Fwith%3Fseparator', expect.objectContaining({ signal: expect.any(AbortSignal) })))
  expect(screen.getByText('Ada')).toBeInTheDocument()
  expect(screen.getByText('2. Oktober 2026')).toBeInTheDocument()
})
