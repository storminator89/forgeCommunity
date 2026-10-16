-- Additive FIFO queue; existing events and attendee statuses remain unchanged.
-- AUTOINCREMENT prevents a removed entry's ID being reused after leave/rejoin,
-- including when the queue becomes empty. Promotion notices use this identity.
CREATE TABLE "EventWaitlist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventWaitlist_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EventWaitlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EventWaitlist_eventId_userId_key" ON "EventWaitlist"("eventId", "userId");
CREATE INDEX "EventWaitlist_eventId_id_idx" ON "EventWaitlist"("eventId", "id");
CREATE INDEX "EventWaitlist_userId_idx" ON "EventWaitlist"("userId");
