import type { Locale } from './settings'

// We enumerate all dictionaries here for better linting and typescript support
const dictionaries = {
  en: () => import('./locales/en.json').then((module) => module.default),
  de: () => import('./locales/de.json').then((module) => module.default),
}

export const getDictionary = async (locale: Locale) => {
  try {
    return await dictionaries[locale]()
  } catch (error) {
    console.error(`Error loading dictionary for locale: ${locale}`, error)
    // Fallback to default dictionary if loading fails
    return dictionaries.de()
  }
}
