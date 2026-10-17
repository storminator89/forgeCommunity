import 'server-only';

import { env } from 'cloudflare:workers';
import type { Prisma } from '@/generated/prisma/client';
import type { communityCommentInclude } from '@/lib/server/community-feed';

type CreatedComment = Prisma.CommentGetPayload<{ include: ReturnType<typeof communityCommentInclude> }>;
type CreatedCommentRow = {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  postId: string;
  authorId: string;
  authorName: string | null;
  authorImage: string | null;
  authorIsTestAccount: number;
  canSelectSolution: number;
};

/**
 * PrismaD1 cannot run interactive transactions. D1's native batch commits these
 * statements atomically, rolling the comment back if its notification fails.
 * Comment totals are derived from Comment rows, so no separate counter write
 * is needed. Keep the response read in the batch too, on the same snapshot.
 * https://developers.cloudflare.com/d1/worker-api/d1-database/#batch
 */
export async function createD1PostComment(input: {
  postId: string;
  authorId: string;
  content: string;
  sessionRole?: string | null;
}): Promise<{ comment: CreatedComment; canSelectSolution: boolean } | null> {
  const db = env.DB;
  if (!db) throw new Error('Cloudflare D1 binding DB is unavailable.');

  const commentId = crypto.randomUUID();
  const notificationId = crypto.randomUUID();
  // Match PrismaD1's Date serialization so feed ordering/cursors stay coherent.
  const timestamp = new Date().toISOString().replace('Z', '+00:00');
  const results = await db.batch<CreatedCommentRow>([
    db.prepare(`
      INSERT INTO "Comment" ("id", "content", "createdAt", "updatedAt", "postId", "authorId")
      SELECT ?, ?, ?, ?, p."id", a."id"
      FROM "Post" p JOIN "User" a ON a."id" = ?
      WHERE p."id" = ? AND (
        p."published" = 1 OR p."authorId" = a."id"
        OR (? = 1 AND a."role" = 'ADMIN')
      )
    `).bind(commentId, input.content, timestamp, timestamp, input.authorId,
      input.postId, input.sessionRole === 'ADMIN' ? 1 : 0),
    // Derive recipient and target from the inserted row, never from a stale
    // preflight read. A denied/deleted post creates neither row; self replies
    // cannot create notifications, even if the author changed before the batch.
    db.prepare(`
      INSERT INTO "Notification"
        ("id", "userId", "type", "content", "targetType", "targetId", "isRead", "createdAt")
      SELECT ?, p."authorId", 'COMMENT', ?, 'COMMENT', c."id", 0, c."createdAt"
      FROM "Comment" c JOIN "Post" p ON p."id" = c."postId"
      WHERE c."id" = ? AND c."authorId" = ? AND p."authorId" <> c."authorId"
    `).bind(notificationId, 'Ein Mitglied hat deinen Beitrag kommentiert.', commentId, input.authorId),
    db.prepare(`
      SELECT c."id", c."content", c."createdAt", c."updatedAt", c."postId", c."authorId",
        a."name" AS "authorName", a."image" AS "authorImage",
        a."isTestAccount" AS "authorIsTestAccount",
        CASE WHEN p."published" = 1 AND p."authorId" = c."authorId"
          THEN 1 ELSE 0 END AS "canSelectSolution"
      FROM "Comment" c
      JOIN "User" a ON a."id" = c."authorId"
      JOIN "Post" p ON p."id" = c."postId"
      WHERE c."id" = ? AND c."authorId" = ?
    `).bind(commentId, input.authorId),
  ]);

  if (results.some(result => !result.success)) throw new Error('D1 comment batch failed.');
  const row = results[2].results[0];
  if (!row) return null;

  // No other write can interleave with the batch, and a new comment has no
  // likes. Reconstruct the existing bounded Prisma projection for the API.
  const comment: CreatedComment = {
    id: row.id, content: row.content, postId: row.postId, authorId: row.authorId,
    createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt),
    author: { id: row.authorId, name: row.authorName, image: row.authorImage,
      isTestAccount: row.authorIsTestAccount === 1 },
    _count: { likeComments: 0 }, likeComments: [],
  };
  return { comment, canSelectSolution: row.canSelectSolution === 1 };
}
