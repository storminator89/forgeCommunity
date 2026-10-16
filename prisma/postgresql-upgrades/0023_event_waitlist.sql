-- Additive FIFO queue; existing events and attendee statuses remain unchanged.
-- The non-cycling SERIAL sequence gives each rejoin a fresh queue and notice ID.
CREATE TABLE "EventWaitlist" (
    "id" SERIAL NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventWaitlist_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EventWaitlist_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EventWaitlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EventWaitlist_eventId_userId_key" ON "EventWaitlist"("eventId", "userId");
CREATE INDEX "EventWaitlist_eventId_id_idx" ON "EventWaitlist"("eventId", "id");
CREATE INDEX "EventWaitlist_userId_idx" ON "EventWaitlist"("userId");
