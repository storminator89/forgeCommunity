// contexts/NotificationContext.tsx
'use client'

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { useSession } from '@/lib/sites-auth/react';
import { NotificationType } from '@/types/notifications';

interface Notification {
  id: string;
  type: NotificationType;
  content: string;
  isRead: boolean;
  createdAt: Date;
  userId: string;
  targetState?: 'available' | 'unavailable';
  actionLabel?: string | null;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  loadError: string | null;
  retry: () => void;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  openNotification: (id: string) => Promise<string | null>;
}

const NotificationContext = createContext<NotificationContextType | null>(null);
const POLL_INTERVAL_MS = 30_000;
const MIN_REQUEST_GAP_MS = 2_000;
const RETRY_START_MS = 5_000;
const MAX_RETRY_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const userId = status === 'authenticated' ? session?.user?.id ?? null : null;
  // A user change remounts the state owner: previous private data and pending
  // responses cannot become visible in another session.
  return <SessionNotifications key={userId ?? 'anonymous'} userId={userId}>{children}</SessionNotifications>;
}

function SessionNotifications({ children, userId }: { children: ReactNode; userId: string | null }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const notificationsRef = useRef<Notification[]>([]);
  const [serverUnreadCount, setServerUnreadCount] = useState<number | null>(null);
  const [unreadDelta, setUnreadDelta] = useState(0);
  const [isLoading, setIsLoading] = useState(Boolean(userId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const mutationRevision = useRef(0);
  const mutationController = useRef<AbortController | null>(null);
  const requestRefresh = useRef<(force?: boolean) => void>(() => {});

  useEffect(() => {
    const controller = new AbortController();
    mutationController.current = controller;
    return () => controller.abort();
  }, [userId]);

  const updateNotifications = (update: (current: Notification[]) => Notification[]) => {
    const next = update(notificationsRef.current);
    notificationsRef.current = next;
    setNotifications(next);
  };

  useEffect(() => {
    if (!userId) return;
    let disposed = false;
    let inFlight = false;
    let initialized = false;
    let refreshRequested = false;
    let failures = 0;
    let earliestRequestAt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    // Show the first page even if a visible tab has not received keyboard
    // focus yet; background refreshes wait until it is focused.
    const isAvailable = () => document.visibilityState !== 'hidden' &&
      navigator.onLine !== false && (!initialized || document.hasFocus());
    const clearTimer = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const schedule = (delay: number) => {
      clearTimer();
      if (disposed || !isAvailable()) return;
      timer = setTimeout(() => { timer = null; void load(); },
        Math.max(delay, earliestRequestAt - Date.now()));
    };
    async function load() {
      if (disposed || inFlight || !isAvailable()) return;
      inFlight = true;
      refreshRequested = false;
      earliestRequestAt = Date.now() + MIN_REQUEST_GAP_MS;
      const currentController = new AbortController();
      controller = currentController;
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; currentController.abort(); }, REQUEST_TIMEOUT_MS);
      const revisionAtStart = mutationRevision.current;
      try {
        setLoadError(null);
        let cursor: string | null = null;
        let completeScan = !initialized;
        const scannedItems: Notification[] = [];
        const seenCursors = new Set<string>();
        do {
          const url: string = cursor
            ? `/api/notifications?cursor=${encodeURIComponent(cursor)}`
            : '/api/notifications';
          const response = await fetch(url, { signal: currentController.signal, cache: 'no-store' });
          if (!response.ok) throw new Error('Failed to fetch notifications');
          const data = await response.json();
          // Accept an older array response during clients' rolling upgrades.
          const items: Notification[] = Array.isArray(data) ? data : data.items;
          if (!Array.isArray(items)) throw new Error('Invalid notification response');
          // A write during this GET can make both its snapshot and unread count
          // stale. Drop the response and revalidate after the write instead.
          if (currentController.signal.aborted && timedOut) throw new Error('Notification request timed out');
          if (currentController.signal.aborted || revisionAtStart !== mutationRevision.current) {
            refreshRequested = true;
            return;
          }
          const firstPage = cursor === null;
          const reportedUnreadCount = firstPage && !Array.isArray(data) &&
            typeof data.unreadCount === 'number' ? data.unreadCount : null;
          if (firstPage) {
            setServerUnreadCount(reportedUnreadCount);
            setUnreadDelta(0);
            // The old array contract represents the complete inbox.
            if (Array.isArray(data)) completeScan = true;
          }
          cursor = Array.isArray(data) ? null : data.nextCursor;
          scannedItems.push(...items);
          updateNotifications(previous => {
            const merged = new Map(previous.map(item => [item.id, item]));
            items.forEach(item => merged.set(item.id, item));
            return [...merged.values()].sort((a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id.localeCompare(a.id));
          });
          // A total that differs from the visible collection means an older
          // notification changed in another tab. Reconcile all pages then,
          // rather than showing an empty "unread" view beside a nonzero badge.
          if (!completeScan && reportedUnreadCount !== null &&
              notificationsRef.current.filter(item => !item.isRead).length !== reportedUnreadCount) {
            completeScan = true;
            setIsLoading(true);
          }
          if (cursor && seenCursors.has(cursor)) throw new Error('Repeated notification cursor');
          if (cursor) seenCursors.add(cursor);
          // Regular polls only fetch the latest page. A count mismatch or
          // initial load is the exception that walks the cursor chain.
          if (!completeScan) break;
        } while (cursor && !currentController.signal.aborted);
        if (currentController.signal.aborted) {
          if (timedOut) throw new Error('Notification request timed out');
          return;
        }
        if (completeScan) updateNotifications(() => {
          const unique = new Map(scannedItems.map(item => [item.id, item]));
          return [...unique.values()].sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id.localeCompare(a.id));
        });
        initialized = true;
        failures = 0;
        setIsLoading(false);
        setLoadError(null);
      } catch (error) {
        if (!disposed && (!currentController.signal.aborted || timedOut)) {
          failures += 1;
          earliestRequestAt = Date.now() + Math.min(MAX_RETRY_MS, RETRY_START_MS * 2 ** Math.min(failures - 1, 6));
          setIsLoading(false);
          setLoadError('Benachrichtigungen konnten nicht aktualisiert werden.');
          console.error('Error fetching notifications:', error);
        }
      } finally {
        clearTimeout(timeout);
        controller = null;
        inFlight = false;
        if (!disposed && isAvailable()) {
          const backoff = Math.min(MAX_RETRY_MS, RETRY_START_MS * 2 ** Math.min(failures - 1, 6));
          schedule(refreshRequested ? 0 : failures > 0 ? backoff : POLL_INTERVAL_MS);
        }
      }
    }
    const refresh = (force = false) => {
      if (force) earliestRequestAt = Date.now();
      refreshRequested = true;
      if (!inFlight) schedule(0);
    };
    const onAvailabilityChange = () => {
      if (isAvailable()) refresh();
      else {
        clearTimer();
        controller?.abort();
        if (navigator.onLine === false) {
          setIsLoading(false);
          setLoadError('Du bist offline. Benachrichtigungen werden nach der Verbindung aktualisiert.');
        }
      }
    };
    requestRefresh.current = refresh;
    document.addEventListener('visibilitychange', onAvailabilityChange);
    window.addEventListener('focus', onAvailabilityChange);
    window.addEventListener('blur', onAvailabilityChange);
    window.addEventListener('online', onAvailabilityChange);
    window.addEventListener('offline', onAvailabilityChange);
    if (navigator.onLine === false) onAvailabilityChange();
    else void load();
    return () => {
      disposed = true;
      clearTimer();
      controller?.abort();
      requestRefresh.current = () => {};
      document.removeEventListener('visibilitychange', onAvailabilityChange);
      window.removeEventListener('focus', onAvailabilityChange);
      window.removeEventListener('blur', onAvailabilityChange);
      window.removeEventListener('online', onAvailabilityChange);
      window.removeEventListener('offline', onAvailabilityChange);
    };
  }, [userId]);

  const markAsRead = async (id: string) => {
    if (!userId) return;
    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isRead: true }),
        signal: mutationController.current?.signal,
      });

      if (!response.ok) throw new Error('Failed to mark notification as read');
      if (mutationController.current?.signal.aborted) return;

      const wasUnread = notificationsRef.current.some(notif => notif.id === id && !notif.isRead);
      updateNotifications(prev => prev.map(notif =>
        notif.id === id ? { ...notif, isRead: true } : notif
      ));
      if (wasUnread) {
        setUnreadDelta(previous => previous - 1);
      }
      mutationRevision.current += 1;
      requestRefresh.current();
    } catch (error) {
      if (mutationController.current?.signal.aborted) return;
      console.error('Error marking notification as read:', error);
    }
  };

  const markAllAsRead = async () => {
    if (!userId) return;
    try {
      const response = await fetch('/api/notifications/mark-all-read', {
        method: 'POST',
        signal: mutationController.current?.signal,
      });

      if (!response.ok) throw new Error('Failed to mark all notifications as read');
      if (mutationController.current?.signal.aborted) return;

      updateNotifications(prev => prev.map(notif => ({ ...notif, isRead: true })));
      setServerUnreadCount(0);
      setUnreadDelta(0);
      mutationRevision.current += 1;
      requestRefresh.current();
    } catch (error) {
      if (mutationController.current?.signal.aborted) return;
      console.error('Error marking all notifications as read:', error);
    }
  };

  const deleteNotification = async (id: string) => {
    if (!userId) return;
    try {
      const response = await fetch(`/api/notifications?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        signal: mutationController.current?.signal,
      });

      if (!response.ok) throw new Error('Failed to delete notification');
      if (mutationController.current?.signal.aborted) return;

      const wasUnread = notificationsRef.current.some(notif => notif.id === id && !notif.isRead);
      updateNotifications(prev => prev.filter(notif => notif.id !== id));
      if (wasUnread) {
        setUnreadDelta(previous => previous - 1);
      }
      mutationRevision.current += 1;
      requestRefresh.current();
    } catch (error) {
      if (mutationController.current?.signal.aborted) return;
      console.error('Error deleting notification:', error);
    }
  };

  const openNotification = async (id: string): Promise<string | null> => {
    if (!userId) return null;
    let destinationMissing = false;
    try {
      const response = await fetch(`/api/notifications/${encodeURIComponent(id)}/open`, {
        method: 'POST', signal: mutationController.current?.signal,
      });
      if (!response.ok) {
        destinationMissing = response.status === 404;
        throw new Error('Destination unavailable');
      }
      const action = await response.json() as { href?: unknown };
      if (mutationController.current?.signal.aborted || typeof action.href !== 'string' ||
          !/^(\/profile\/[A-Za-z0-9_-]+|\/events#event-[A-Za-z0-9_-]+|\/community#comment-[A-Za-z0-9_-]+|\/chat\?channelId=[A-Za-z0-9_-]+&messageId=[A-Za-z0-9_-]+|\/community\/spaces\/[A-Za-z0-9_-]{1,100}\/missions\/[A-Za-z0-9_-]{1,100}\?invitation=[A-Za-z0-9_-]{1,100}#mission-invitation)(?![\s\S])/.test(action.href)) {
        throw new Error('Invalid notification destination');
      }
      const wasUnread = notificationsRef.current.some(item => item.id === id && !item.isRead);
      updateNotifications(previous => previous.map(item => item.id === id ? { ...item, isRead: true } : item));
      if (wasUnread) setUnreadDelta(previous => previous - 1);
      mutationRevision.current += 1;
      requestRefresh.current();
      return action.href;
    } catch (error) {
      if (!mutationController.current?.signal.aborted) {
        if (destinationMissing) {
          updateNotifications(previous => previous.map(item => item.id === id ? {
            ...item, content: 'Das zugehörige Ziel ist nicht mehr verfügbar.',
            targetState: 'unavailable', actionLabel: null,
          } : item));
          mutationRevision.current += 1;
        }
        requestRefresh.current(true);
      }
      console.error('Error opening notification:', error);
      return null;
    }
  };

  const unreadCount = serverUnreadCount !== null
    ? Math.max(0, serverUnreadCount + unreadDelta)
    : notifications.filter(n => !n.isRead).length;

  const value = {
    notifications,
    unreadCount,
    isLoading,
    loadError,
    retry: () => requestRefresh.current(true),
    markAsRead,
    markAllAsRead,
    deleteNotification,
    openNotification,
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
