import 'server-only';

import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getDatabaseProvider, getPostgresqlSchema } from '@/lib/database-provider';

function table(name: 'ChatReadCursor' | 'ChatChannel' | 'ChatMember' | 'ChatMessage') {
  // PrismaPg applies ?schema= to ORM queries but not to unqualified raw SQL.
  // Names are fixed here; quote and escape the validated URL schema.
  const schema = getDatabaseProvider() === 'postgresql' ? getPostgresqlSchema() : null;
  return Prisma.raw(`${schema ? `"${schema.replaceAll('"', '""')}".` : ''}"${name}"`);
}

/**
 * One indexed, account-scoped query regardless of the number of channels.
 * The channel list is broader for admins than the messages API, so enforce
 * message readability again here instead of trusting list visibility.
 * Missing cursor rows mean "not yet visited", not historical unread.
 */
export async function getUnreadChannelIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ channelId: string }[]>(Prisma.sql`
    SELECT read_cursor."channelId"
    FROM ${table('ChatReadCursor')} AS read_cursor
    JOIN ${table('ChatChannel')} AS chat_channel ON chat_channel."id" = read_cursor."channelId"
    WHERE read_cursor."userId" = ${userId}
      AND (
        chat_channel."isPrivate" = false
        OR EXISTS (
          SELECT 1 FROM ${table('ChatMember')} AS chat_member
          WHERE chat_member."channelId" = chat_channel."id" AND chat_member."userId" = ${userId}
        )
      )
      AND (
        (read_cursor."lastReadCreatedAt" IS NULL AND EXISTS (
          SELECT 1 FROM ${table('ChatMessage')} AS chat_message
          WHERE chat_message."channelId" = read_cursor."channelId"
            AND chat_message."authorId" <> ${userId}
        ))
        OR EXISTS (
          SELECT 1 FROM ${table('ChatMessage')} AS chat_message
          WHERE chat_message."channelId" = read_cursor."channelId"
            AND chat_message."createdAt" > read_cursor."lastReadCreatedAt"
            AND chat_message."authorId" <> ${userId}
        )
        OR EXISTS (
          SELECT 1 FROM ${table('ChatMessage')} AS chat_message
          WHERE chat_message."channelId" = read_cursor."channelId"
            AND chat_message."createdAt" = read_cursor."lastReadCreatedAt"
            AND chat_message."id" > read_cursor."lastReadId"
            AND chat_message."authorId" <> ${userId}
        )
      )`);
  return new Set(rows.map(row => row.channelId));
}

/** Advances one durable position without allowing an older device to regress it. */
export async function advanceChatReadCursor(
  userId: string,
  channelId: string,
  position: { id: string; createdAt: Date } | null,
): Promise<void> {
  if (!position) {
    try {
      await prisma.chatReadCursor.create({ data: { userId, channelId } });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
    }
    return;
  }

  const advanceExisting = () => prisma.chatReadCursor.updateMany({
    where: {
      userId,
      channelId,
      OR: [
        { lastReadCreatedAt: null },
        { lastReadCreatedAt: { lt: position.createdAt } },
        { lastReadCreatedAt: position.createdAt, lastReadId: { lt: position.id } },
      ],
    },
    data: { lastReadCreatedAt: position.createdAt, lastReadId: position.id },
  });

  if ((await advanceExisting()).count) return;
  try {
    await prisma.chatReadCursor.create({
      data: { userId, channelId, lastReadCreatedAt: position.createdAt, lastReadId: position.id },
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    // The other device inserted after our failed update. Conditional retry
    // preserves the greater position whichever request reached SQL first.
    await advanceExisting();
  }
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
