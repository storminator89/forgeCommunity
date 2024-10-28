// utils/notifications.ts
import { NotificationType, NotificationTemplate } from '@/types/notifications';

export function createNotificationContent(
  type: NotificationType,
  data: NotificationTemplate[typeof type]
): string {
  switch (type) {
    case 'CHAT_MESSAGE':
      return `Neue Nachricht von ${data.metadata.authorName} in #${data.metadata.channelName}${
        data.metadata.messagePreview ? `: ${data.metadata.messagePreview}` : ''
      }`;
    
    case 'CHANNEL_CREATED':
      return `Neuer Channel #${data.metadata.channelName} wurde erstellt`;
    
    case 'CHANNEL_INVITATION':
      return `Sie wurden von ${data.metadata.inviterName} in den Channel #${data.metadata.channelName} eingeladen`;
    
    case 'MENTION':
      return `${data.metadata.mentionedBy} hat Sie in #${data.metadata.channelName} erwähnt`;
    
    default:
      return data.content;
  }
}

export function getNotificationIcon(type: NotificationType) {
  switch (type) {
    case 'CHAT_MESSAGE':
      return 'message-square';
    case 'CHANNEL_CREATED':
      return 'plus-circle';
    case 'CHANNEL_INVITATION':
      return 'user-plus';
    case 'MENTION':
      return 'at-sign';
    default:
      return 'bell';
  }
}

export function getNotificationPriority(type: NotificationType): 'low' | 'medium' | 'high' {
  switch (type) {
    case 'MENTION':
      return 'high';
    case 'CHAT_MESSAGE':
      return 'medium';
    default:
      return 'low';
  }
}