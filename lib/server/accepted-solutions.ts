import 'server-only';

import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

export class SolutionError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

const retryable = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError &&
  (error.code === 'P2034' || error.code === 'P2002');

/** Reads authorization, eligibility and the state transition in one snapshot. */
export async function changeAcceptedSolution(postId: string, actorId: string, commentId: string | null, expectedRevision: string | null) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let previousCommentId: string | null = null;
    let previousRevision: string | null = null;
    try {
      return await prisma.$transaction(async tx => {
        const actor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true } });
        if (!actor) throw new SolutionError('Nicht authentifiziert', 401);
        const post = await tx.post.findUnique({ where: { id: postId }, select: { authorId: true, published: true } });
        // Do not disclose a private discussion to another account, even staff.
        if (!post || (!post.published && post.authorId !== actorId)) throw new SolutionError('Beitrag nicht gefunden', 404);
        if (post.authorId !== actorId) throw new SolutionError('Nur der Beitragsautor kann eine Lösung auswählen', 403);
        if (commentId !== null) {
          if (!post.published) throw new SolutionError('Lösungen können nur in veröffentlichten Beiträgen ausgewählt werden', 400);
          const reply = await tx.comment.findUnique({ where: { id: commentId }, select: {
            postId: true, authorId: true, author: { select: { isTestAccount: true } },
          } });
          if (!reply || reply.postId !== postId) throw new SolutionError('Kommentar nicht gefunden', 404);
          if (reply.authorId === actorId || reply.author.isTestAccount) {
            throw new SolutionError('Eigene Antworten und Testkonten sind nicht als Lösung berechtigt', 400);
          }
        }
        const existing = await tx.acceptedSolution.findUnique({ where: { postId } });
        previousCommentId = existing?.commentId ?? null;
        previousRevision = existing?.revision ?? null;
        // A retried successful request does not generate another decision.
        if ((existing?.commentId ?? null) === commentId) return { changed: false };
        if ((existing?.revision ?? null) !== expectedRevision) {
          throw new SolutionError('Die Lösung wurde inzwischen geändert. Der aktuelle Stand wurde geladen; bitte erneut auswählen.', 409);
        }
        const revision = randomUUID();
        if (existing) {
          const match = { postId, revision: existing.revision };
          const result = commentId === null
            ? await tx.acceptedSolution.deleteMany({ where: match })
            : await tx.acceptedSolution.updateMany({ where: match, data: { commentId, revision, createdAt: new Date() } });
          if (result.count !== 1) throw new SolutionError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
        } else if (commentId !== null) {
          await tx.acceptedSolution.create({ data: { postId, commentId, revision } });
        }
        await tx.acceptedSolutionChange.create({ data: {
          id: revision, actorId, postId, previousCommentId: existing?.commentId ?? null, commentId,
          action: commentId === null ? 'CLEARED' : existing ? 'CHANGED' : 'SELECTED',
        } });
        return { changed: true };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        // Retry only an evidenced reference/eligibility race. If all referenced
        // rows and state are intact, preserve the unexpected invariant failure.
        const [actor, post, reply, previousReply, state] = await Promise.all([
          prisma.user.findUnique({ where: { id: actorId }, select: { id: true } }),
          prisma.post.findUnique({ where: { id: postId }, select: { authorId: true, published: true } }),
          commentId ? prisma.comment.findUnique({ where: { id: commentId }, select: { postId: true, authorId: true, author: { select: { isTestAccount: true } } } }) : null,
          previousCommentId ? prisma.comment.findUnique({ where: { id: previousCommentId }, select: { id: true } }) : null,
          prisma.acceptedSolution.findUnique({ where: { postId }, select: { revision: true } }),
        ]);
        const raced = !actor || !post || post.authorId !== actorId ||
          (commentId !== null && (!post.published || !reply || reply.postId !== postId || reply.authorId === actorId || reply.author.isTestAccount)) ||
          (previousCommentId !== null && !previousReply) || (state?.revision ?? null) !== previousRevision;
        if (!raced) throw error;
      } else if (!retryable(error)) throw error;
      if (attempt === 3) throw new SolutionError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
    }
  }
  throw new SolutionError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
}
