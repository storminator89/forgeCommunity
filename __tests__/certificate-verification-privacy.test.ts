import { GET } from '@/app/api/verify-certificate/[certificateId]/route';
import prisma from '@/lib/prisma';

jest.mock('next/server', () => ({
  NextResponse: class extends Response {
    static json(value: unknown, init?: ResponseInit) { return new Response(JSON.stringify(value), init); }
  },
}));
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: { certificate: { findUnique: jest.fn() } } }));

const certificate = { id: 'certificate-1', userName: 'Ada', courseName: 'Sicherheit', issuedAt: new Date('2026-10-02T10:00:00Z') };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(prisma.certificate.findUnique).mockResolvedValue(certificate as never);
});

it('verifies a public certificate without reading account email or other relations', async () => {
  const response = await GET({} as never, { params: Promise.resolve({ certificateId: 'certificate-1' }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ valid: true, certificate: { ...certificate, issuedAt: '2026-10-02T10:00:00.000Z' } });
  expect(prisma.certificate.findUnique).toHaveBeenCalledWith({ where: { id: 'certificate-1' }, select: { id: true, userName: true, courseName: true, issuedAt: true } });
  expect(response.headers.get('Cache-Control')).toBe('no-store');
});

it('keeps an unknown certificate distinct from a verification outage', async () => {
  jest.mocked(prisma.certificate.findUnique).mockResolvedValueOnce(null);
  const response = await GET({} as never, { params: Promise.resolve({ certificateId: 'missing' }) });
  expect(response.status).toBe(404);
  expect((await response.json()).valid).toBe(false);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
});
