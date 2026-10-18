import NextAuth from 'next-auth';
import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';

import { authOptions, authorizeSignIn, authProvidersForRequest, oauthIssuerFor } from './options';
import { safeLoginCallback } from '@/lib/auth-login';
import {
  getClientAddress,
  normalizeEmail,
  readRequestBody,
} from '@/lib/server/auth-security';
import {
  consumeRateLimit,
  LOGIN_AGGREGATE_RATE_LIMIT,
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

  const address = getClientAddress(request.headers);
  const addressLimit = consumeRateLimit(
    address === 'unknown' ? 'login:aggregate' : `login:ip:${address}`,
    address === 'unknown' ? LOGIN_AGGREGATE_RATE_LIMIT : LOGIN_RATE_LIMIT,
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

function oauthFailure(request: NextRequest, code: 'OAuthCallback' | 'AccessDenied', rawBody?: string) {
  const url = `/login?error=${code}`;
  const headers = { 'Cache-Control': 'no-store' };
  if (request.method === 'POST' && new URLSearchParams(rawBody).get('json') === 'true') {
    return NextResponse.json({ url }, { headers });
  }
  return new Response(null, { status: 303, headers: { ...headers, Location: url } });
}

function validCodeCallback(request: NextRequest, issuer: string): boolean {
  if (request.method !== 'GET' || request.nextUrl.search.length > 16 * 1024) return false;
  const query = request.nextUrl.searchParams;
  const permitted = new Set(['code', 'state', 'scope', 'authuser', 'prompt', 'hd', 'iss', 'session_state']);
  for (const [key, value] of query) {
    if (!permitted.has(key) || query.getAll(key).length !== 1 || value.length > 4096 ||
        /[\u0000-\u001f\u007f]/.test(value)) return false;
  }
  // Do not permit an implicit/hybrid front-channel ID/access token to bypass
  // the authorization-code exchange and its PKCE verifier.
  return Boolean(query.get('code') && query.get('state') &&
    (!query.has('iss') || query.get('iss') === issuer));
}

async function handleAuth(request: NextRequest, context: AuthRouteContext, rawBody?: string) {
  const { nextauth } = await context.params;
  const action = nextauth?.[0];
  const providerId = nextauth?.[1];
  const isOAuth = providerId === 'google' || providerId === 'oidc';
  if (!isOAuth || (action !== 'signin' && action !== 'callback')) {
    return handler(request, context);
  }

  const issuer = oauthIssuerFor(providerId);
  if (!issuer) return oauthFailure(request, 'OAuthCallback', rawBody);
  if (action === 'callback') {
    // Provider errors never reach library logs or HTML with attacker-selected
    // error_description. A failed/aborted callback changes no account state.
    if (request.nextUrl.searchParams.has('error')) {
      return oauthFailure(request,
        request.nextUrl.searchParams.get('error') === 'access_denied' ? 'AccessDenied' : 'OAuthCallback', rawBody);
    }
    if (!validCodeCallback(request, issuer)) return oauthFailure(request, 'OAuthCallback', rawBody);
  } else {
    // NextAuth v4 merges request query values over provider defaults. Retain
    // only the safe local return path; scope/client_id/redirect_uri/response
    // type and mode always come from the private server configuration.
    const url = new URL(request.url);
    const callback = url.searchParams.get('callbackUrl');
    url.search = '';
    if (callback && request.method === 'GET') {
      url.searchParams.set('callbackUrl', safeLoginCallback(callback, process.env.NEXTAUTH_URL));
    } else if (callback && request.method === 'POST') {
      // Preserve NextAuth's query callbackUrl compatibility without forwarding
      // this local return path as an extra authorization parameter to the IdP.
      const contentType = request.headers.get('content-type')?.split(';')[0].trim();
      if (contentType === 'application/x-www-form-urlencoded') {
        const body = new URLSearchParams(rawBody);
        if (!body.get('callbackUrl')) body.set('callbackUrl', safeLoginCallback(callback, process.env.NEXTAUTH_URL));
        rawBody = body.toString();
      } else if (contentType === 'application/json') {
        try {
          const body = JSON.parse(rawBody ?? '') as Record<string, unknown>;
          if (!body || typeof body !== 'object' || Array.isArray(body)) return oauthFailure(request, 'OAuthCallback', rawBody);
          if (!body.callbackUrl) body.callbackUrl = safeLoginCallback(callback, process.env.NEXTAUTH_URL);
          rawBody = JSON.stringify(body);
        } catch { return oauthFailure(request, 'OAuthCallback', rawBody); }
      }
    }
    request = new NextRequest(url, {
      method: request.method,
      headers: request.headers,
      body: request.method === 'POST' ? rawBody || undefined : undefined,
    });
    // GET /signin renders NextAuth's normal sign-in page and never exchanges
    // credentials. Only its CSRF-checked POST starts an OAuth authorization.
    if (request.method === 'GET') return handler(request, context);
  }

  let providers;
  try {
    providers = await authProvidersForRequest(providerId);
  } catch {
    console.error('[auth] OIDC_DISCOVERY_FAILED');
    return oauthFailure(request, 'OAuthCallback', rawBody);
  }

  // Bind the link guard to this request, never shared mutable callback state.
  // Use the same signed session subject that NextAuth's callback handler uses.
  // Parse the scheme like NextAuth, rather than getToken's raw env-prefix
  // default: e.g. mixed-case "httpS:" still requires the Secure cookie.
  const secureCookie = authOptions.useSecureCookies ??
    new URL(process.env.NEXTAUTH_URL ?? 'http://localhost:3000').protocol === 'https:';
  const token = action === 'callback' ? await getToken({
    req: request,
    secret: authOptions.secret,
    secureCookie,
    cookieName: authOptions.cookies?.sessionToken?.name,
    decode: authOptions.jwt?.decode,
  }) : null;
  const currentUserId = typeof token?.sub === 'string' && token.sub ? token.sub : null;
  const requestHandler = NextAuth({
    ...authOptions,
    providers,
    callbacks: {
      ...authOptions.callbacks,
      signIn: arguments_ => authorizeSignIn(arguments_, currentUserId),
    },
  });
  return requestHandler(request, context);
}

export async function GET(request: NextRequest, context: AuthRouteContext) {
  return handleAuth(request, context);
}

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

  return handleAuth(authRequest, context, rawBody);
}
