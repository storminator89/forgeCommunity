-- One live reply per discussion, with a database-owned same-post guarantee.
CREATE UNIQUE INDEX "Comment_postId_id_key" ON "Comment"("postId", "id");
CREATE TABLE "AcceptedSolution" (
  "postId" TEXT NOT NULL PRIMARY KEY,
  "commentId" TEXT NOT NULL,
  "revision" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AcceptedSolution_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AcceptedSolution_postId_commentId_fkey" FOREIGN KEY ("postId", "commentId") REFERENCES "Comment"("postId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AcceptedSolution_commentId_key" ON "AcceptedSolution"("commentId");
CREATE UNIQUE INDEX "AcceptedSolution_revision_key" ON "AcceptedSolution"("revision");

-- Append-only through application APIs; no content or recipient-user snapshots.
-- Account/target erasure anonymizes audit references through nullable FKs.
CREATE TABLE "AcceptedSolutionChange" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "action" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorId" TEXT,
  "postId" TEXT,
  "previousCommentId" TEXT,
  "commentId" TEXT,
  CONSTRAINT "AcceptedSolutionChange_action_check" CHECK ("action" IN ('SELECTED', 'CHANGED', 'CLEARED')),
  CONSTRAINT "AcceptedSolutionChange_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AcceptedSolutionChange_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AcceptedSolutionChange_previousCommentId_fkey" FOREIGN KEY ("previousCommentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AcceptedSolutionChange_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "AcceptedSolutionChange_postId_createdAt_idx" ON "AcceptedSolutionChange"("postId", "createdAt");
