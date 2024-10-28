// app/providers.tsx
'use client'

import { SessionProvider } from "next-auth/react"
import { ThemeProvider } from "@/components/theme-provider"
import { ChatProvider } from "@/contexts/ChatContext"
import { NotificationProvider } from "@/contexts/NotificationContext"
import { Toaster } from "@/components/ui/toaster"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <NotificationProvider>
          <ChatProvider>
            {children}
            <Toaster />
          </ChatProvider>
        </NotificationProvider>
      </ThemeProvider>
    </SessionProvider>
  )
}