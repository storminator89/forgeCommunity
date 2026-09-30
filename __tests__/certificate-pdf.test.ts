import { certificatePdfResponse } from '@/lib/server/certificate-pdf'
import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'

jest.mock('jspdf', () => ({ jsPDF: jest.fn() }))
jest.mock('qrcode', () => ({ __esModule: true, default: { toDataURL: jest.fn() } }))

const certificate = { id: 'certificate-1', userName: 'Learner', courseName: 'Course', issuedAt: new Date('2026-09-30T00:00:00Z') }
const originalAuthUrl = process.env.NEXTAUTH_URL
const originalPublicUrl = process.env.NEXT_PUBLIC_APP_URL
let textWithLink: jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  textWithLink = jest.fn()
  ;(QRCode.toDataURL as jest.Mock).mockResolvedValue('data:image/png;base64,placeholder')
  ;(jsPDF as unknown as jest.Mock).mockImplementation(() => ({
    internal: { pageSize: { width: 297, height: 210 } },
    setFillColor: jest.fn(), rect: jest.fn(), setFont: jest.fn(), setFontSize: jest.fn(),
    setTextColor: jest.fn(), text: jest.fn(), addImage: jest.fn(), textWithLink,
    output: jest.fn(() => new ArrayBuffer(0)),
  }))
})

afterEach(() => {
  if (originalAuthUrl === undefined) delete process.env.NEXTAUTH_URL
  else process.env.NEXTAUTH_URL = originalAuthUrl
  if (originalPublicUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL
  else process.env.NEXT_PUBLIC_APP_URL = originalPublicUrl
})

test('server certificate QR and clickable links use runtime auth origin ahead of build-time public origin', async () => {
  process.env.NEXTAUTH_URL = 'https://temporary-course.trycloudflare.com/'
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3013'
  const response = await certificatePdfResponse(certificate)
  const expected = 'https://temporary-course.trycloudflare.com/verify-certificate/certificate-1'
  expect(QRCode.toDataURL).toHaveBeenCalledWith(expected)
  expect(textWithLink).toHaveBeenCalledWith('Zertifikat verifizieren', expect.any(Number), expect.any(Number), { url: expected })
  expect(response.headers.get('Content-Type')).toBe('application/pdf')
})

test('server certificate still supports the public origin when runtime auth origin is absent', async () => {
  delete process.env.NEXTAUTH_URL
  process.env.NEXT_PUBLIC_APP_URL = 'https://courses.example.test/'
  await certificatePdfResponse(certificate)
  expect(QRCode.toDataURL).toHaveBeenCalledWith('https://courses.example.test/verify-certificate/certificate-1')
})
