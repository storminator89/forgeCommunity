import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { NextRequest } from 'next/server';
import {
  isMutationMethod,
  isSameOriginRequest,
} from '@/lib/server/auth-security';

// Öffentlich zugängliche Pfade (ohne Login)
const publicPaths = [
  '/',
  '/login',
  '/register',
];

function isPublicPath(pathname: string, method: string): boolean {
  if (method.toUpperCase() === 'GET' && publicPaths.includes(pathname)) return true;

  if (['/api/auth'].some(path =>
    pathname === path || pathname.startsWith(path + '/')
  )) {
    return true;
  }

  return method.toUpperCase() === 'GET' &&
    ['/resources', '/verify-certificate'].some(path =>
      pathname === path || pathname.startsWith(path + '/')
    );
}

function isPublicApiRequest(pathname: string, method: string): boolean {
  if (pathname === '/api/register') return true;
  if (method.toUpperCase() !== 'GET') return false;

  return (
    pathname === '/api/health' ||
    pathname === '/api/resources' ||
    pathname.startsWith('/api/resources/') ||
    pathname === '/api/verify' ||
    pathname.startsWith('/api/verify/') ||
    pathname === '/api/verify-certificate' ||
    pathname.startsWith('/api/verify-certificate/')
  );
}

export async function proxy(req: NextRequest) {
  let pathname: string;
  try {
    pathname = decodeURIComponent(req.nextUrl.pathname);
  } catch {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  // Legacy chat attachments were written below public/ before private
  // attachment serving existed. Fail closed until those records are migrated
  // through the authenticated chat upload route.
  if (/^\/images\/uploads\/chat-[^/]+$/i.test(pathname)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const isApiRequest = pathname.startsWith('/api/');

  // Include image paths in the proxy matcher so encoded legacy filenames
  // cannot skip the check above. Other public images retain public access.
  if (!isApiRequest && ['GET', 'HEAD'].includes(req.method.toUpperCase()) &&
      /\.(?:svg|png|jpg|jpeg|gif|webp|ico)$/i.test(pathname)) {
    return NextResponse.next();
  }

  // NextAuth protects its own CSRF endpoints. This covers custom mutation
  // endpoints, including registration, and rejects browser cross-origin
  // requests before they reach a cookie-authenticated handler.
  if (isMutationMethod(req.method) && !isSameOriginRequest(req)) {
    return NextResponse.json(
      { message: 'Ungültige Anfragequelle.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Öffentliche Pfade erlauben
  if (isPublicPath(pathname, req.method) || isPublicApiRequest(pathname, req.method)) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  // API callers need a machine readable auth error. Browser pages retain the
  // login redirect for the existing UI flow.
  if (!token || typeof token.id !== 'string' || token.id.length === 0) {
    if (isApiRequest) {
      return NextResponse.json(
        { message: 'Authentifizierung erforderlich.' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/images/uploads/:path*',
    // Include API paths even when an identifier happens to end in a static
    // asset extension, so auth and CSRF checks cannot be bypassed.
    '/api/:path*',
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Public images are permitted after the legacy chat check above.
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
