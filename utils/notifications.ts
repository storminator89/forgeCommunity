// utils/notifications.ts
import { NotificationType, NotificationTemplate } from '@/types/notifications';

export function createNotificationContent<T extends NotificationType>(
  type: T,
  data: NotificationTemplate[T]
): string {
  switch (type) {
    case 'CHAT_MESSAGE': {
      const chatData = data as NotificationTemplate['CHAT_MESSAGE'];
      return `Neue Nachricht von ${chatData.metadata.authorName || 'unbekannt'} in #${chatData.metadata.channelName}${chatData.metadata.messagePreview ? `: ${chatData.metadata.messagePreview}` : ''
        }`;
    }

    case 'CHANNEL_CREATED': {
      const channelData = data as NotificationTemplate['CHANNEL_CREATED'];
      return `Neuer Channel #${channelData.metadata.channelName} wurde erstellt`;
    }

    case 'CHANNEL_INVITATION': {
      const inviteData = data as NotificationTemplate['CHANNEL_INVITATION'];
      return `Sie wurden von ${inviteData.metadata.inviterName || 'einem Benutzer'} in den Channel #${inviteData.metadata.channelName} eingeladen`;
    }

    case 'MENTION': {
      const mentionData = data as NotificationTemplate['MENTION'];
      return `${mentionData.metadata.mentionedBy} hat Sie in #${mentionData.metadata.channelName || 'einem Channel'} erwähnt`;
    }

    default:
      return (data as any).content || 'Neue Benachrichtigung';
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