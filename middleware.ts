import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { NextRequest } from 'next/server';

// Öffentlich zugängliche Pfade (ohne Login)
const publicPaths = [
  '/',
  '/resources',
  '/login',
  '/register',
  '/api/auth',     // Auth endpoints (handled by NextAuth)
  '/api/register', // Registration endpoint
];

function isPublicPath(pathname: string): boolean {
  return publicPaths.some(path =>
    pathname === path || pathname.startsWith(path + '/')
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Öffentliche Pfade erlauben
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  if (pathname.startsWith('/admin') && token.role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};