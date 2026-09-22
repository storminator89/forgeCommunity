jest.mock('next-auth', () => ({
  __esModule: true,
  default: jest.fn(() => {
    const handler = jest.fn(async () => new Response('ok'));
    (globalThis as typeof globalThis & { __authRouteHandler?: jest.Mock }).__authRouteHandler = handler;
    return handler;
  }),
}));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('next/server', () => ({
  NextRequest: class MockNextRequest extends Request {
    nextUrl: URL;
    bodyText: string;

    constructor(input: string | URL, init?: RequestInit) {
      super(input, init);
      this.nextUrl = new URL(input.toString());
      this.bodyText = typeof init?.body === 'string' ? init.body : '';
    }

    async text() {
      return this.bodyText;
    }
  },
  NextResponse: {
    json: (body: unknown, init: ResponseInit = {}) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { 'content-type': 'application/json', ...(init.headers || {}) },
      }),
  },
}));

const { TextDecoder: NodeTextDecoder, TextEncoder: NodeTextEncoder } = require('util');
const { ReadableStream: NodeReadableStream } = require('node:stream/web');
if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = NodeTextDecoder;
}
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = NodeTextEncoder;
}
if (typeof globalThis.ReadableStream === 'undefined') {
  globalThis.ReadableStream = NodeReadableStream;
}

import { POST } from '@/app/api/auth/[...nextauth]/route';
import { resetRateLimitStore } from '@/lib/server/rate-limit';

const mockAuthHandler = (globalThis as typeof globalThis & {
  __authRouteHandler?: jest.Mock;
}).__authRouteHandler as jest.Mock;

function chunkedBody(chunks: Uint8Array[]) {
  let index = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (index >= chunks.length) return { done: true, value: undefined };
        return { done: false, value: chunks[index++] };
      },
      cancel: async () => undefined,
    }),
  };
}

function request(body: ReturnType<typeof chunkedBody>): Request {
  const bodyReader = body.getReader();
  const stream = new NodeReadableStream({
    pull: async (controller: {
      close: () => void;
      enqueue: (chunk: Uint8Array) => void;
    }) => {
      const result = await bodyReader.read();
      if (result.done) controller.close();
      else if (result.value) controller.enqueue(result.value);
    },
  });

  return {
    url: 'https://community.example.test/api/auth/callback/credentials',
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/x-www-form-urlencoded' }),
    body: stream,
  } as unknown as Request;
}

describe('NextAuth route wrapper', () => {
  beforeEach(() => {
    resetRateLimitStore();
    mockAuthHandler.mockClear();
  });

  it('rebuilds the capped body and forwards the dynamic route context', async () => {
    const rawBody = 'email=user%40example.com&password=StrongPassword1!';
    const context = { params: Promise.resolve({ nextauth: ['callback', 'credentials'] }) };

    const response = await POST(
      request(chunkedBody([Uint8Array.from(rawBody, character => character.charCodeAt(0))])),
      context,
    );

    const [forwardedRequest, forwardedContext] = mockAuthHandler.mock.calls[0];

    expect(response.status).toBe(200);
    expect(forwardedContext).toBe(context);
    expect(forwardedRequest.nextUrl.pathname).toBe('/api/auth/callback/credentials');
    expect(await forwardedRequest.text()).toBe(rawBody);
  });

  it('returns 413 before invoking NextAuth when a chunked body exceeds the cap', async () => {
    const chunk = new Uint8Array(8 * 1024);
    const response = await POST(
      request(chunkedBody([chunk, chunk, new Uint8Array([1])])),
      { params: Promise.resolve({ nextauth: ['callback', 'credentials'] }) },
    );

    expect(response.status).toBe(413);
    expect(mockAuthHandler).not.toHaveBeenCalled();
  });
});
