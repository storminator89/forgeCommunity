// components/notification-badge.tsx
"use client"

import { useNotifications } from "@/contexts/NotificationContext"
import { Badge } from "@/components/ui/badge"

interface NotificationBadgeProps {
  className?: string;
}

export function NotificationBadge({ className }: NotificationBadgeProps) {
  const { unreadCount } = useNotifications()

  if (unreadCount === 0) return null;

  return (
    <Badge 
      className={`${className} bg-red-500 text-white min-w-[20px] h-5 flex items-center justify-center`}
    >
      {unreadCount > 99 ? '99+' : unreadCount}
    </Badge>
  )
}