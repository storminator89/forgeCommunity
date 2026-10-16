-- CreateEnum
CREATE TYPE "SpaceVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- AlterTable
ALTER TABLE "ContentReport" ADD COLUMN     "scopeSpaceId" TEXT;

-- CreateTable
CREATE TABLE "Space" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "visibility" "SpaceVisibility" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Space_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaceMember" (
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpaceMember_pkey" PRIMARY KEY ("spaceId","userId")
);

-- CreateTable
CREATE TABLE "SpaceDiscussion" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "hiddenAt" TIMESTAMP(3),

    CONSTRAINT "SpaceDiscussion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaceReply" (
    "id" TEXT NOT NULL,
    "discussionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "hiddenAt" TIMESTAMP(3),

    CONSTRAINT "SpaceReply_pkey" PRIMARY KEY ("id")
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

-- AddForeignKey
ALTER TABLE "SpaceMember" ADD CONSTRAINT "SpaceMember_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceMember" ADD CONSTRAINT "SpaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceDiscussion" ADD CONSTRAINT "SpaceDiscussion_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceDiscussion" ADD CONSTRAINT "SpaceDiscussion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceReply" ADD CONSTRAINT "SpaceReply_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "SpaceDiscussion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceReply" ADD CONSTRAINT "SpaceReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
