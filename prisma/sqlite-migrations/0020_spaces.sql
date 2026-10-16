-- AlterTable
ALTER TABLE "ContentReport" ADD COLUMN "scopeSpaceId" TEXT;

-- CreateTable
CREATE TABLE "Space" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SpaceMember" (
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("spaceId", "userId"),
    CONSTRAINT "SpaceMember_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaceDiscussion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "hiddenAt" DATETIME,
    CONSTRAINT "SpaceDiscussion_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SpaceDiscussion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaceReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discussionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "hiddenAt" DATETIME,
    CONSTRAINT "SpaceReply_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "SpaceDiscussion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaceReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SpaceMember_userId_spaceId_idx" ON "SpaceMember"("userId", "spaceId");

-- CreateIndex
CREATE INDEX "SpaceDiscussion_spaceId_createdAt_id_idx" ON "SpaceDiscussion"("spaceId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SpaceDiscussion_authorId_idx" ON "SpaceDiscussion"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaceDiscussion_spaceId_authorId_requestId_key" ON "SpaceDiscussion"("spaceId", "authorId", "requestId");

-- CreateIndex
CREATE INDEX "SpaceReply_discussionId_createdAt_id_idx" ON "SpaceReply"("discussionId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SpaceReply_authorId_idx" ON "SpaceReply"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaceReply_discussionId_authorId_requestId_key" ON "SpaceReply"("discussionId", "authorId", "requestId");

-- CreateIndex
CREATE INDEX "ContentReport_scopeSpaceId_status_createdAt_idx" ON "ContentReport"("scopeSpaceId", "status", "createdAt");
