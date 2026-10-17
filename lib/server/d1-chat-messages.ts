import 'server-only';

import { env } from 'cloudflare:workers';
import type { Prisma } from '@/generated/prisma/client';

type CreatedMessage = Prisma.ChatMessageGetPayload<{
  include: { author: { select: { id: true; name: true; image: true } } };
}>;
type MessageRow = {
  id: string; content: string; channelId: string; authorId: string;
  createdAt: string; updatedAt: string; imageUrl: string | null; messageType: string;
  authorName: string | null; authorImage: string | null;
};

const assertion = (predicate: string) => `CASE WHEN COALESCE((${predicate}), 0) THEN 1
  ELSE json_extract('{}', '$[CHAT_MESSAGE_ASSERT]') END`;
const authorAndChannelValid = `typeof(a.id) = 'text' AND length(a.id) > 0
  AND length(CAST(a.id AS BLOB)) <= 1024
  AND (a.name IS NULL OR typeof(a.name) = 'text')
  AND (a.image IS NULL OR typeof(a.image) = 'text')
  AND typeof(c.name) = 'text'
  AND length(CAST(json_quote(a.name) AS BLOB)) <= 262144
  AND length(CAST(json_quote(a.image) AS BLOB)) <= 262144
  AND length(CAST(json_quote(c.name) AS BLOB)) <= 65536`;

/** Native D1 batch: message, complete explicit-member notice fan-out, and the
 * response share one atomic primary snapshot. There is no stored unread
 * counter: unread is derived from these messages and each monotonic read cursor.
 * No automatic retry/idempotency change is introduced by this port. */
export async function createD1ChatMessage(input: {
  authorId: string; channelId: string; content: string;
  imageUrl: string | null; messageType: 'text' | 'image';
}): Promise<CreatedMessage> {
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is unavailable.');
  const db = env.DB.withSession('first-primary');
  const id = crypto.randomUUID();
  // Match PrismaD1, including its UTC suffix, for existing lexical unread and
  // history comparisons. Both values are identical to the known valid instant.
  const createdAt = new Date();
  const timestamp = createdAt.toISOString().replace('Z', '+00:00');
  const results = await db.batch<MessageRow>([
    // Validate projection/fan-out dependencies BEFORE any write. The quoted
    // byte budgets include JSON escaping and keep typed result rows below 2MB.
    // They fail closed, never truncate an author or silently drop recipients.
    db.prepare(`SELECT ${assertion(`EXISTS (
      SELECT 1 FROM ChatChannel c JOIN User a ON a.id = ?1 WHERE c.id = ?2
        AND (c.isPrivate = 0 OR EXISTS (
          SELECT 1 FROM ChatMember own WHERE own.channelId = c.id AND own.userId = a.id))
        AND ${authorAndChannelValid})`)} AS ok`).bind(input.authorId, input.channelId),
    // Authority is part of the consuming INSERT too. ADMIN deliberately has no
    // bypass for an unjoined private channel, matching the existing API.
    db.prepare(`INSERT INTO ChatMessage
      (id, content, channelId, authorId, createdAt, updatedAt, imageUrl, messageType)
      SELECT ?1, ?2, c.id, a.id, ?3, ?3, ?6, ?7
      FROM ChatChannel c JOIN User a ON a.id = ?4 WHERE c.id = ?5
        AND (c.isPrivate = 0 OR EXISTS (
          SELECT 1 FROM ChatMember own WHERE own.channelId = c.id AND own.userId = a.id))`)
      .bind(id, input.content, timestamp, input.authorId, input.channelId, input.imageUrl, input.messageType),
    db.prepare(`SELECT ${assertion('changes() = 1')} AS ok`),
    // Gate every notice on this operation's fresh inserted message. Public
    // visitors are not the durable audience, and the sender never gets one.
    // This is set-based and deliberately includes ALL explicit other members.
    db.prepare(`INSERT INTO Notification
      (id, userId, type, content, targetType, targetId, isRead, createdAt)
      SELECT lower(hex(randomblob(16))), member.userId, 'CHAT_MESSAGE',
        COALESCE(NULLIF(a.name, ''), 'Ein Mitglied') || ' hat in #' || c.name || ' geschrieben.',
        'CHAT_MESSAGE', m.id, 0, m.createdAt
      FROM ChatMessage m JOIN ChatChannel c ON c.id = m.channelId
      JOIN User a ON a.id = m.authorId JOIN ChatMember member ON member.channelId = m.channelId
      WHERE m.id = ?1 AND member.userId <> m.authorId`).bind(id),
    db.prepare(`SELECT ${assertion(`changes() = (
      SELECT COUNT(*) FROM ChatMember member JOIN ChatMessage m ON m.channelId = member.channelId
      WHERE m.id = ?1 AND member.userId <> m.authorId)
      AND (SELECT COUNT(*) FROM Notification n WHERE n.targetType = 'CHAT_MESSAGE'
        AND n.type = 'CHAT_MESSAGE' AND n.targetId = ?1) = (
      SELECT COUNT(*) FROM ChatMember member JOIN ChatMessage m ON m.channelId = member.channelId
      WHERE m.id = ?1 AND member.userId <> m.authorId)`)} AS ok`).bind(id),
    // Typed columns avoid inflating an embedded author image in a JSON row.
    // The first assertion already validates every dependency in this batch;
    // no writer or response read can interleave before this projection.
    db.prepare(`SELECT m.id, m.content, m.channelId, m.authorId, m.createdAt, m.updatedAt,
      m.imageUrl, m.messageType, a.name AS authorName, a.image AS authorImage
      FROM ChatMessage m JOIN User a ON a.id = m.authorId WHERE m.id = ?1`).bind(id),
  ]);
  if (results.some(result => !result.success)) throw new Error('D1 chat message batch failed.');
  const row = results[5].results[0];
  if (!row) throw new Error('D1 chat message projection is missing.');
  return { id: row.id, content: row.content, channelId: row.channelId, authorId: row.authorId,
    createdAt, updatedAt: createdAt, imageUrl: row.imageUrl, messageType: row.messageType,
    author: { id: row.authorId, name: row.authorName, image: row.authorImage } };
}
