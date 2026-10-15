// contexts/ChatContext.tsx
'use client'

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, ReactNode } from 'react';
import type { Session } from 'next-auth';
import { useSession } from 'next-auth/react';
import { ChatMessage, ChatChannel, CreateChannelInput, EditMessageInput } from '@/types/chat';
import { BROWSER_CHAT_ALERT_PREFERENCE_EVENT, type BrowserChatAlertPreference } from '@/lib/browser-chat-alerts';

interface ChatContextType {
  channels: ChatChannel[];
  currentChannel: ChatChannel | null;
  messages: ChatMessage[];
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  loadOlderMessages: () => Promise<void>;
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
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [currentChannel, setCurrentChannelState] = useState<ChatChannel | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
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

  const fetchChannels = useCallback(async (signal?: AbortSignal, sessionUserId?: string) => {
    try {
      setLoading(true);
      const response = await fetch('/api/chat/channels', { signal });
      if (!response.ok) throw new Error('Failed to fetch channels');
      const data = await response.json();
      if (signal?.aborted || (sessionUserId && activeSessionIdRef.current !== sessionUserId)) return;
      setChannels(data);
      if (data.length > 0) {
        setCurrentChannelState(previousChannel => previousChannel ?? data[0]);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const errorMessage = err instanceof Error ? err.message : 'Error fetching channels';
      setError(errorMessage);
      console.error(errorMessage);
    } finally {
      if (!sessionUserId || activeSessionIdRef.current === sessionUserId) {
        setLoading(false);
      }
    }
  }, []);

  const fetchMessages = useCallback(async (channelId: string, signal?: AbortSignal) => {
    try {
      initialLoadedChannelRef.current = null;
      setLoading(true);
      const response = await fetch(
        `/api/chat/messages?channelId=${encodeURIComponent(channelId)}&latest=true&limit=50`,
        { signal },
      );
      if (response.status === 403 && activeChannelIdRef.current === channelId) {
        activeChannelIdRef.current = null;
        initialLoadedChannelRef.current = null;
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
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      // Füge alle initial geladenen Nachrichten zum Set hinzu
      sortedMessages.forEach((msg: ChatMessage) => processedMessageIds.add(msg.id));

      setMessages(sortedMessages);
      setHasOlderMessages(data.hasMore === true);
      initialLoadedChannelRef.current = channelId;
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
    const syncToken = Symbol('chat-sync');
    syncingRef.current = syncToken;

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
          setMessages([]);
          setHasOlderMessages(false);
          setChannels(previous => previous.filter(channel => channel.id !== channelId));
          setCurrentChannelState(null);
        }
        if (!response.ok) throw new Error('Failed to sync messages');
        const data = await response.json();
        if (signal?.aborted || activeChannelIdRef.current !== channelId || activeSessionIdRef.current !== sessionUserId) return;

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
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) console.error('Error syncing messages:', err);
    } finally {
      if (syncingRef.current === syncToken) syncingRef.current = null;
    }
  }, [currentChannel, isWindowFocused, lastSync, lastSyncId, processedMessageIds, sessionUserId, showDesktopNotification]);


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
    const controller = new AbortController();
    let fetchTimer: ReturnType<typeof setTimeout> | undefined;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;

    if (sessionUserId) {
      fetchTimer = setTimeout(() => {
        void fetchChannels(controller.signal, sessionUserId);
      }, 0);
    } else {
      // Do not retain private channel data after sign-out. This also resets the
      // polling cursor so a later session cannot query with the previous user's
      // timestamp.
      resetTimer = setTimeout(() => {
        setChannels([]);
        setCurrentChannelState(null);
        setMessages([]);
        setLastSync(new Date(0));
        setLastSyncId(null);
        setLoading(false);
        setError(null);
        processedMessageIds.clear();
      }, 0);
    }

    return () => {
      controller.abort();
      if (fetchTimer) clearTimeout(fetchTimer);
      if (resetTimer) clearTimeout(resetTimer);
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
        setMessages(prev => {
          // Polling can deliver the committed row before POST returns. Replace
          // the optimistic item without rendering the server row twice.
          const updatedMessages = prev.filter(msg => msg.id !== tempId && msg.id !== actualMessage.id);
          return [...updatedMessages, actualMessage].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
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

      setChannels(prev => prev.filter(channel => channel.id !== channelId));

      if (currentChannel?.id === channelId) {
        const remainingChannels = channels.filter(channel => channel.id !== channelId);
        if (remainingChannels.length > 0) {
          setActiveChannel(remainingChannels[0]);
        } else {
          setCurrentChannelState(null);
          setMessages([]);
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
        loadOlderMessages,
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
