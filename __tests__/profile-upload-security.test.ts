jest.mock('next/server', () => ({
  NextResponse: {
    json: (_body: unknown, init: ResponseInit = {}) => ({ status: init.status ?? 200 }),
  },
}));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));
jest.mock('@/lib/server/image-upload', () => ({
  deleteUploadedImage: jest.fn(),
  ImageUploadValidationError: class ImageUploadValidationError extends Error {},
  saveImageUpload: jest.fn(),
}));
jest.mock('@/lib/server/request-body', () => ({
  RequestBodyLimitError: class RequestBodyLimitError extends Error {},
  requestWithBodyLimit: jest.fn(async (request: Request) => request),
}));

import { getServerSession } from 'next-auth/next';
import { POST } from '@/app/api/users/[id]/upload/route';
import { saveImageUpload } from '@/lib/server/image-upload';

describe('profile image upload validation', () => {
  it('rejects an unknown image target instead of treating it as an avatar', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1', role: 'USER' } });
    const request = {
      headers: new Headers(),
      formData: async () => ({
        get: (key: string) => key === 'file'
          ? { type: 'image/png', size: 1, arrayBuffer: async () => new Uint8Array([1]).buffer }
          : 'sideways',
      }),
    } as unknown as Request;

    const response = await POST(request as never, { params: Promise.resolve({ id: 'user-1' }) });

    expect(response.status).toBe(400);
    expect(saveImageUpload).not.toHaveBeenCalled();
  });
});
