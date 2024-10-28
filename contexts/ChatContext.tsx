// contexts/ChatContext.tsx
'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { useNotifications } from './NotificationContext';
import { ChatMessage, ChatChannel, CreateChannelInput, EditMessageInput } from '@/types/chat';
import { NotificationType } from '@prisma/client';

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
  const [currentChannel, setCurrentChannel] = useState<ChatChannel | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date>(new Date());
  const [isWindowFocused, setIsWindowFocused] = useState(true);
  const [processedMessageIds] = useState<Set<string>>(new Set());

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
    if (session?.user) {
      fetchChannels();
    }
  }, [session]);

  useEffect(() => {
    if (currentChannel) {
      fetchMessages(currentChannel.id);
    }
  }, [currentChannel]);

  useEffect(() => {
    let syncInterval: NodeJS.Timeout;
    
    if (currentChannel) {
      syncInterval = setInterval(async () => {
        await syncMessages();
      }, 10000); // 10 Sekunden Intervall
    }

    return () => {
      if (syncInterval) {
        clearInterval(syncInterval);
      }
    };
  }, [currentChannel, lastSync]);

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && 
        lastMessage.author.id !== session?.user?.id && 
        !processedMessageIds.has(lastMessage.id)) {
      
      processedMessageIds.add(lastMessage.id);

      if (!isWindowFocused || currentChannel?.id !== lastMessage.channelId) {
        const notificationContent = `${lastMessage.author.name} hat in #${currentChannel?.name} geschrieben: ${
          lastMessage.content.length > 50 
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
  }, [messages, session?.user?.id, currentChannel, isWindowFocused]);

  const fetchChannels = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/chat/channels');
      if (!response.ok) throw new Error('Failed to fetch channels');
      const data = await response.json();
      setChannels(data);
      if (data.length > 0 && !currentChannel) {
        setCurrentChannel(data[0]);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error fetching channels';
      setError(errorMessage);
      console.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (channelId: string) => {
    try {
      setLoading(true);
      const response = await fetch(`/api/chat/messages?channelId=${channelId}`);
      if (!response.ok) throw new Error('Failed to fetch messages');
      const data = await response.json();
      
      const sortedMessages = data.items.sort(
        (a: ChatMessage, b: ChatMessage) => 
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      
      // Füge alle initial geladenen Nachrichten zum Set hinzu
      sortedMessages.forEach(msg => processedMessageIds.add(msg.id));
      
      setMessages(sortedMessages);
      setLastSync(new Date());
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error fetching messages';
      setError(errorMessage);
      console.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const syncMessages = async () => {
    if (!currentChannel || !session?.user) return;

    try {
      const response = await fetch(
        `/api/chat/messages?channelId=${currentChannel.id}&after=${lastSync.toISOString()}`
      );
      if (!response.ok) throw new Error('Failed to sync messages');
      const data = await response.json();
      
      if (data.items.length > 0) {
        setMessages(prev => {
          const allMessages = [...prev];
          let hasNewMessages = false;
          
          data.items.forEach((newMsg: ChatMessage) => {
            // Prüfe, ob die Nachricht wirklich neu ist
            if (!processedMessageIds.has(newMsg.id)) {
              processedMessageIds.add(newMsg.id);
              hasNewMessages = true;
              
              if (newMsg.author.id !== session.user.id) {
                const notificationContent = `${newMsg.author.name} hat in #${currentChannel.name} geschrieben: ${
                  newMsg.content.length > 50 
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
              }
              allMessages.push(newMsg);
            }
          });
          
          if (hasNewMessages) {
            return allMessages.sort(
              (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            );
          }
          
          return prev;
        });
        
        setLastSync(new Date());
      }
    } catch (err) {
      console.error('Error syncing messages:', err);
    }
  };

  const sendMessage = async (content: string, imageFile?: File) => {
    if (!currentChannel || !session?.user) return;

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
        channelId: currentChannel.id,
        author: {
          id: session.user.id,
          name: session.user.name,
          image: session.user.image,
        },
        createdAt: new Date(),
        messageType: imageUrl ? 'image' : 'text',
        imageUrl,
      };

      setMessages(prev => [...prev, optimisticMessage]);

      const response = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          channelId: currentChannel.id,
          imageUrl,
          messageType: imageUrl ? 'image' : 'text',
        }),
      });

      if (!response.ok) throw new Error('Failed to send message');
      
      const actualMessage = await response.json();
      processedMessageIds.add(actualMessage.id);

      setMessages(prev => {
        const updatedMessages = prev.filter(msg => msg.id !== tempId);
        return [...updatedMessages, actualMessage].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      });
    } catch (err) {
      setMessages(prev => prev.filter(msg => msg.id !== tempId));
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
      setCurrentChannel(newChannel);

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
        setCurrentChannel(remainingChannels.length > 0 ? remainingChannels[0] : null);
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
        channels,
        currentChannel,
        messages,
        setCurrentChannel,
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