import NextAuth from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

import { authOptions } from './options';
import {
  getClientAddress,
  normalizeEmail,
  readRequestBody,
} from '@/lib/server/auth-security';
import {
  consumeRateLimit,
  LOGIN_RATE_LIMIT,
  rateLimitHeaders,
} from '@/lib/server/rate-limit';

const handler = NextAuth(authOptions);
const MAX_AUTH_BODY_BYTES = 16 * 1024;
type AuthRouteContext = {
  params: Promise<{ nextauth: string[] }>;
};

function tooManyRequests(result: ReturnType<typeof consumeRateLimit>) {
  return NextResponse.json(
    { message: 'Zu viele Anmeldeversuche. Bitte versuchen Sie es später erneut.' },
    { status: 429, headers: rateLimitHeaders(result) },
  );
}

function rateLimitCredentials(
  request: Request,
  isCredentialsCallback: boolean,
  rawBody: string,
): Response | null {
  if (!isCredentialsCallback) return null;

  const addressLimit = consumeRateLimit(
    `login:ip:${getClientAddress(request.headers)}`,
    LOGIN_RATE_LIMIT,
  );
  if (!addressLimit.allowed) return tooManyRequests(addressLimit);

  let email: string | null = null;
  try {
    const body = new URLSearchParams(rawBody);
    const value = body.get('email');
    if (typeof value === 'string' && value.trim()) email = normalizeEmail(value);
  } catch {
    // NextAuth will return its normal invalid request response. The IP limit
    // still applies even when a caller sends a malformed content type/body.
  }

  if (email) {
    const emailLimit = consumeRateLimit(`login:email:${email}`, LOGIN_RATE_LIMIT);
    if (!emailLimit.allowed) return tooManyRequests(emailLimit);
  }

  return null;
}

export const GET = handler;

export async function POST(
  request: Request,
  context: AuthRouteContext,
) {
  const rawBody = await readRequestBody(request, MAX_AUTH_BODY_BYTES);
  if (rawBody === null) {
    return NextResponse.json(
      { message: 'Anfrage ist zu groß.' },
      { status: 413, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const authContext = await context.params;
  const isCredentialsCallback =
    authContext.nextauth?.[0] === 'callback' &&
    authContext.nextauth?.[1] === 'credentials';
  const limitedResponse = rateLimitCredentials(
    request,
    isCredentialsCallback,
    rawBody,
  );
  if (limitedResponse) return limitedResponse;

  // Reading the original stream above prevents an oversized body from being
  // buffered indefinitely. Rebuild a NextRequest so NextAuth still receives a
  // live body and retains the App Router nextUrl/context contract.
  const authRequest = new NextRequest(request.url, {
    method: request.method,
    headers: request.headers,
    body: rawBody || undefined,
  });

  return handler(
    authRequest as Parameters<typeof handler>[0],
    context as Parameters<typeof handler>[1],
  );
}
