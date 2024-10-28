// types/chat.ts
export interface ChatMessage {
    id: string;
    content: string;
    channelId: string;
    author: {
      id: string;
      name: string | null;
      image: string | null;
    };
    createdAt: Date;
    updatedAt?: Date;
    isEdited?: boolean;
    imageUrl?: string;
    messageType: 'text' | 'image';
  }
  
  export interface ChatChannel {
    id: string;
    name: string;
    isPrivate: boolean;
    _count: {
      messages: number;
      members: number;
    };
    members: ChatMember[];
  }
  
  export interface ChatMember {
    id: string;
    user: {
      id: string;
      name: string | null;
      image: string | null;
      role: string;
    };
  }
  
  export interface CreateChannelInput {
    name: string;
    isPrivate: boolean;
  }
  
  export interface EditMessageInput {
    messageId: string;
    content: string;
  }
  
  export interface SendMessageInput {
    content: string;
    channelId: string;
    imageUrl?: string;
    messageType: 'text' | 'image';
  }