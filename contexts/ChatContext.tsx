// contexts/ChatContext.tsx
'use client'

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, ReactNode } from 'react';
import type { Session } from '@/lib/sites-auth/server';
import { useSession } from '@/lib/sites-auth/react';
import { ChatMessage, ChatChannel, CreateChannelInput, EditMessageInput } from '@/types/chat';
import { BROWSER_CHAT_ALERT_PREFERENCE_EVENT, type BrowserChatAlertPreference } from '@/lib/browser-chat-alerts';

interface ChatContextType {
  channels: ChatChannel[];
  currentChannel: ChatChannel | null;
  messages: ChatMessage[];
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  loadedChannelId: string | null;
  hasNewerMessages: boolean;
  loadOlderMessages: () => Promise<void>;
  markRead: (channelId: string, messageId: string | null) => Promise<void>;
  setCurrentChannel: (channel: ChatChannel) => void;
  sendMessage: (content: string, imageFile?: File) => Promise<boolean>;
  editMessage: (input: EditMessageInput) => Promise<void>;
  createChannel: (input: CreateChannelInput) => Promise<void>;
  deleteChannel: (channelId: string) => Promise<void>;
  loading: boolean;
  error: string | null;
  clearError: () => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { data, status } = useSession();
  const session = status === 'authenticated' ? data : null;

  // Channel-list visibility also depends on role. Remount at either account
  // or role changes so a downgraded account cannot render stale private room
  // names while its new channel list is still loading.
  return <AccountChatProvider key={`${session?.user?.id ?? 'anonymous'}:${session?.user?.role ?? 'none'}`} session={session}>
    {children}
  </AccountChatProvider>;
}

function AccountChatProvider({ children, session }: { children: ReactNode; session: Session | null }) {
  const sessionUserId = session?.user?.id;
  const isAdmin = session?.user?.role === 'ADMIN';
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [currentChannel, setCurrentChannelState] = useState<ChatChannel | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [loadedChannelId, setLoadedChannelId] = useState<string | null>(null);
  const [hasNewerMessages, setHasNewerMessages] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date>(new Date());
  const [lastSyncId, setLastSyncId] = useState<string | null>(null);
  const [isWindowFocused, setIsWindowFocused] = useState(true);
  const [processedMessageIds] = useState<Set<string>>(new Set());
  const activeChannelIdRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const sendControllerRef = useRef<AbortController | null>(null);
  const optimisticSequenceRef = useRef(0);
  const olderRequestRef = useRef<string | null>(null);
  const syncingRef = useRef<symbol | null>(null);
  const initialLoadedChannelRef = useRef<string | null>(null);
  const readMarksInFlightRef = useRef(new Set<string>());
  const lastSuccessfulReadRef = useRef(new Map<string, string>());
  const readMarkGenerationRef = useRef(new Map<string, number>());
  const channelListEpochRef = useRef(0);
  const channelListRequestSequenceRef = useRef(0);

  useLayoutEffect(() => {
    // This provider is keyed by account. Cancel both upload and message requests
    // synchronously at the logout/account-switch/unmount commit. Recreate the
    // controller on setup so Strict Mode's cleanup cannot cancel future sends.
    const controller = new AbortController();
    sendControllerRef.current = controller;
    return () => {
      controller.abort();
      sendControllerRef.current = null;
    };
  }, []);
  // An unverified or failed preference load must never enable desktop alerts.
  const browserAlertsEnabledRef = useRef(false);
  // Browser notifications outlive the React tree. Keep their handles with the
  // account that created them so private excerpts do not survive its session.
  const desktopNotificationsRef = useRef(new Set<Notification>());
  const closeDesktopNotifications = useCallback(() => {
    for (const notification of desktopNotificationsRef.current) {
      try {
        notification.close();
      } catch (error) {
        console.error('Error closing desktop notification:', error);
      }
    }
    desktopNotificationsRef.current.clear();
  }, []);
  const showDesktopNotification = useCallback((title: string, body: string) => {
    if (!browserAlertsEnabledRef.current || !('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const notification = new Notification(title, { body });
      desktopNotificationsRef.current.add(notification);
      notification.addEventListener('close', () => desktopNotificationsRef.current.delete(notification), { once: true });
    } catch (error) {
      console.error('Error showing desktop notification:', error);
    }
  }, []);

  useEffect(() => {
    const userId = session?.user?.id;
    browserAlertsEnabledRef.current = false;
    if (!userId) return;

    const controller = new AbortController();
    let updatedAfterRequest = false;
    const onPreferenceChange = (event: Event) => {
      const preference = (event as CustomEvent<BrowserChatAlertPreference>).detail;
      if (preference?.userId !== userId) return;
      updatedAfterRequest = true;
      browserAlertsEnabledRef.current = preference.enabled === true;
      if (!browserAlertsEnabledRef.current) closeDesktopNotifications();
    };
    window.addEventListener(BROWSER_CHAT_ALERT_PREFERENCE_EVENT, onPreferenceChange);

    void fetch('/api/user/profile', { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Desktop notification preference unavailable');
        return response.json() as Promise<{ id?: string; userSettings?: { pushNotifications?: boolean } | null }>;
      })
      .then(profile => {
        if (!controller.signal.aborted && !updatedAfterRequest && profile.id === userId) {
          // An account without a settings row uses the database default. A
          // malformed settings response must not enable private desktop text.
          browserAlertsEnabledRef.current = profile.userSettings === null
            ? true
            : profile.userSettings?.pushNotifications === true;
        }
      })
      .catch(() => { /* Keep desktop alerts off when preferences cannot be verified. */ });

    return () => {
      controller.abort();
      window.removeEventListener(BROWSER_CHAT_ALERT_PREFERENCE_EVENT, onPreferenceChange);
      browserAlertsEnabledRef.current = false;
      closeDesktopNotifications();
    };
  }, [closeDesktopNotifications, session?.user?.id]);

  const setActiveChannel = useCallback((channel: ChatChannel) => {
    if (activeChannelIdRef.current === channel.id) return;
    activeChannelIdRef.current = channel.id;
    setMessages([]);
    setHasOlderMessages(false);
    setLoadingOlderMessages(false);
    setLoadedChannelId(null);
    setHasNewerMessages(false);
    olderRequestRef.current = null;
    syncingRef.current = null;
    initialLoadedChannelRef.current = null;
    setLastSync(new Date(0));
    setLastSyncId(null);
    setCurrentChannelState(channel);
  }, []);

  useEffect(() => {
    activeChannelIdRef.current = currentChannel?.id ?? null;
  }, [currentChannel?.id]);

  useEffect(() => {
    activeSessionIdRef.current = session?.user?.id ?? null;
  }, [session?.user?.id]);

  const fetchChannels = useCallback(async (signal?: AbortSignal, sessionUserId?: string, background = false): Promise<boolean> => {
    const listEpochAtStart = channelListEpochRef.current;
    const requestSequence = ++channelListRequestSequenceRef.current;
    try {
      if (!background) setLoading(true);
      const response = await fetch('/api/chat/channels', { signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Failed to fetch channels');
      const data = await response.json();
      if (signal?.aborted || (sessionUserId && activeSessionIdRef.current !== sessionUserId)) return false;
      // A local read, channel deletion, or permission rejection can supersede
      // this response. The sequence also rejects an older GET if scheduling
      // changes later, even though the current scheduler is single-flight.
      if (requestSequence !== channelListRequestSequenceRef.current ||
          listEpochAtStart !== channelListEpochRef.current) return true;
      channelListEpochRef.current++;
      setChannels(data);
      const selectedId = activeChannelIdRef.current;
      if (selectedId && !data.some((channel: ChatChannel) => channel.id === selectedId)) {
        // The current permission-filtered list no longer includes this room.
        // Drop its contents now rather than waiting for a later message 403.
        activeChannelIdRef.current = null;
        initialLoadedChannelRef.current = null;
        setMessages([]);
        setLoadedChannelId(null);
        setHasOlderMessages(false);
        setLoadingOlderMessages(false);
        setHasNewerMessages(false);
        setLastSync(new Date(0));
        setLastSyncId(null);
        setCurrentChannelState(null);
      } else if (!background && data.length > 0) {
        // Admins can list private rooms they have not joined. An initial
        // auto-selection must choose a readable public room; later refreshes
        // never re-open a room already rejected by the messages endpoint.
        const initialRoom = isAdmin
          ? data.find((channel: ChatChannel) => !channel.isPrivate)
          : data[0];
        if (initialRoom) setCurrentChannelState(previousChannel => previousChannel ?? initialRoom);
      }
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return false;
      const errorMessage = err instanceof Error ? err.message : 'Error fetching channels';
      if (!background) setError(errorMessage);
      console.error(errorMessage);
      return false;
    } finally {
      if (!background && (!sessionUserId || activeSessionIdRef.current === sessionUserId)) {
        setLoading(false);
      }
    }
  }, [isAdmin]);

  const fetchMessages = useCallback(async (channelId: string, signal?: AbortSignal) => {
    try {
      initialLoadedChannelRef.current = null;
      setLoadedChannelId(null);
      setHasNewerMessages(false);
      setLoading(true);
      const response = await fetch(
        `/api/chat/messages?channelId=${encodeURIComponent(channelId)}&latest=true&limit=50`,
        { signal },
      );
      if (response.status === 403 && activeChannelIdRef.current === channelId) {
        activeChannelIdRef.current = null;
        initialLoadedChannelRef.current = null;
        channelListEpochRef.current++;
        setLoadedChannelId(null);
        setMessages([]);
        setHasOlderMessages(false);
        setLoadingOlderMessages(false);
        // The finally block only clears loading for a still-active channel.
        // A revoked room is no longer active, so release the initial spinner
        // here before showing the remaining channels.
        setLoading(false);
        setChannels(previous => previous.filter(channel => channel.id !== channelId));
        setCurrentChannelState(null);
      }
      if (!response.ok) throw new Error('Failed to fetch messages');
      const data = await response.json();

      // A user can switch channels while this request is in flight. Ignore a
      // late response instead of replacing the newly selected channel's list.
      if (signal?.aborted || activeChannelIdRef.current !== channelId) return;

      const sortedMessages = data.items.sort(
        (a: ChatMessage, b: ChatMessage) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id)
      );

      // Füge alle initial geladenen Nachrichten zum Set hinzu
      sortedMessages.forEach((msg: ChatMessage) => processedMessageIds.add(msg.id));

      setMessages(sortedMessages);
      setHasOlderMessages(data.hasMore === true);
      initialLoadedChannelRef.current = channelId;
      setLoadedChannelId(channelId);
      // The API limits the initial response. Advancing with the browser clock
      // can move the cursor past server timestamps (and skip messages), so
      // continue from the newest message actually received.
      setLastSync(
        data.nextCursor?.after
          ? new Date(data.nextCursor.after)
          : sortedMessages.length > 0
            ? new Date(sortedMessages[sortedMessages.length - 1].createdAt)
            : new Date(0),
      );
      setLastSyncId(
        typeof data.nextCursor?.afterId === 'string'
          ? data.nextCursor.afterId
          : sortedMessages.length > 0
            ? sortedMessages[sortedMessages.length - 1].id
            : null,
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const errorMessage = err instanceof Error ? err.message : 'Error fetching messages';
      setError(errorMessage);
      console.error(errorMessage);
    } finally {
      if (activeChannelIdRef.current === channelId) {
        setLoading(false);
      }
    }
  }, [processedMessageIds]);

  const loadOlderMessages = useCallback(async () => {
    const channelId = currentChannel?.id;
    const oldest = messages[0];
    if (!channelId || !oldest || !hasOlderMessages || olderRequestRef.current === channelId) return;
    olderRequestRef.current = channelId;
    setLoadingOlderMessages(true);
    try {
      const before = new Date(oldest.createdAt).toISOString();
      const response = await fetch(`/api/chat/messages?channelId=${encodeURIComponent(channelId)}&before=${encodeURIComponent(before)}&beforeId=${encodeURIComponent(oldest.id)}`);
      if (response.status === 403 && activeChannelIdRef.current === channelId) {
        activeChannelIdRef.current = null;
        initialLoadedChannelRef.current = null;
        channelListEpochRef.current++;
        setLoadedChannelId(null);
        setMessages([]);
        setHasOlderMessages(false);
        setLoadingOlderMessages(false);
        setChannels(previous => previous.filter(channel => channel.id !== channelId));
        setCurrentChannelState(null);
      }
      if (!response.ok) throw new Error('Failed to fetch older messages');
      const data = await response.json();
      if (activeChannelIdRef.current !== channelId || activeSessionIdRef.current !== sessionUserId) return;
      const older = data.items as ChatMessage[];
      older.forEach(message => processedMessageIds.add(message.id));
      setMessages(previous => {
        const known = new Set(previous.map(message => message.id));
        return [...older.filter(message => !known.has(message.id)), ...previous];
      });
      setHasOlderMessages(data.hasMore === true);
      setError(null);
    } catch (err) {
      if (activeChannelIdRef.current !== channelId) return;
      setError(err instanceof Error ? err.message : 'Failed to fetch older messages');
    } finally {
      if (olderRequestRef.current === channelId) olderRequestRef.current = null;
      if (activeChannelIdRef.current === channelId) setLoadingOlderMessages(false);
    }
  }, [currentChannel, hasOlderMessages, messages, processedMessageIds, sessionUserId]);

  const syncMessages = useCallback(async (signal?: AbortSignal) => {
    if (!currentChannel || !sessionUserId || syncingRef.current || initialLoadedChannelRef.current !== currentChannel.id) return;

    const channelId = currentChannel.id;
    let cursor = lastSync;
    let cursorId = lastSyncId;
    let morePending = false;
    const syncToken = Symbol('chat-sync');
    syncingRef.current = syncToken;
    // While the cursor poll is in flight, the visible tail is not yet known.
    setHasNewerMessages(true);

    try {
      // A burst may span several 50-message pages. Drain a bounded batch now
      // instead of waiting 10 seconds per page; the next poll resumes if needed.
      for (let page = 0; page < 4; page++) {
        const response = await fetch(
          `/api/chat/messages?channelId=${encodeURIComponent(channelId)}&after=${encodeURIComponent(cursor.toISOString())}${cursorId ? `&afterId=${encodeURIComponent(cursorId)}` : ''}`,
          { signal },
        );
        if (response.status === 403 && activeChannelIdRef.current === channelId) {
          activeChannelIdRef.current = null;
          initialLoadedChannelRef.current = null;
          channelListEpochRef.current++;
          setMessages([]);
          setHasOlderMessages(false);
          setChannels(previous => previous.filter(channel => channel.id !== channelId));
          setCurrentChannelState(null);
        }
        if (!response.ok) throw new Error('Failed to sync messages');
        const data = await response.json();
        if (signal?.aborted || activeChannelIdRef.current !== channelId || activeSessionIdRef.current !== sessionUserId) return;
        morePending = data.hasMore === true;
        if (morePending) setHasNewerMessages(true);

        const newMessages = (data.items as ChatMessage[]).filter(newMsg => !processedMessageIds.has(newMsg.id));
        newMessages.forEach(newMsg => processedMessageIds.add(newMsg.id));
        for (const newMsg of newMessages) {
          if (newMsg.author.id === sessionUserId) continue;
          const notificationContent = `${newMsg.author.name} hat in #${currentChannel.name} geschrieben: ${newMsg.content.length > 50
            ? newMsg.content.substring(0, 47) + '...'
            : newMsg.content}`;
          if (!isWindowFocused && browserAlertsEnabledRef.current) {
            showDesktopNotification('Neue Nachricht', notificationContent);
          }
        }
        if (newMessages.length > 0) {
          setMessages(previous => {
            const known = new Set(previous.map(message => message.id));
            const added = newMessages.filter(message => !known.has(message.id));
            if (added.length === 0) return previous;
            return [...previous, ...added].sort((a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id));
          });
        }

        if (data.nextCursor?.after) {
          cursor = new Date(data.nextCursor.after);
          cursorId = typeof data.nextCursor.afterId === 'string' ? data.nextCursor.afterId : null;
        }
        if (data.hasMore !== true || !data.nextCursor?.after || data.items.length === 0) break;
      }
      if (!signal?.aborted && activeChannelIdRef.current === channelId) {
        setLastSync(cursor);
        setLastSyncId(cursorId);
        setHasNewerMessages(morePending);
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) console.error('Error syncing messages:', err);
    } finally {
      if (syncingRef.current === syncToken) syncingRef.current = null;
    }
  }, [currentChannel, isWindowFocused, lastSync, lastSyncId, processedMessageIds, sessionUserId, showDesktopNotification]);

  const markRead = useCallback(async (channelId: string, messageId: string | null) => {
    const controller = sendControllerRef.current;
    if (!controller || controller.signal.aborted || !sessionUserId ||
        activeSessionIdRef.current !== sessionUserId || activeChannelIdRef.current !== channelId ||
        initialLoadedChannelRef.current !== channelId) return;

    const markKey = messageId ?? '__empty__';
    if (lastSuccessfulReadRef.current.get(channelId) === markKey || readMarksInFlightRef.current.has(`${channelId}:${markKey}`)) return;
    const listEpochAtStart = channelListEpochRef.current;
    readMarksInFlightRef.current.add(`${channelId}:${markKey}`);
    const generation = (readMarkGenerationRef.current.get(channelId) ?? 0) + 1;
    readMarkGenerationRef.current.set(channelId, generation);
    try {
      const response = await fetch(`/api/chat/channels/${encodeURIComponent(channelId)}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Failed to mark chat as read');
      const data: { hasUnread?: boolean } = await response.json();
      if (controller.signal.aborted || activeSessionIdRef.current !== sessionUserId ||
          readMarkGenerationRef.current.get(channelId) !== generation) return;
      lastSuccessfulReadRef.current.set(channelId, markKey);
      // Never let a delayed false POST overwrite a newer list GET that saw a
      // fresh unread message. A stale true is conservative and can be kept.
      if (data.hasUnread !== true && listEpochAtStart !== channelListEpochRef.current) return;
      channelListEpochRef.current++;
      // A second device or a concurrent message may leave the channel unread.
      // Use the server's result rather than clearing a dot optimistically.
      setChannels(previous => previous.map(channel => channel.id === channelId
        ? { ...channel, hasUnread: data.hasUnread === true }
        : channel));
    } catch (error) {
      if (!controller.signal.aborted) console.error('Error marking chat as read:', error);
    } finally {
      readMarksInFlightRef.current.delete(`${channelId}:${markKey}`);
    }
  }, [sessionUserId]);


  useEffect(() => {
    const handleFocus = () => setIsWindowFocused(true);
    const handleBlur = () => setIsWindowFocused(false);

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  useEffect(() => {
    if (!sessionUserId) {
      // Do not retain private channel data after sign-out. This also resets the
      // polling cursor so a later session cannot query with the previous user's
      // timestamp.
      const resetTimer = setTimeout(() => {
        setChannels([]);
        setCurrentChannelState(null);
        setMessages([]);
        setLoadedChannelId(null);
        setHasNewerMessages(false);
        setLastSync(new Date(0));
        setLastSyncId(null);
        setLoading(false);
        setError(null);
        processedMessageIds.clear();
      }, 0);
      return () => clearTimeout(resetTimer);
    }

    // A channel list is more expensive than one room's message cursor poll.
    // Keep at most one request in flight, pause when hidden/offline, and let
    // failures back off instead of adding another unconditional 10s poll.
    const refreshMs = 30_000;
    const maxRetryMs = 120_000;
    let stopped = false;
    let started = false;
    let inFlight = false;
    let failures = 0;
    let nextAllowedAt = 0;
    let requestController: AbortController | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const canRefresh = () => document.visibilityState === 'visible' && navigator.onLine !== false;
    const clearRefreshTimer = () => {
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      refreshTimer = null;
    };
    const scheduleRefresh = () => {
      clearRefreshTimer();
      if (stopped || !started || inFlight || !canRefresh()) return;
      refreshTimer = setTimeout(() => { void refresh(true); }, Math.max(0, nextAllowedAt - Date.now()));
    };
    const refresh = async (background: boolean) => {
      if (stopped || inFlight || (background && !canRefresh())) return;
      started = true;
      inFlight = true;
      const controller = new AbortController();
      requestController = controller;
      try {
        const success = await fetchChannels(controller.signal, sessionUserId, background);
        if (stopped) return;
        failures = success ? 0 : Math.min(failures + 1, 3);
        const delay = success ? refreshMs : Math.min(refreshMs * 2 ** (failures - 1), maxRetryMs);
        nextAllowedAt = Date.now() + delay;
      } finally {
        inFlight = false;
        requestController = null;
        scheduleRefresh();
      }
    };
    const initialTimer = setTimeout(() => { void refresh(false); }, 0);
    const onVisibilityChange = () => {
      if (canRefresh()) scheduleRefresh();
      else clearRefreshTimer();
    };
    const onOnline = () => { failures = 0; nextAllowedAt = 0; scheduleRefresh(); };
    const onOffline = () => clearRefreshTimer();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      stopped = true;
      clearTimeout(initialTimer);
      clearRefreshTimer();
      requestController?.abort();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [fetchChannels, processedMessageIds, sessionUserId]);

  const currentChannelId = currentChannel?.id;
  useEffect(() => {
    if (!sessionUserId || !currentChannelId) return;

    const controller = new AbortController();
    const fetchTimer = setTimeout(() => {
      void fetchMessages(currentChannelId, controller.signal);
    }, 0);

    return () => {
      controller.abort();
      clearTimeout(fetchTimer);
    };
  }, [currentChannelId, fetchMessages, sessionUserId]);

  useEffect(() => {
    let syncInterval: NodeJS.Timeout;
    const controller = new AbortController();

    if (currentChannel && sessionUserId) {
      syncInterval = setInterval(async () => {
        await syncMessages(controller.signal);
      }, 10000); // 10 Sekunden Intervall
    }

    return () => {
      controller.abort();
      if (syncInterval) {
        clearInterval(syncInterval);
      }
    };
  }, [currentChannel, sessionUserId, syncMessages]);

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage &&
      lastMessage.author.id !== session?.user?.id &&
      !processedMessageIds.has(lastMessage.id)) {

      processedMessageIds.add(lastMessage.id);

      if (!isWindowFocused || currentChannel?.id !== lastMessage.channelId) {
        const notificationContent = `${lastMessage.author.name} hat in #${currentChannel?.name} geschrieben: ${lastMessage.content.length > 50
          ? lastMessage.content.substring(0, 47) + '...'
          : lastMessage.content
          }`;

        if (!isWindowFocused && browserAlertsEnabledRef.current) {
          showDesktopNotification('Neue Nachricht', notificationContent);
        }
      }
    }
  }, [currentChannel, isWindowFocused, messages, processedMessageIds, session?.user?.id, showDesktopNotification]);

  const sendMessage = async (content: string, imageFile?: File): Promise<boolean> => {
    const controller = sendControllerRef.current;
    if (!currentChannel || !session?.user || !controller || controller.signal.aborted) return false;

    const channelId = currentChannel.id;
    const tempId = `temp-${++optimisticSequenceRef.current}`;
    let imageUrl: string | undefined;

    try {
      if (imageFile) {
        const formData = new FormData();
        formData.append('file', imageFile);

        const uploadResponse = await fetch('/api/chat/upload', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });

        if (controller.signal.aborted) return false;
        if (!uploadResponse.ok) throw new Error('Failed to upload image');
        const uploadData = await uploadResponse.json();
        // Aborting fetch alone is insufficient if the response/body has already
        // completed. Never continue this old draft with a new account's cookie.
        if (controller.signal.aborted) return false;
        imageUrl = uploadData.filePath;
      }

      const optimisticMessage: ChatMessage = {
        id: tempId,
        content,
        channelId,
        author: {
          id: session.user.id,
          name: session.user.name || null,
          image: session.user.image || null,
        },
        createdAt: new Date(),
        messageType: imageUrl ? 'image' : 'text',
        imageUrl,
      };

      if (activeChannelIdRef.current === channelId) {
        setMessages(prev => [...prev, optimisticMessage]);
      }

      const response = await fetch('/api/chat/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          channelId,
          imageUrl,
          messageType: imageUrl ? 'image' : 'text',
        }),
      });

      if (controller.signal.aborted) return false;
      if (!response.ok) throw new Error('Failed to send message');

      const actualMessage = await response.json();
      if (controller.signal.aborted) return false;
      processedMessageIds.add(actualMessage.id);

      if (activeChannelIdRef.current === channelId) {
        // An own post can land after unseen messages on another device. Drain
        // the server cursor before considering that new local tail read.
        setHasNewerMessages(true);
        setMessages(prev => {
          // Polling can deliver the committed row before POST returns. Replace
          // the optimistic item without rendering the server row twice.
          const updatedMessages = prev.filter(msg => msg.id !== tempId && msg.id !== actualMessage.id);
          return [...updatedMessages, actualMessage].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id)
          );
        });
      }
      setError(null);
      return true;
    } catch (err) {
      if (controller.signal.aborted) return false;
      if (activeChannelIdRef.current === channelId) {
        setMessages(prev => prev.filter(msg => msg.id !== tempId));
      }
      const errorMessage = err instanceof Error ? err.message : 'Error sending message';
      setError(errorMessage);
      console.error(errorMessage);
      return false;
    }
  };

  const editMessage = async ({ messageId, content }: EditMessageInput) => {
    if (!session?.user) return;

    try {
      const response = await fetch(`/api/chat/messages/${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) throw new Error('Failed to edit message');

      const updatedMessage = await response.json();
      setMessages(prev =>
        prev.map(msg => msg.id === messageId ? updatedMessage : msg)
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error editing message';
      setError(errorMessage);
      console.error(errorMessage);
    }
  };

  const createChannel = async ({ name, isPrivate }: CreateChannelInput) => {
    try {
      const response = await fetch('/api/chat/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, isPrivate }),
      });

      if (!response.ok) throw new Error('Failed to create channel');

      const newChannel = await response.json();
      channelListEpochRef.current++;
      setChannels(prev => [...prev, newChannel]);
      setActiveChannel(newChannel);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error creating channel';
      setError(errorMessage);
      console.error(errorMessage);
    }
  };

  const deleteChannel = async (channelId: string) => {
    try {
      const response = await fetch(`/api/chat/channels/${channelId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete channel');

      channelListEpochRef.current++;
      setChannels(prev => prev.filter(channel => channel.id !== channelId));

      if (currentChannel?.id === channelId) {
        const remainingChannels = channels.filter(channel => channel.id !== channelId);
        if (remainingChannels.length > 0) {
          setActiveChannel(remainingChannels[0]);
        } else {
          setCurrentChannelState(null);
          setMessages([]);
          setLoadedChannelId(null);
          setHasNewerMessages(false);
          setLastSync(new Date(0));
          setLastSyncId(null);
        }
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error deleting channel';
      setError(errorMessage);
      console.error(errorMessage);
    }
  };

  return (
    <ChatContext.Provider
      value={{
        // Hide private state immediately while the asynchronous logout reset
        // drains pending requests and clears the in-memory cache.
        channels: session?.user ? channels : [],
        currentChannel: session?.user ? currentChannel : null,
        messages: session?.user ? messages : [],
        hasOlderMessages: session?.user ? hasOlderMessages : false,
        loadingOlderMessages: session?.user ? loadingOlderMessages : false,
        loadedChannelId: session?.user ? loadedChannelId : null,
        hasNewerMessages: session?.user ? hasNewerMessages : false,
        loadOlderMessages,
        markRead,
        setCurrentChannel: setActiveChannel,
        sendMessage,
        editMessage,
        createChannel,
        deleteChannel,
        loading,
        error,
        clearError: () => setError(null),
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
