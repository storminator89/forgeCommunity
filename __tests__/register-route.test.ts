jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  },
}));
jest.mock('bcrypt', () => ({ hash: jest.fn() }));
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init: ResponseInit = {}) => {
      const response = new Response(JSON.stringify(body), {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(init.headers || {}),
        },
      });
      response.json = async () => body;
      return response;
    },
  },
}));

import prisma from '@/lib/prisma';
import bcrypt from 'bcrypt';
import { POST } from '@/app/api/register/route';
import { resetRateLimitStore } from '@/lib/server/rate-limit';

const mockPrisma = prisma as unknown as {
  user: {
    findFirst: jest.Mock;
    create: jest.Mock;
  };
};
const mockBcrypt = bcrypt as unknown as { hash: jest.Mock };

function bodyStream(value: string) {
  const bytes = Uint8Array.from(value, character => character.charCodeAt(0));
  let consumed = false;

  return {
    getReader: () => ({
      read: async () => {
        if (consumed) return { done: true, value: undefined };
        consumed = true;
        return { done: false, value: bytes };
      },
      cancel: async () => undefined,
    }),
  };
}

function registrationRequest(email: string, password: string): Request {
  const body = { name: '  Test User  ', email, password };
  return {
    url: 'https://community.example.test/api/register',
    method: 'POST',
    headers: new Headers({
      origin: 'https://community.example.test',
      'content-type': 'application/json',
    }),
    body: bodyStream(JSON.stringify(body)),
  } as unknown as Request;
}

describe('POST /api/register', () => {
  beforeEach(() => {
    resetRateLimitStore();
    process.env.NEXTAUTH_URL = 'https://community.example.test';
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: 'new-user' });
    mockBcrypt.hash.mockResolvedValue('bcrypt-hash');
    jest.clearAllMocks();
  });

  it('normalizes the email before checking and creating the account', async () => {
    const response = await POST(
      registrationRequest('  Person@Example.COM ', 'StrongPassword1!'),
    );

    expect(response.status).toBe(201);
    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: { equals: 'person@example.com', mode: 'insensitive' } },
      }),
    );
    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: {
        name: 'Test User',
        email: 'person@example.com',
        password: 'bcrypt-hash',
      },
      select: { id: true },
    });
    expect(mockBcrypt.hash).toHaveBeenCalledWith('StrongPassword1!', 12);
  });

  it('rejects passwords over bcrypt’s 72 UTF-8 byte input limit', async () => {
    const tooLongPassword = `${'A'.repeat(70)}a1!`;
    const response = await POST(
      registrationRequest('long@example.com', tooLongPassword),
    );

    expect(response.status).toBe(400);
    expect(mockBcrypt.hash).not.toHaveBeenCalled();
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects an oversized request body before touching the database', async () => {
    const response = await POST(
      registrationRequest(`${'a'.repeat(17_000)}@example.com`, 'StrongPassword1!'),
    );

    expect(response.status).toBe(413);
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    expect(mockBcrypt.hash).not.toHaveBeenCalled();
  });

  it('does not apply the strict per address quota to unknown proxy addresses', async () => {
    const responses = [] as Response[];
    for (let index = 0; index < 6; index += 1) {
      responses.push(
        await POST(
          registrationRequest(`person-${index}@example.com`, 'StrongPassword1!'),
        ),
      );
    }

    expect(responses.every(response => response.status === 201)).toBe(true);
    expect(mockPrisma.user.create).toHaveBeenCalledTimes(6);
  });

  it('rejects a cross origin mutation', async () => {
    const request = {
      url: 'https://community.example.test/api/register',
      method: 'POST',
      headers: new Headers({
        origin: 'https://attacker.example',
        'content-type': 'application/json',
      }),
      body: bodyStream(JSON.stringify({
        name: 'Test User',
        email: 'cross-site@example.com',
        password: 'StrongPassword1!',
      })),
    } as unknown as Request;

    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });
});
