jest.mock('next/server', () => ({
  NextResponse: class MockNextResponse extends Response {
    static json(body: unknown, init: ResponseInit = {}) {
      return new MockNextResponse(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
      });
    }
  },
}));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    chatChannel: { findFirst: jest.fn() },
    chatMessage: { create: jest.fn(), findFirst: jest.fn() },
  },
}));
jest.mock('node:fs/promises', () => ({
  readFile: jest.fn(async () => Buffer.from('private image bytes')),
  mkdir: jest.fn(),
  writeFile: jest.fn(),
}));

import { getServerSession } from 'next-auth/next';
import { POST as postMessage } from '@/app/api/chat/messages/route';
import { GET as getChatUpload } from '@/app/api/chat/uploads/[filename]/route';
import prisma from '@/lib/prisma';

const mockedPrisma = prisma as unknown as {
  chatChannel: { findFirst: jest.Mock };
  chatMessage: { create: jest.Mock; findFirst: jest.Mock };
};

function privateFilename(ownerId: string) {
  return `chat-${Buffer.from(ownerId, 'utf8').toString('hex')}-01234567-89ab-cdef-0123-456789abcdef.png`;
}

describe('private chat image authorization', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not let a user repost another user\'s private upload', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'user-a' } });
    const request = {
      json: async () => ({
        content: '',
        channelId: 'channel-1',
        imageUrl: `/api/chat/uploads/${privateFilename('user-b')}`,
      }),
    } as unknown as Request;

    const response = await postMessage(request);

    expect(response.status).toBe(403);
    expect(mockedPrisma.chatChannel.findFirst).not.toHaveBeenCalled();
  });

  it('allows a channel member to read a private upload referenced by its message', async () => {
    const filename = privateFilename('uploader');
    ;(getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'member' } });
    mockedPrisma.chatMessage.findFirst.mockResolvedValue({ id: 'message-1' });

    const response = await getChatUpload(
      new Request(`http://localhost/api/chat/uploads/${filename}`),
      { params: Promise.resolve({ filename }) },
    );

    expect(response.status).toBe(200);
    expect(mockedPrisma.chatMessage.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ authorId: 'uploader' }),
    }));
  });
});
