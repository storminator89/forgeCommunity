-- A missing row is an unvisited channel, rather than historical unread.
CREATE TABLE "ChatReadCursor" (
  "userId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "lastReadCreatedAt" DATETIME,
  "lastReadId" TEXT,
  PRIMARY KEY ("userId", "channelId"),
  CONSTRAINT "ChatReadCursor_position_pair_check" CHECK (("lastReadCreatedAt" IS NULL) = ("lastReadId" IS NULL)),
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
