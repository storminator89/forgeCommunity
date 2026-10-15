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
import { DELETE, POST } from '@/app/api/users/[id]/upload/route';
import { deleteUploadedImage, saveImageUpload } from '@/lib/server/image-upload';
import prisma from '@/lib/prisma';

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

describe('profile image unlink', () => {
  const params = { params: Promise.resolve({ id: 'user-1' }) };
  const request = (type: string) => ({ url: `http://localhost/api/users/user-1/upload?type=${type}` }) as never;

  beforeEach(() => {
    jest.clearAllMocks();
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-1', role: 'USER' } });
    jest.mocked(prisma.user.findUnique).mockResolvedValue({ image: '/images/uploads/avatar.png', coverImage: '/images/uploads/cover.png' } as never);
    jest.mocked(prisma.user.update).mockResolvedValue({ id: 'user-1' } as never);
  });

  it('unlinks an owned avatar and defers physical cleanup to the upload policy', async () => {
    const response = await DELETE(request('avatar'), params);
    expect(response.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { image: null } });
    expect(deleteUploadedImage).toHaveBeenCalledWith('/images/uploads/avatar.png');
  });

  it('rejects another member before reading or changing their images', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'other', role: 'USER' } });
    const response = await DELETE(request('cover'), params);
    expect(response.status).toBe(401);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects unknown image types without changing the profile', async () => {
    const response = await DELETE(request('sideways'), params);
    expect(response.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
