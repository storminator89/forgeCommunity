// contexts/ChatContext.tsx
'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { ChatMessage, ChatChannel, CreateChannelInput, EditMessageInput } from '@/types/chat';

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

export function ChatProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [currentChannel, setCurrentChannel] = useState<ChatChannel | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date>(new Date());

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
      }, 5000);
    }

    return () => {
      if (syncInterval) {
        clearInterval(syncInterval);
      }
    };
  }, [currentChannel, lastSync]);

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
          
          data.items.forEach((newMsg: ChatMessage) => {
            const existingIndex = allMessages.findIndex(msg => msg.id === newMsg.id);
            if (existingIndex === -1) {
              allMessages.push(newMsg);
            }
          });
          
          return allMessages.sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
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
      // Wenn ein Bild vorhanden ist, zuerst das Bild hochladen
      if (imageFile) {
        const formData = new FormData();
        formData.append('file', imageFile);
    
        const uploadResponse = await fetch('/api/chat/upload', {  // Hier geändert
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
        setCurrentChannel(remainingChannels.length > 0 ? remainingChannels[0] : null);
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