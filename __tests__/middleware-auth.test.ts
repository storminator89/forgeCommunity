jest.mock('next/server', () => ({
  NextResponse: {
    next: () => ({ kind: 'next' }),
    json: (body: unknown, init: { status?: number } = {}) => ({
      kind: 'json',
      body,
      status: init.status ?? 200,
    }),
    redirect: (url: URL) => ({ kind: 'redirect', url: url.toString() }),
  },
  NextRequest: class {},
}));
jest.mock('next-auth/jwt', () => ({ getToken: jest.fn() }));

import { config, proxy } from '../proxy';
import { getToken } from 'next-auth/jwt';

const mockGetToken = getToken as jest.Mock;

function request(pathname: string, method = 'GET', headers: HeadersInit = {}) {
  return {
    method,
    url: `https://community.example.test${pathname}`,
    nextUrl: { pathname },
    headers: new Headers(headers),
  } as any;
}

describe('auth middleware public and API boundaries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetToken.mockResolvedValue(null);
    process.env.NEXTAUTH_URL = 'https://community.example.test';
  });

  it('keeps public resource and certificate verification GETs reachable', async () => {
    await expect(proxy(request('/resources/resource-1'))).resolves.toEqual({ kind: 'next' });
    await expect(
      proxy(request('/api/resources/resource-1')),
    ).resolves.toEqual({ kind: 'next' });
    await expect(
      proxy(request('/api/verify-certificate/certificate-1')),
    ).resolves.toEqual({ kind: 'next' });

    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it('returns 401 JSON for an unauthenticated private API request', async () => {
    const response = await proxy(request('/api/private-data'));

    expect(response).toEqual(expect.objectContaining({ kind: 'json', status: 401 }));
  });

  it('fails closed for legacy public chat attachment paths, including image extensions', async () => {
    const response = await proxy(request('/images/uploads/chat-legacy-123.png'));

    expect(response).toEqual(expect.objectContaining({ kind: 'json', status: 404 }));
    expect(config.matcher).toContain('/images/uploads/:path*');
    await expect(proxy(request('/images/uploads/%63hat-legacy-123.png')))
      .resolves.toEqual(expect.objectContaining({ status: 404 }));
    await expect(proxy(request('/images/uploads/chat-legacy-123.png', 'HEAD')))
      .resolves.toEqual(expect.objectContaining({ status: 404 }));
  });

  it('keeps public images reachable while protecting API image paths', async () => {
    await expect(proxy(request('/images/uploads/image-123.png')))
      .resolves.toEqual({ kind: 'next' });
    await expect(proxy(request('/api/private.png')))
      .resolves.toEqual(expect.objectContaining({ status: 401 }));
  });
});
