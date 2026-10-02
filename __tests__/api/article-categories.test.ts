/** @jest-environment node */
import { GET } from '@/app/api/articles/categories-and-tags/route';
import prisma from '@/lib/prisma';

jest.mock('@/lib/prisma', () => ({ __esModule: true, default: { article: { groupBy: jest.fn() }, tag: { findMany: jest.fn() } } }));

it('loads category suggestions without an invalid null filter on a required field', async () => {
  jest.mocked(prisma.article.groupBy).mockImplementation(((async (query: any) => {
    if (query.where.category.notIn?.includes(null)) throw new Error('Invalid non-nullable filter');
    return [{ category: 'Entwicklung', _count: { category: 2 } }, { category: '  ', _count: { category: 1 } }] as any;
  }) as any));
  jest.mocked(prisma.tag.findMany).mockResolvedValue([{ name: 'Next.js' }, { name: '' }] as any);
  const response = await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ categories: ['Entwicklung'], tags: ['Next.js'] });
});
