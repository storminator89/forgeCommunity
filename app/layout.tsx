import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Providers } from './providers'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'ForgeCommunity',
  description: 'Eine Plattform für Wachstum, Austausch und Zusammenarbeit',
}

// Force all pages to be dynamically rendered (no static prerendering)
// This fixes "Element type is invalid: undefined" errors in Docker builds
export const dynamic = 'force-dynamic'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}