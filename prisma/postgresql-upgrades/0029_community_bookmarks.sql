-- Provisional local composition: follows PR83 invitation predecessor; no release/merge implied.
CREATE TABLE "CommunityBookmark" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "postId" TEXT,
  "commentId" TEXT,
  "savedAt" TIMESTAMP(3),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "lastRequestId" TEXT NOT NULL,
  "lastExpectedRevision" INTEGER NOT NULL,
  CONSTRAINT "CommunityBookmark_target_shape" CHECK (("postId" IS NOT NULL AND "commentId" IS NULL) OR ("postId" IS NULL AND "commentId" IS NOT NULL)),
  CONSTRAINT "CommunityBookmark_revision_shape" CHECK ("revision" > 0 AND "revision" <= 2147483647 AND "lastExpectedRevision" >= 0 AND "lastExpectedRevision" < "revision"),
  CONSTRAINT "CommunityBookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommunityBookmark_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommunityBookmark_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CommunityBookmark_userId_postId_key" ON "CommunityBookmark"("userId", "postId");
CREATE UNIQUE INDEX "CommunityBookmark_userId_commentId_key" ON "CommunityBookmark"("userId", "commentId");
CREATE INDEX "CommunityBookmark_userId_savedAt_id_idx" ON "CommunityBookmark"("userId", "savedAt", "id");
CREATE INDEX "CommunityBookmark_postId_idx" ON "CommunityBookmark"("postId");
CREATE INDEX "CommunityBookmark_commentId_idx" ON "CommunityBookmark"("commentId");
