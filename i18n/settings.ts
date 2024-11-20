export const defaultLocale = 'de'
export const locales = ['en', 'de'] as const
export type Locale = typeof locales[number]

export function getLocaleFromPathname(pathname: string): Locale {
  const segments = pathname.split('/')
  const locale = segments[1] as Locale
  return locales.includes(locale) ? locale : defaultLocale
}

export function createLocalizedPathnameFromCurrent(currentPathname: string, newLocale: Locale): string {
  const segments = currentPathname.split('/')
  segments[1] = newLocale
  return segments.join('/')
}
