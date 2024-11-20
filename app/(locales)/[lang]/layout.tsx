import { locales } from '@/i18n/settings'

export async function generateStaticParams() {
  return locales.map((lang) => ({ lang }))
}

export default function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { lang: string }
}) {
  return (
    <div lang={params.lang}>
      {children}
    </div>
  )
}
