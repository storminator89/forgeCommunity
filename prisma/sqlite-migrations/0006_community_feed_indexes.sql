-- Match descending timestamp/id keysets (the same-direction B-tree can be
-- scanned backwards), per-post comment previews, and aggregate activity counts.
CREATE INDEX "Post_createdAt_id_idx" ON "Post"("createdAt", "id");
CREATE INDEX "Post_published_createdAt_id_idx" ON "Post"("published", "createdAt", "id");
CREATE INDEX "Post_authorId_createdAt_id_idx" ON "Post"("authorId", "createdAt", "id");
CREATE INDEX "Comment_postId_createdAt_id_idx" ON "Comment"("postId", "createdAt", "id");
CREATE INDEX "Comment_authorId_postId_idx" ON "Comment"("authorId", "postId");
CREATE INDEX "LikePost_postId_idx" ON "LikePost"("postId");
CREATE INDEX "LikeComment_commentId_idx" ON "LikeComment"("commentId");
