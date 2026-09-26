/** @jest-environment node */
import { PUT as updateArticle } from '@/app/api/articles/[id]/route';
import { GET as legacyEventICS, PUT as updateEvent } from '@/app/api/events/[id]/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { getSafeNavigationUrl } from '@/lib/security';

jest.mock('next/server', () => {
  class MockNextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new MockNextResponse(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json' } });
    }
  }
  return { NextResponse: MockNextResponse };
});
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {
  article: { findUnique: jest.fn(), update: jest.fn() },
  event: { findUnique: jest.fn(), update: jest.fn() },
} }));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/server/sanitize-html', () => ({
  sanitizeTextServer: (value: string) => value.trim(),
  sanitizeRichHtmlServer: (value: string) => value.trim(),
}));

const database = prisma as unknown as {
  article: { findUnique: jest.Mock; update: jest.Mock };
  event: { findUnique: jest.Mock; update: jest.Mock };
};
const params = { params: Promise.resolve({ id: 'item-1' }) };

beforeEach(() => {
  jest.clearAllMocks();
  (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'author-1', role: 'ADMIN' } });
});

it('publishes an existing draft when the editor sends isPublished', async () => {
  database.article.findUnique.mockResolvedValue({ id: 'item-1', authorId: 'author-1', isPublished: false, featuredImage: null });
  database.article.update.mockResolvedValue({ id: 'item-1', isPublished: true });
  const form = new URLSearchParams({ title: 'Title', content: '<p>Content</p>', category: 'Guides', isPublished: 'true' });

  const response = await updateArticle(new Request('http://localhost/api/articles/item-1', { method: 'PUT', body: form }) as any, params);
  expect(response.status).toBe(200);
  expect(database.article.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ isPublished: true }),
  }));
});

it('keeps the existing publish state for older editors and rejects invalid flags', async () => {
  database.article.findUnique.mockResolvedValue({ id: 'item-1', authorId: 'author-1', isPublished: true, featuredImage: null });
  database.article.update.mockResolvedValue({ id: 'item-1', isPublished: true });
  const form = new URLSearchParams({ title: 'Title', content: 'Content', category: 'Guides' });
  await updateArticle(new Request('http://localhost/api/articles/item-1', { method: 'PUT', body: form }) as any, params);
  expect(database.article.update.mock.calls[0][0].data).not.toHaveProperty('isPublished');
  form.set('isPublished', 'yes');
  const invalid = await updateArticle(new Request('http://localhost/api/articles/item-1', { method: 'PUT', body: form }) as any, params);
  expect(invalid.status).toBe(400);
});

it('uses a safe fixed filename and escaped ICS content for legacy downloads', async () => {
  database.event.findUnique.mockResolvedValue({
    id: 'item-1', title: 'Ä\r\nATTENDEE:evil', description: 'C\\D', location: 'A;B',
    date: new Date('2026-09-22T21:00:00Z'), timezone: 'Europe/Berlin', endTime: '01:00',
  });
  const response = await legacyEventICS(new Request('http://localhost/api/events/item-1'), params);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-disposition')).toBe('attachment; filename="event.ics"');
  const text = await response.text();
  expect(text).toContain('SUMMARY:Ä\\nATTENDEE:evil');
  expect(text).toContain('DESCRIPTION:C\\\\D');
  expect(text).toContain('DTEND:20260922T230000Z');
});

it('returns client errors for malformed and oversized event JSON', async () => {
  database.event.findUnique.mockResolvedValue({ id: 'item-1' });
  const malformed = await updateEvent(new Request('http://localhost/api/events/item-1', { method: 'PUT', body: '{' }), params);
  expect(malformed.status).toBe(400);
  const oversized = await updateEvent(new Request('http://localhost/api/events/item-1', { method: 'PUT', body: JSON.stringify({ title: 'x'.repeat(300000) }) }), params);
  expect(oversized.status).toBe(413);
});

it('keeps local resource links but rejects script and protocol-relative URLs', () => {
  expect(getSafeNavigationUrl('/resources/file.pdf')).toBe('/resources/file.pdf');
  expect(getSafeNavigationUrl('https://example.org/path')).toBe('https://example.org/path');
  expect(getSafeNavigationUrl('javascript:alert(1)')).toBeNull();
  expect(getSafeNavigationUrl('//evil.example/path')).toBeNull();
  expect(getSafeNavigationUrl('/\\evil.example/path')).toBeNull();
});
