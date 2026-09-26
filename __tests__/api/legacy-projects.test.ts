import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/users/[id]/projects/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { getSafeHttpUrl } from '@/lib/security';

jest.mock('next/server', () => {
  class MockNextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new MockNextResponse(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      });
    }
  }
  return { NextResponse: MockNextResponse };
});

jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    project: {
      create: jest.fn(),
    },
  },
}));

jest.mock('next-auth/next', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('@/app/api/auth/[...nextauth]/options', () => ({
  authOptions: {},
}));

describe('legacy profile project creation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getServerSession as jest.Mock).mockResolvedValue({
      user: { id: 'user-1', role: 'USER' },
    });
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd'])
    ('does not expose a stored unsafe URL to link renderers: %s', (link) => {
      expect(getSafeHttpUrl(link)).toBeNull();
    });

  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd'])
    ('rejects unsafe project URL %s before persistence', async (link) => {
      const request = {
        headers: { get: () => null },
        body: null,
        json: async () => ({
          title: 'Project',
          description: 'Description',
          link,
          tags: [],
        }),
      } as unknown as NextRequest;

      const response = await POST(request, {
        params: Promise.resolve({ id: 'user-1' }),
      });

      expect(response.status).toBe(400);
      expect(prisma.project.create).not.toHaveBeenCalled();
    });

  it('accepts an HTTPS project URL and persists the normalized value', async () => {
    (prisma.project.create as jest.Mock).mockResolvedValue({
      id: 'project-1',
      tags: [],
      _count: { likes: 0, comments: 0 },
    });

    const request = {
      headers: { get: () => null },
      body: null,
      json: async () => ({
        title: 'Project',
        description: 'Description',
        link: '  https://example.com/demo  ',
        tags: [],
      }),
    } as unknown as NextRequest;

    const response = await POST(request, {
      params: Promise.resolve({ id: 'user-1' }),
    });

    expect(response.status).toBe(201);
    expect(prisma.project.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ link: 'https://example.com/demo' }),
    }));
  });
});
