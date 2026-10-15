-- Reserved after 0012 verified pathways. The evidence is private and
-- subordinate to an immutable, server-graded quiz attempt.
CREATE TYPE "QuizConfidence" AS ENUM ('SURE', 'SOMEWHAT_SURE', 'UNSURE', 'GUESSED');
ALTER TABLE "QuizAttempt" ADD COLUMN "confidenceDigest" TEXT;

CREATE TABLE "QuizAttemptItemEvidence" (
  "attemptId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "correct" BOOLEAN NOT NULL,
  "confidence" "QuizConfidence",
  CONSTRAINT "QuizAttemptItemEvidence_pkey" PRIMARY KEY ("attemptId", "questionId"),
  CONSTRAINT "QuizAttemptItemEvidence_attemptId_fkey" FOREIGN KEY ("attemptId")
    REFERENCES "QuizAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
