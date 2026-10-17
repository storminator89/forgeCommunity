import { NextRequest, NextResponse } from 'next/server';
import { isMutationMethod, isSameOriginRequest } from '@/lib/server/auth-security';

const SESSION_COOKIE = 'forgecommunity.session';
const publicPaths = new Set(['/', '/login', '/register', '/about']);
function isPublicPath(pathname: string, method: string) {
  if (['GET', 'HEAD'].includes(method) && pathname.startsWith('/h5p-runtime/')) return true;
  if (['GET', 'HEAD'].includes(method) && publicPaths.has(pathname)) return true;
  if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) return true;
  if (pathname === '/api/register') return true;
  return method === 'GET' && ['/resources', '/verify-certificate'].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
function isPublicApi(pathname: string, method: string) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method) && pathname.startsWith('/api/h5p/assets/')) return true;
  if (['GET', 'HEAD'].includes(method) && /^\/api\/courses\/[^/]+\/assets\/[^/]+$/.test(pathname)) return true;
  if (method !== 'GET') return false;
  return pathname === '/api/health' || pathname === '/api/leaderboard' || pathname === '/api/resources' || pathname.startsWith('/api/resources/') || pathname === '/api/verify' || pathname.startsWith('/api/verify/') || pathname === '/api/verify-certificate' || pathname.startsWith('/api/verify-certificate/');
}

export function proxy(req: NextRequest) {
  let pathname: string;
  try { pathname = decodeURIComponent(req.nextUrl.pathname); }
  catch { return NextResponse.json({ error: 'Invalid path' }, { status: 400 }); }

  if (/^\/images\/uploads\/chat-[^/]+$/i.test(pathname)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const isApi = pathname.startsWith('/api/');
  if (!isApi && ['GET', 'HEAD'].includes(req.method) && /\.(?:svg|png|jpg|jpeg|gif|webp|ico)$/i.test(pathname)) return NextResponse.next();
  if (isMutationMethod(req.method) && !isSameOriginRequest(req)) {
    return NextResponse.json({ message: 'Ungültige Anfragequelle.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  if (isPublicPath(pathname, req.method) || isPublicApi(pathname, req.method)) return NextResponse.next();

  const authenticated = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  if (!authenticated) {
    if (isApi) return NextResponse.json({ message: 'Authentifizierung erforderlich.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    const callback = `${pathname}${req.nextUrl.search}`;
    const login = new URL('/login', req.url);
    if (callback !== '/login') login.searchParams.set('callbackUrl', callback);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/images/uploads/:path*', '/api/:path*', '/((?!_next/static|_next/image|favicon.ico).*)'] };
