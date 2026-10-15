/** @jest-environment node */
import { listAuthorCourses, readAuthoring } from '@/lib/server/course-authoring';
import prisma from '@/lib/prisma';

jest.mock('@/lib/prisma', () => ({ __esModule: true, default: { $transaction: jest.fn() } }));
jest.mock('@/lib/server/sanitize-html', () => ({ sanitizeTextServer: (value: string) => value }));
jest.mock('@/lib/server/course-assets', () => ({ extractCourseAssetUrls: () => [], assertCanReferenceCourseAsset: async () => {} }));

const payload = { schemaVersion: 1, title: 'Private', description: 'Private', startDate: null,
  endDate: null, imageUrl: null, contents: [] };
const tx = {
  course: { findUnique: jest.fn(), findMany: jest.fn() },
  courseDraft: { findUnique: jest.fn() },
  coursePublication: { findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
};

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.$transaction as jest.Mock).mockImplementation(async (work: (db: typeof tx) => Promise<unknown>) => work(tx));
  tx.course.findUnique.mockResolvedValue({ id: 'owned-course', instructorId: 'owner', activePublicationId: 'foreign-publication' });
  tx.courseDraft.findUnique.mockResolvedValue({ revision: 0, digest: 'draft-digest', payload: JSON.stringify(payload) });
  tx.coursePublication.findUnique.mockResolvedValue({ id: 'foreign-publication', courseId: 'foreign-course', sequence: 1, digest: 'foreign-digest' });
  tx.user.findUnique.mockResolvedValue({ id: 'owner', role: 'USER' });
  tx.course.findMany.mockResolvedValue([{ id: 'owned-course', draft: { revision: 0, digest: 'draft-digest', payload: JSON.stringify(payload) },
    activePublication: { id: 'foreign-publication', courseId: 'foreign-course', sequence: 1, digest: 'foreign-digest' } }]);
});

test('private author detail refuses a cross-course active publication pointer', async () => {
  await expect(readAuthoring('owned-course', { id: 'owner' })).rejects.toMatchObject({ status: 409 });
});

test('private author list refuses a cross-course active publication relation', async () => {
  await expect(listAuthorCourses({ id: 'owner' })).rejects.toMatchObject({ status: 409 });
});
