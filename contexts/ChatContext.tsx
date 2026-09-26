// contexts/ChatContext.tsx
'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { useNotifications } from './NotificationContext';
import { ChatMessage, ChatChannel, CreateChannelInput, EditMessageInput } from '@/types/chat';
import { NotificationType } from '@/types/notifications';

interface ChatContextType {
  channels: ChatChannel[];
  currentChannel: ChatChannel | null;
  messages: ChatMessage[];
  setCurrentChannel: (channel: ChatChannel) => void;
  sendMessage: (content: string, imageFile?: File) => Promise<void>;
  editMessage: (input: EditMessageInput) => Promise<void>;
  createChannel: (input: CreateChannelInput) => Promise<void>;
  deleteChannel: (channelId: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

const playNotificationSound = () => {
  try {
    const audio = new Audio('/sounds/notification.mp3');
    audio.volume = 0.5;
    audio.play().catch(err => console.error('Failed to play notification sound:', err));
  } catch (error) {
    console.error('Error playing notification sound:', error);
  }
};

const showDesktopNotification = (title: string, body: string) => {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body,
        icon: '/images/notification-icon.png',
      });
    } catch (error) {
      console.error('Error showing desktop notification:', error);
    }
  }
};

const extractMentions = (content: string): string[] => {
  const mentionRegex = /@(\w+)/g;
  const matches = content.match(mentionRegex);
  return matches ? matches.map(match => match.substring(1)) : [];
};

export function ChatProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const { addNotification } = useNotifications();
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [currentChannel, setCurrentChannelState] = useState<ChatChannel | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date>(new Date());
  const [lastSyncId, setLastSyncId] = useState<string | null>(null);
  const [isWindowFocused, setIsWindowFocused] = useState(true);
  const [processedMessageIds] = useState<Set<string>>(new Set());
  const activeChannelIdRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);

  const setActiveChannel = useCallback((channel: ChatChannel) => {
    setMessages([]);
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
      setLoading(true);
      const response = await fetch(
        `/api/chat/messages?channelId=${encodeURIComponent(channelId)}&latest=true&limit=50`,
        { signal },
      );
      if (response.status === 403 && activeChannelIdRef.current === channelId) {
        setMessages([]);
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

  const syncMessages = useCallback(async (signal?: AbortSignal) => {
    if (!currentChannel || !session?.user) return;

    const channelId = currentChannel.id;

    try {
      const response = await fetch(
        `/api/chat/messages?channelId=${encodeURIComponent(channelId)}&after=${encodeURIComponent(lastSync.toISOString())}${lastSyncId ? `&afterId=${encodeURIComponent(lastSyncId)}` : ''}`,
        { signal },
      );
      if (response.status === 403 && activeChannelIdRef.current === channelId) {
        setMessages([]);
        setChannels(previous => previous.filter(channel => channel.id !== channelId));
        setCurrentChannelState(null);
      }
      if (!response.ok) throw new Error('Failed to sync messages');
      const data = await response.json();

      if (signal?.aborted || activeChannelIdRef.current !== channelId || activeSessionIdRef.current !== session.user.id) return;

      const newMessages = data.items.filter((newMsg: ChatMessage) => !processedMessageIds.has(newMsg.id));

      // Keep all Set mutations and notifications outside the state updater.
      // React may invoke an updater more than once in development.
      newMessages.forEach((newMsg: ChatMessage) => processedMessageIds.add(newMsg.id));

      newMessages.forEach((newMsg: ChatMessage) => {
        if (newMsg.author.id === session.user.id) return;

        const notificationContent = `${newMsg.author.name} hat in #${currentChannel.name} geschrieben: ${newMsg.content.length > 50
          ? newMsg.content.substring(0, 47) + '...'
          : newMsg.content
          }`;

        addNotification({
          type: 'CHAT_MESSAGE' as NotificationType,
          content: notificationContent,
          isRead: false
        });

        const mentions = extractMentions(newMsg.content);
        if (mentions.includes(session.user.name || '')) {
          addNotification({
            type: 'MENTION' as NotificationType,
            content: `${newMsg.author.name} hat Sie in #${currentChannel.name} erwähnt`,
            isRead: false
          });
        }

        if (!isWindowFocused) {
          playNotificationSound();
          showDesktopNotification('Neue Nachricht', notificationContent);
        }
      });

      if (newMessages.length > 0) {
        setMessages(prev => {
          const allMessages = [...prev];
          let hasNewMessages = false;

          newMessages.forEach((newMsg: ChatMessage) => {
            // Prüfe, ob die Nachricht wirklich neu ist
            if (allMessages.some(message => message.id === newMsg.id)) return;
            hasNewMessages = true;
            allMessages.push(newMsg);
          });

          if (hasNewMessages) {
            return allMessages.sort(
              (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            );
          }

          return prev;
        });

      }

      // The API returns a composite cursor because multiple messages can have
      // the same timestamp. Keep both parts so polling cannot skip a message.
      if (data.nextCursor?.after) {
        setLastSync(new Date(data.nextCursor.after));
        setLastSyncId(
          typeof data.nextCursor.afterId === 'string' ? data.nextCursor.afterId : null,
        );
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) console.error('Error syncing messages:', err);
    }
  }, [addNotification, currentChannel, isWindowFocused, lastSync, lastSyncId, processedMessageIds, session]);


  useEffect(() => {
    if ('Notification' in window) {
      Notification.requestPermission();
    }

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

    if (session?.user) {
      fetchTimer = setTimeout(() => {
        void fetchChannels(controller.signal, session.user.id);
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
  }, [fetchChannels, processedMessageIds, session]);

  useEffect(() => {
    if (!session?.user || !currentChannel) return;

    const controller = new AbortController();
    const fetchTimer = setTimeout(() => {
      void fetchMessages(currentChannel.id, controller.signal);
    }, 0);

    return () => {
      controller.abort();
      clearTimeout(fetchTimer);
    };
  }, [currentChannel, fetchMessages, session?.user, session?.user?.id]);

  useEffect(() => {
    let syncInterval: NodeJS.Timeout;
    const controller = new AbortController();

    if (currentChannel && session?.user) {
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
  }, [currentChannel, session?.user, session?.user?.id, syncMessages]);

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

        addNotification({
          type: 'CHAT_MESSAGE' as NotificationType,
          content: notificationContent,
          isRead: false
        });

        const mentions = extractMentions(lastMessage.content);
        if (mentions.includes(session?.user?.name || '')) {
          addNotification({
            type: 'MENTION' as NotificationType,
            content: `${lastMessage.author.name} hat Sie in #${currentChannel?.name} erwähnt`,
            isRead: false
          });
        }

        if (!isWindowFocused) {
          playNotificationSound();
          showDesktopNotification('Neue Nachricht', notificationContent);
        }
      }
    }
  }, [addNotification, currentChannel, isWindowFocused, messages, processedMessageIds, session?.user?.id, session?.user?.name]);

  const sendMessage = async (content: string, imageFile?: File) => {
    if (!currentChannel || !session?.user) return;

    const channelId = currentChannel.id;
    const tempId = `temp-${Date.now()}`;
    let imageUrl: string | undefined;

    try {
      if (imageFile) {
        const formData = new FormData();
        formData.append('file', imageFile);

        const uploadResponse = await fetch('/api/chat/upload', {
          method: 'POST',
          body: formData,
        });

        if (!uploadResponse.ok) throw new Error('Failed to upload image');
        const uploadData = await uploadResponse.json();
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          channelId,
          imageUrl,
          messageType: imageUrl ? 'image' : 'text',
        }),
      });

      if (!response.ok) throw new Error('Failed to send message');

      const actualMessage = await response.json();
      processedMessageIds.add(actualMessage.id);

      if (activeChannelIdRef.current === channelId) {
        setMessages(prev => {
          const updatedMessages = prev.filter(msg => msg.id !== tempId);
          return [...updatedMessages, actualMessage].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
        });
      }
    } catch (err) {
      if (activeChannelIdRef.current === channelId) {
        setMessages(prev => prev.filter(msg => msg.id !== tempId));
      }
      const errorMessage = err instanceof Error ? err.message : 'Error sending message';
      setError(errorMessage);
      console.error(errorMessage);
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

      addNotification({
        type: 'SYSTEM' as NotificationType,
        content: `Neuer Channel #${name} wurde erstellt`,
        isRead: false
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error creating channel';
      setError(errorMessage);
      console.error(errorMessage);
    }
  };

  const deleteChannel = async (channelId: string) => {
    try {
      const channelToDelete = channels.find(c => c.id === channelId);

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

      if (channelToDelete) {
        addNotification({
          type: 'SYSTEM' as NotificationType,
          content: `Channel #${channelToDelete.name} wurde gelöscht`,
          isRead: false
        });
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
        setCurrentChannel: setActiveChannel,
        sendMessage,
        editMessage,
        createChannel,
        deleteChannel,
        loading,
        error,
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
