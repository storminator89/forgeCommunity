// types/notifications.ts
export type NotificationType = 
  | 'CHAT_MESSAGE' 
  | 'CHANNEL_CREATED' 
  | 'CHANNEL_DELETED' 
  | 'CHANNEL_INVITATION'
  | 'MENTION'
  | 'SYSTEM';

export interface NotificationMetadata {
  channelId?: string;
  messageId?: string;
  userId?: string;
  channelName?: string;
  messagePreview?: string;
}

export interface NotificationTemplate {
  CHAT_MESSAGE: {
    content: string;
    metadata: {
      channelId: string;
      messageId: string;
      channelName: string;
      messagePreview: string;
    };
  };
  CHANNEL_CREATED: {
    content: string;
    metadata: {
      channelId: string;
      channelName: string;
    };
  };
  CHANNEL_INVITATION: {
    content: string;
    metadata: {
      channelId: string;
      channelName: string;
      inviterId: string;
    };
  };
  MENTION: {
    content: string;
    metadata: {
      channelId: string;
      messageId: string;
      mentionedBy: string;
    };
  };
}