// contexts/NotificationContext.tsx
'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { NotificationType } from '@/types/notifications';

interface Notification {
  id: string;
  type: NotificationType;
  content: string;
  isRead: boolean;
  createdAt: Date;
  userId: string;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  addNotification: (notification: Omit<Notification, 'id' | 'createdAt' | 'userId'>) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  // A user change remounts the state owner: previous private data and pending
  // responses cannot become visible in another session.
  return <SessionNotifications key={userId ?? 'anonymous'} userId={userId}>{children}</SessionNotifications>;
}

function SessionNotifications({ children, userId }: { children: ReactNode; userId: string | null }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [serverUnreadCount, setServerUnreadCount] = useState<number | null>(null);
  const [unreadDelta, setUnreadDelta] = useState(0);
  const [fullyLoaded, setFullyLoaded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    async function load() {
      try {
        let cursor: string | null = null;
        let capturedUnreadCount = false;
        const seenCursors = new Set<string>();
        do {
          const url: string = cursor
            ? `/api/notifications?cursor=${encodeURIComponent(cursor)}`
            : '/api/notifications';
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) throw new Error('Failed to fetch notifications');
          const data = await response.json();
          // Accept an older array response during clients' rolling upgrades.
          const items: Notification[] = Array.isArray(data) ? data : data.items;
          if (!capturedUnreadCount && !Array.isArray(data) && typeof data.unreadCount === 'number') {
            setServerUnreadCount(data.unreadCount);
            capturedUnreadCount = true;
          }
          cursor = Array.isArray(data) ? null : data.nextCursor;
          if (!controller.signal.aborted) setNotifications(previous => {
            // Preserve mutations made while older pages were still loading.
            const merged = new Map(items.map(item => [item.id, item]));
            previous.forEach(item => merged.set(item.id, item));
            return [...merged.values()].sort((a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id.localeCompare(a.id));
          });
          if (cursor && seenCursors.has(cursor)) throw new Error('Repeated notification cursor');
          if (cursor) seenCursors.add(cursor);
        } while (cursor && !controller.signal.aborted);
        if (!controller.signal.aborted) setFullyLoaded(true);
      } catch (error) {
        if (!controller.signal.aborted) console.error('Error fetching notifications:', error);
      }
    }
    void load();
    return () => controller.abort();
  }, [userId]);

  const markAsRead = async (id: string) => {
    if (!userId) return;
    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isRead: true }),
      });

      if (!response.ok) throw new Error('Failed to mark notification as read');

      setNotifications(prev =>
        prev.map(notif =>
          notif.id === id ? { ...notif, isRead: true } : notif
        )
      );
      if (!fullyLoaded && notifications.some(notif => notif.id === id && !notif.isRead)) {
        setUnreadDelta(previous => previous - 1);
      }
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const markAllAsRead = async () => {
    if (!userId) return;
    try {
      const response = await fetch('/api/notifications/mark-all-read', {
        method: 'POST',
      });

      if (!response.ok) throw new Error('Failed to mark all notifications as read');

      setNotifications(prev =>
        prev.map(notif => ({ ...notif, isRead: true }))
      );
      setServerUnreadCount(0);
      setUnreadDelta(0);
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  };

  const deleteNotification = async (id: string) => {
    if (!userId) return;
    try {
      const response = await fetch(`/api/notifications?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete notification');

      setNotifications(prev => prev.filter(notif => notif.id !== id));
      if (!fullyLoaded && notifications.some(notif => notif.id === id && !notif.isRead)) {
        setUnreadDelta(previous => previous - 1);
      }
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  };

  const addNotification = async (notification: Omit<Notification, 'id' | 'createdAt' | 'userId'>) => {
    if (!userId) return;

    try {
      const response = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...notification,
          userId
        }),
      });

      if (!response.ok) throw new Error('Failed to add notification');

      const newNotification = await response.json();
      setNotifications(prev => [newNotification, ...prev]);
      if (!fullyLoaded && !newNotification.isRead) setUnreadDelta(previous => previous + 1);
    } catch (error) {
      console.error('Error adding notification:', error);
    }
  };

  const unreadCount = !fullyLoaded && serverUnreadCount !== null
    ? Math.max(0, serverUnreadCount + unreadDelta)
    : notifications.filter(n => !n.isRead).length;

  const value = {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    addNotification,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
