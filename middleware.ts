import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

// Unterstützte Sprachen
const locales = ['en', 'de']
const defaultLocale = 'de'

// Pfade, die keine Sprachweiterleitung benötigen
const publicRoutes = ['/login', '/register']
const publicFiles = ['/favicon.ico', '/robots.txt']

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Überspringe API-Routen und statische Dateien
  if (pathname.startsWith('/api') || 
      pathname.startsWith('/_next') || 
      pathname.includes('.')) {
    return NextResponse.next()
  }

  // Hole den Token für Authentifizierung
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })

  // Authentifizierungsprüfung
  if (!token && !publicRoutes.includes(pathname)) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (pathname.startsWith('/admin') && token?.role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Sprachweiterleitung nur für nicht-öffentliche Routen
  if (!publicRoutes.includes(pathname) && !publicFiles.includes(pathname)) {
    // Prüfe ob der Pfad bereits eine Sprache enthält
    const pathnameIsMissingLocale = locales.every(
      (locale) => !pathname.startsWith(`/${locale}/`) && pathname !== `/${locale}`
    )

    if (pathnameIsMissingLocale) {
      // Prüfe Accept-Language Header
      const acceptLanguage = request.headers.get('accept-language')
      let locale = defaultLocale

      if (acceptLanguage) {
        const preferredLocale = acceptLanguage
          .split(',')[0]
          .split('-')[0]
          .toLowerCase()
        
        if (locales.includes(preferredLocale)) {
          locale = preferredLocale
        }
      }

      // Erstelle neue URL mit Sprache
      const newUrl = new URL(request.url)
      newUrl.pathname = `/${locale}${pathname}`
      return NextResponse.redirect(newUrl)
    }
  }

  return NextResponse.next()
}

// Konfiguriere die Middleware
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
}