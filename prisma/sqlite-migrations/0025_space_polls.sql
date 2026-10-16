-- Voluntary polls, without voter-list API or learning/reward side effects.
CREATE TABLE "SpacePoll" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "spaceId" TEXT NOT NULL,
 "creatorId" TEXT,
 "requestId" TEXT NOT NULL,
 "payloadDigest" TEXT NOT NULL,
 "question" TEXT NOT NULL CHECK (length("question") BETWEEN 5 AND 200),
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "closedAt" DATETIME,
 "hiddenAt" DATETIME,
 "moderationRevision" INTEGER NOT NULL DEFAULT 0 CHECK ("moderationRevision" >= 0),
 CONSTRAINT "SpacePoll_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "SpacePoll_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SpacePoll_spaceId_requestId_key" ON "SpacePoll"("spaceId", "requestId");
CREATE INDEX "SpacePoll_spaceId_createdAt_id_idx" ON "SpacePoll"("spaceId", "createdAt", "id");
CREATE INDEX "SpacePoll_creatorId_createdAt_idx" ON "SpacePoll"("creatorId", "createdAt");
CREATE TABLE "SpacePollOption" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "pollId" TEXT NOT NULL,
 "position" INTEGER NOT NULL CHECK ("position" BETWEEN 0 AND 7),
 "label" TEXT NOT NULL CHECK (length("label") BETWEEN 1 AND 100),
 CONSTRAINT "SpacePollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "SpacePoll"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SpacePollOption_pollId_id_key" ON "SpacePollOption"("pollId", "id");
CREATE UNIQUE INDEX "SpacePollOption_pollId_position_key" ON "SpacePollOption"("pollId", "position");
CREATE TABLE "SpacePollVote" (
 "pollId" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "optionId" TEXT NOT NULL,
 "revision" INTEGER NOT NULL CHECK ("revision" BETWEEN 1 AND 2147483646),
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" DATETIME NOT NULL,
 PRIMARY KEY ("pollId", "userId"),
 CONSTRAINT "SpacePollVote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "SpacePoll"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "SpacePollVote_pollId_optionId_fkey" FOREIGN KEY ("pollId", "optionId") REFERENCES "SpacePollOption"("pollId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "SpacePollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SpacePollVote_pollId_optionId_idx" ON "SpacePollVote"("pollId", "optionId");
CREATE INDEX "SpacePollVote_userId_idx" ON "SpacePollVote"("userId");
CREATE TABLE "SpacePollVoteRequest" (
 "pollId" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "requestId" TEXT NOT NULL,
 "payloadDigest" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("pollId", "userId", "requestId"),
 CONSTRAINT "SpacePollVoteRequest_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "SpacePoll"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "SpacePollVoteRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SpacePollVoteRequest_userId_createdAt_idx" ON "SpacePollVoteRequest"("userId", "createdAt");
