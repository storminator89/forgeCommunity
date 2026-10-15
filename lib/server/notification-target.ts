import 'server-only';

import type { Notification } from '@prisma/client';
import prisma from '@/lib/prisma';

// This is deliberately an allowlist of domain objects, not a stored URL. A
// target can be deleted or become private after its notification was created.
export type NotificationAction = { href: string; label: string };
type Target = Pick<Notification, 'type' | 'targetType' | 'targetId'>;
const safeId = (id: string): boolean => /^[A-Za-z0-9_-]{1,100}$/.test(id);

export async function resolveNotificationTarget(target: Target, viewerId: string): Promise<NotificationAction | null> {
  const { type, targetType, targetId } = target;
  if (!targetType || !targetId || !safeId(targetId)) return null;

  if (type === 'FOLLOW' && targetType === 'USER') {
    const user = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
    return user ? { href: `/profile/${encodeURIComponent(user.id)}`, label: 'Profil ansehen' } : null;
  }
  if (type === 'COMMENT' && targetType === 'COMMENT') {
    const comment = await prisma.comment.findFirst({
      where: { id: targetId, post: { OR: [{ published: true }, { authorId: viewerId }] } },
      select: { id: true },
    });
    return comment ? { href: `/community#comment-${encodeURIComponent(comment.id)}`, label: 'Kommentar ansehen' } : null;
  }
  if ((type === 'CHAT_MESSAGE' || type === 'MENTION') && targetType === 'CHAT_MESSAGE') {
    const message = await prisma.chatMessage.findFirst({
      where: { id: targetId, channel: { OR: [
        { isPrivate: false },
        { members: { some: { userId: viewerId } } },
      ] } },
      select: { id: true, channelId: true },
    });
    return message ? {
      href: `/chat?channelId=${encodeURIComponent(message.channelId)}&messageId=${encodeURIComponent(message.id)}`,
      label: 'Nachricht ansehen',
    } : null;
  }
  return null;
}

/** Resolve one inbox page in at most three visibility-filtered queries. */
export async function resolveNotificationTargets(targets: Target[], viewerId: string): Promise<Array<NotificationAction | null>> {
  const userIds = [...new Set(targets.filter(target => target.type === 'FOLLOW' && target.targetType === 'USER' && target.targetId && safeId(target.targetId)).map(target => target.targetId!))];
  const commentIds = [...new Set(targets.filter(target => target.type === 'COMMENT' && target.targetType === 'COMMENT' && target.targetId && safeId(target.targetId)).map(target => target.targetId!))];
  const messageIds = [...new Set(targets.filter(target => (target.type === 'CHAT_MESSAGE' || target.type === 'MENTION') && target.targetType === 'CHAT_MESSAGE' && target.targetId && safeId(target.targetId)).map(target => target.targetId!))];

  const [users, comments, messages] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true } }) : [],
    commentIds.length ? prisma.comment.findMany({
      where: { id: { in: commentIds }, post: { OR: [{ published: true }, { authorId: viewerId }] } },
      select: { id: true },
    }) : [],
    messageIds.length ? prisma.chatMessage.findMany({
      where: { id: { in: messageIds }, channel: { OR: [
        { isPrivate: false }, { members: { some: { userId: viewerId } } },
      ] } },
      select: { id: true, channelId: true },
    }) : [],
  ]);
  const visibleUsers = new Set(users.map(user => user.id));
  const visibleComments = new Set(comments.map(comment => comment.id));
  const visibleMessages = new Map(messages.map(message => [message.id, message.channelId]));
  return targets.map(({ type, targetType, targetId }) => {
    if (!targetId || !safeId(targetId)) return null;
    if (type === 'FOLLOW' && targetType === 'USER' && visibleUsers.has(targetId)) {
      return { href: `/profile/${encodeURIComponent(targetId)}`, label: 'Profil ansehen' };
    }
    if (type === 'COMMENT' && targetType === 'COMMENT' && visibleComments.has(targetId)) {
      return { href: `/community#comment-${encodeURIComponent(targetId)}`, label: 'Kommentar ansehen' };
    }
    const channelId = visibleMessages.get(targetId);
    if ((type === 'CHAT_MESSAGE' || type === 'MENTION') && targetType === 'CHAT_MESSAGE' && channelId) {
      return { href: `/chat?channelId=${encodeURIComponent(channelId)}&messageId=${encodeURIComponent(targetId)}`, label: 'Nachricht ansehen' };
    }
    return null;
  });
}

export function notificationTargetState(target: Target, action: NotificationAction | null) {
  if (!target.targetType && !target.targetId) return 'none' as const;
  return action ? 'available' as const : 'unavailable' as const;
}
