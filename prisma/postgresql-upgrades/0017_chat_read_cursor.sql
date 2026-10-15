-- A missing row is an unvisited channel, rather than historical unread.
CREATE TABLE "ChatReadCursor" (
  "userId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "lastReadCreatedAt" TIMESTAMP(3),
  "lastReadId" TEXT,
  CONSTRAINT "ChatReadCursor_pkey" PRIMARY KEY ("userId", "channelId"),
  CONSTRAINT "ChatReadCursor_position_pair_check" CHECK (("lastReadCreatedAt" IS NULL) = ("lastReadId" IS NULL)),
  CONSTRAINT "ChatReadCursor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatReadCursor_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
